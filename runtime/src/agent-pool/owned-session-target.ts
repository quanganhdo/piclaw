import { getChatJid } from "../core/chat-context.js";
import { getExecutionIdentity } from "../core/execution-context.js";
import { getDb } from "../db/connection.js";
import { ChatAccessDenied, resolveAuthorisedChat } from "../db/session-ownership.js";
import { listOwnedSessionHandles, resolveOwnedSessionHandle } from "../db/session-handles.js";
import { requireOwnedSessionExecution } from "./owned-session-access.js";

/** Source is the live execution context, never a relay/control request's claimed identity. */
export function requireOwnedSource(sourceChatJid?: string) {
  const context = getExecutionIdentity();
  if (!context || getChatJid("") !== context.provenance.chatJid
    || (sourceChatJid !== undefined && sourceChatJid !== context.provenance.chatJid)) throw new ChatAccessDenied();
  const actor = requireOwnedSessionExecution(context.provenance.chatJid);
  if (!actor) throw new ChatAccessDenied();
  return actor;
}

export function resolveOwnedSessionTarget(sourceChatJid: string, selector: { target_chat_jid?: string; target_agent_name?: string }) {
  const actor = requireOwnedSource(sourceChatJid);
  const jid = selector.target_chat_jid;
  const name = selector.target_agent_name;
  if ((jid !== undefined) === (name !== undefined)) throw new ChatAccessDenied();
  if (jid !== undefined) {
    if (!jid.trim()) throw new ChatAccessDenied();
    const target = resolveAuthorisedChat(getDb(), actor, jid.trim(), "session.read");
    // No legacy namespace or active-session fallback, even for an otherwise owned JID.
    const branch = listOwnedSessionHandles(getDb(), actor).find(row => row.chat_jid === target.chatJid);
    if (!branch) throw new ChatAccessDenied();
    return branch;
  }
  const branch = resolveOwnedSessionHandle(getDb(), actor, name!);
  if (!branch) throw new ChatAccessDenied();
  return branch;
}

export function listCurrentOwnerSessions() {
  return listOwnedSessionHandles(getDb(), requireOwnedSource());
}
