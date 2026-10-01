import { canPrincipalAct } from "../auth/principal.js";
import { workspaceIndexAccess, WorkspaceIndexAccessDenied } from "../../../core/workspace-index-access.js";
import type { WebChannelLike } from "../core/web-channel-contracts.js";
import { createLogger, debugSuppressedError } from '../../../utils/logger.js';
const log=createLogger('web.workspace-indexing');
import {
  getWorkspaceIndexingData,
  previewWorkspaceIndexPolicy,
  refreshWorkspaceIndexing,
  saveWorkspaceIndexingPolicy,
} from "../workspace/indexing.js";

const BASE_PATH = "/agent/settings/workspace/indexing";

function ownerPrincipal(channel: WebChannelLike, req: Request, refresh = false) {
  const principal = channel.authGateway.getPrincipal?.(req, refresh) ?? null;
  if (!principal || principal.mode !== "single-user" || !canPrincipalAct(principal, "instance.configure")) {
    return null;
  }
  return principal;
}

async function readBody(req: Request): Promise<string> {
  if(!req.body)return '';
  const reader=req.body.getReader(),buffer=new Uint8Array(32768);let used=0;
  let timer:ReturnType<typeof setTimeout>;
  const timeout=new Promise<never>((_,reject)=>{timer=setTimeout(()=>reject(new Error('Request body timed out.')),5000);});
  try{for(;;){if(req.signal.aborted)throw new Error('Request cancelled.');const {done,value}=await Promise.race([reader.read(),timeout]);if(done)break;if(used+value.length>buffer.length)throw new Error('Policy body exceeds 32 KiB.');buffer.set(value,used);used+=value.length;}
    return new TextDecoder('utf-8',{fatal:true}).decode(buffer.subarray(0,used));
  }finally{clearTimeout(timer!);void reader.cancel().catch(error=>debugSuppressedError(log,'Index policy body cancellation failed.',error));try{reader.releaseLock();}catch(error){debugSuppressedError(log,'Index policy reader release deferred.',error);}}
}
async function readJson(req: Request): Promise<unknown> {
  const text = await readBody(req);
  if (!text.trim()) throw new Error("A JSON policy body is required.");
  try {
    return JSON.parse(text);
  } catch {
    throw new Error("Invalid JSON.");
  }
}

async function requireEmptyBody(req: Request): Promise<void> {
  const text = await readBody(req);
  if (!text.trim()) return;
  let value: unknown;
  try { value = JSON.parse(text); } catch { throw new Error("Invalid JSON."); }
  if (!value || typeof value !== "object" || Array.isArray(value) || Object.keys(value).length > 0) {
    throw new Error("Refresh does not accept request parameters.");
  }
}

/** Owner-only direct HTTP API for Workspace → Indexing settings. */
export async function handleWorkspaceIndexingSettings(
  channel: WebChannelLike,
  req: Request,
  url: URL,
): Promise<Response | null> {
  if (url.pathname !== BASE_PATH
    && url.pathname !== `${BASE_PATH}/preview`
    && url.pathname !== `${BASE_PATH}/save`
    && url.pathname !== `${BASE_PATH}/refresh`) return null;

  if (!ownerPrincipal(channel, req)) return channel.json({ error: "Workspace indexing settings are owner-only." }, 403);
  if (url.search) return channel.json({ error: "Workspace indexing settings do not accept query parameters." }, 400);

  try {
    const access=workspaceIndexAccess(),owner=JSON.stringify(ownerPrincipal(channel,req));
    const check=()=>{access.validate();const current=ownerPrincipal(channel,req,true);if(access.mode!=='single-user'||!current||JSON.stringify(current)!==owner)throw new WorkspaceIndexAccessDenied();};
    check();
    if (req.method === "GET" && url.pathname === BASE_PATH) {
      return channel.json({ ok: true, ...getWorkspaceIndexingData() }, 200);
    }
    if (req.method === "POST" && url.pathname === `${BASE_PATH}/preview`) {
      const input=await readJson(req);check();
      const preview=await previewWorkspaceIndexPolicy(input);check();
      return channel.json({ ok: true, preview }, 200);
    }
    if (req.method === "POST" && url.pathname === `${BASE_PATH}/save`) {
      const input=await readJson(req);check();
      return channel.json({ ok: true, ...saveWorkspaceIndexingPolicy(input) }, 200);
    }
    if (req.method === "POST" && url.pathname === `${BASE_PATH}/refresh`) {
      await requireEmptyBody(req);check();
      return channel.json({ ok: true, ...refreshWorkspaceIndexing() }, 202);
    }
    return channel.json({ error: "Method not allowed." }, 405);
  } catch (error) {
    if (error instanceof WorkspaceIndexAccessDenied) {
      return channel.json({ error: "Workspace indexing settings are owner-only." }, 403);
    }
    const message = error instanceof Error ? error.message : String(error);
    return channel.json({ error: message || "Workspace indexing request failed." }, 400);
  }
}
