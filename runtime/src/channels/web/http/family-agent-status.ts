import type { AuthenticatedPrincipal } from "../../../core/access-types.js";
import { requireAccountActor } from "../../../db/account-administration.js";
import { getDb } from "../../../db/connection.js";
import { ChatAccessDenied, resolveAuthorisedChat } from "../../../db/session-ownership.js";
import { buildAgentContextSnapshot, buildAgentStatusSnapshot } from "../agent/agent-status.js";
import type { WebChannelLike } from "../core/web-channel-contracts.js";

function selectedChat(url: URL): string | undefined {
  if ([...url.searchParams.keys()].some(key => key !== "chat_jid")) throw new ChatAccessDenied();
  const values = url.searchParams.getAll("chat_jid");
  if (values.length === 0) return undefined;
  if (values.length !== 1 || !values[0]?.trim()) throw new ChatAccessDenied();
  return values[0].trim();
}

/** Remove process/add-on presentation metadata that has no owner-scoped family contract. */
export function projectFamilyAgentStatusData(value: unknown): unknown {
  if (!value || typeof value !== "object" || Array.isArray(value)) return value;
  const {
    runtime_generation: _runtimeGeneration,
    status_hints: _statusHints,
    statusHints: _legacyStatusHints,
    ...projected
  } = value as Record<string, unknown>;
  return projected;
}

/** Read-only owner projection for the shared standard status/context components. */
export async function handleFamilyAgentStatus(
  channel: WebChannelLike,
  req: Request,
  principal: AuthenticatedPrincipal,
): Promise<Response> {
  const deny = () => channel.json({ error: "Session access denied." }, 403);
  try {
    if (req.method !== "GET") return deny();
    const url = new URL(req.url);
    const target = resolveAuthorisedChat(getDb(), principal, selectedChat(url), "session.read");
    const context = channel.endpointContexts.agentStatus();
    const payload = url.pathname === "/agent/status"
      ? buildAgentStatusSnapshot(target.chatJid, context, {
          includeDiagnostics: false,
          includeExtensionWorking: false,
          recoverStaleInflight: false,
        })
      : await buildAgentContextSnapshot(target.chatJid, context);

    // Recheck after all runtime/DB reads so a late account or ownership change
    // cannot release a stale snapshot.
    requireAccountActor(getDb(), principal);
    resolveAuthorisedChat(getDb(), principal, target.chatJid, "session.read");
    return channel.json({
      ...payload,
      ...(Object.hasOwn(payload, "data") ? { data: projectFamilyAgentStatusData(payload.data) } : {}),
    });
  } catch (error) {
    if (error instanceof ChatAccessDenied) return deny();
    throw error;
  }
}
