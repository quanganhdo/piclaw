import type { WebChannelLike } from "../core/web-channel-contracts.js";
import { canPrincipalAct, type AuthenticatedPrincipal } from "../auth/principal.js";
import { readAccessConfig } from "../../../core/config-access.js";
import { parseMcpEnginePolicy } from "../../../agent-pool/mcp-engine-policy.js";
import { McpPolicyApplyError } from "../../../agent-pool/mcp-codemode-runtime.js";
import { createLogger, debugSuppressedError } from "../../../utils/logger.js";
import { McpServerEditError, parseMcpServerEdit } from '../../../secure/mcp-server-edits.js';

const log = createLogger("web.mcp-settings");
const BASE = "/agent/settings/mcp";

class RequestFailure extends Error {
  constructor(readonly status: number, message: string) { super(message); }
}
function reply(body: object, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "private, no-store", Vary: "Cookie" } });
}
function owner(channel: WebChannelLike, req: Request): AuthenticatedPrincipal {
  const principal = channel.authGateway.getPrincipal?.(req, true);
  if (!principal || principal.mode !== "single-user" || !canPrincipalAct(principal, "instance.configure") || readAccessConfig().mode !== "single-user") {
    throw new RequestFailure(403, "MCP instance settings are owner-only.");
  }
  return principal;
}
function ownerKey(principal: AuthenticatedPrincipal): string {
  return JSON.stringify([principal.kind, principal.userId, principal.role, principal.mode, principal.authentication]);
}
type ApplyInput = { policy: ReturnType<typeof parseMcpEnginePolicy>; revision: string; acknowledgeInterruptions: boolean };
async function readBody(req: Request, maxBytes: number): Promise<unknown> {
  if (!req.body) throw new RequestFailure(400, 'A JSON body is required.');
  const reader = req.body.getReader(), chunks: Uint8Array[] = []; let used = 0;
  let fail!: (error: unknown) => void;
  const interrupted = new Promise<never>((_resolve, reject) => { fail = reject; });
  const abort = () => fail(new RequestFailure(400, 'MCP settings request cancelled.'));
  const timer = setTimeout(() => fail(new RequestFailure(408, 'MCP settings body timed out.')), 5000);
  req.signal.addEventListener('abort', abort, { once: true }); if (req.signal.aborted) abort();
  try {
    for (;;) { const chunk = await Promise.race([reader.read().catch(() => { throw new RequestFailure(400, 'Could not read MCP settings body.'); }), interrupted]); if (chunk.done) break;
      used += chunk.value.length; if (used > maxBytes) throw new RequestFailure(413, `MCP settings body exceeds ${maxBytes / 1024} KiB.`); chunks.push(chunk.value); }
    const bytes = new Uint8Array(used); let offset = 0; for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.length; }
    try { return JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes)); } catch { throw new RequestFailure(400, 'Invalid MCP settings JSON.'); }
  } finally { clearTimeout(timer); req.signal.removeEventListener('abort', abort); void reader.cancel().catch(error => debugSuppressedError(log, 'MCP settings reader cancellation failed.', error)); try { reader.releaseLock(); } catch (error) { debugSuppressedError(log, 'MCP settings reader release deferred.', error); } }
}
async function readPolicy(req: Request, apply: true): Promise<ApplyInput>;
async function readPolicy(req: Request, apply: false): Promise<ReturnType<typeof parseMcpEnginePolicy>>;
async function readPolicy(req: Request, apply: boolean): Promise<ApplyInput | ReturnType<typeof parseMcpEnginePolicy>> {
  const body = await readBody(req, 2048);
  try {
      const value = body as Record<string, unknown> | null;
      if (!apply) return parseMcpEnginePolicy(value);
      if (!value || typeof value !== "object" || Array.isArray(value) || Object.keys(value).some(key => !["policy", "revision", "acknowledgeInterruptions"].includes(key))
        || typeof value.revision !== "string" || value.revision.length > 128 || value.acknowledgeInterruptions !== true) throw new Error("Invalid apply body.");
      return { policy: parseMcpEnginePolicy(value.policy), revision: value.revision, acknowledgeInterruptions: true };
  } catch { throw new RequestFailure(400, "Expected only engine (adapter/native) and codemode (auto/on/off)."); }
}

/** Owner-only preview and revision-fenced codemode application. */
export async function handleMcpSettings(channel: WebChannelLike, req: Request, url: URL): Promise<Response> {
  try {
    const identity = ownerKey(owner(channel, req));
    const check = () => {
      if (ownerKey(owner(channel, req)) !== identity) throw new RequestFailure(403, "MCP instance settings are owner-only.");
      if (req.signal.aborted) throw new RequestFailure(400, "MCP preview request cancelled.");
    };
    // The initial owner resolution already authenticated this synchronous
    // boundary. Re-resolve only after body I/O and before publishing.
    if (req.signal.aborted) throw new RequestFailure(400, "MCP preview request cancelled.");
    if (url.search) throw new RequestFailure(400, "MCP instance settings do not accept query parameters.");
    if (url.pathname === `${BASE}/servers` || url.pathname.startsWith(`${BASE}/servers/`)) {
      if (req.method === 'GET' && url.pathname === `${BASE}/servers`) { const payload = channel.agentPool.inspectMcpServers(); check(); return reply(payload); }
      if (req.method !== 'POST') throw new RequestFailure(405, 'Method not allowed.');
      const value = await readBody(req, 64 * 1024); check();
      if (url.pathname === `${BASE}/servers/preview`) { const payload = channel.agentPool.inspectMcpServers(parseMcpServerEdit(value)); check(); return reply(payload); }
      if (url.pathname !== `${BASE}/servers/apply`) throw new RequestFailure(405, 'Method not allowed.');
      const input = value as Record<string, unknown> | null;
      if (!input || typeof input !== 'object' || Array.isArray(input) || Object.keys(input).some(key => !['revision','acknowledgeInterruptions'].includes(key))
        || typeof input.revision !== 'string' || input.revision.length > 128 || input.acknowledgeInterruptions !== true) throw new RequestFailure(400, 'Invalid MCP server Apply request.');
      const payload = await channel.agentPool.applyMcpServers({ revision: input.revision as string, acknowledgeInterruptions: true }, check, req.signal); check(); return reply(payload);
    }
    const preview = req.method === "POST" && url.pathname === `${BASE}/preview`;
    const apply = req.method === "POST" && url.pathname === `${BASE}/apply`;
    if (!preview && !apply && !(req.method === "GET" && url.pathname === BASE)) throw new RequestFailure(405, "Method not allowed.");
    const policy = apply ? await readPolicy(req, true) : preview ? await readPolicy(req, false) : undefined;
    check();
    const payload = apply ? await channel.agentPool.applyMcpSettings(policy as ApplyInput, check) : channel.agentPool.inspectMcpSettings(policy);
    check();
    return reply(payload);
  } catch (error) {
    if (error instanceof RequestFailure) return reply({ ok: false, error: error.message }, error.status);
    if (error instanceof McpPolicyApplyError) return reply({ ok: false, error: error.message }, error.status);
    if (error instanceof McpServerEditError) return reply({ ok: false, error: error.message }, 422);
    return reply({ ok: false, error: "MCP settings are unavailable; check instance configuration." }, 503);
  }
}
