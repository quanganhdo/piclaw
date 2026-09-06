import type Database from "bun:sqlite";

import type { AccessMode } from "../core/config-access.js";
import type { ExecutionProvenance, ExecutionIdentity } from "../core/execution-context.js";
import type { AuthenticatedPrincipal } from "../core/access-types.js";
import { getUser } from "../db/users.js";
import { resolveAuthorisedChat, ChatAccessDenied } from "../db/session-ownership.js";
import { readFamilyToolPolicy } from '../db/family-tool-restrictions.js';
import { readAccountPreferences } from '../db/account-preferences.js';
import { readAccountModelDefaults } from '../db/account-model-defaults.js';
import { authoriseScheduledDispatch, hasScheduledDispatch } from './scheduled-dispatch-context.js';

const KINDS = ["interactive", "scheduled", "followup", "side-prompt", "dream", "delegate"];

/** Re-read account, login and root state before hydration; labels never come from supplied provenance. */
export function authoriseExecutionIdentity(
  database: Database,
  mode: AccessMode,
  chatJid: string,
  provenance: ExecutionProvenance | undefined,
): ExecutionIdentity | null {
  if(hasScheduledDispatch()) {
    return authoriseScheduledDispatch(chatJid,mode==="family-shared"?provenance:undefined);
  }
  if (mode === "single-user" && provenance === undefined) return null;
  // A durable ID alone is not admission. Scheduled work requires the active
  // one-shot dispatcher scope above; ordinary callers need a live login.
  if (mode !== "single-user" && (mode !== "family-shared" || provenance?.kind !== "interactive")) throw new ChatAccessDenied();
  if (!provenance || provenance.chatJid !== chatJid || provenance.actorUserId !== provenance.ownerUserId || !KINDS.includes(provenance.kind)) throw new ChatAccessDenied();
  if (mode === "single-user" && provenance.ownerUserId !== "default") throw new ChatAccessDenied();
  const user = getUser(database, provenance.ownerUserId);
  if (!user?.enabled) throw new ChatAccessDenied();
  if (provenance.kind === "interactive") {
    if (!provenance.authenticationSessionId) throw new ChatAccessDenied();
    const login = database.query("SELECT user_id,expires_at FROM web_sessions WHERE session_id=?").get(provenance.authenticationSessionId) as {user_id:string;expires_at:string} | null;
    if (!login || login.user_id !== user.id || !Number.isFinite(Date.parse(login.expires_at)) || Date.parse(login.expires_at) <= Date.now()) throw new ChatAccessDenied();
  }
  const actor: AuthenticatedPrincipal = {
    kind:"user",userId:user.id,username:user.username,displayName:user.display_name,role:user.role,mode,homeChatJid:user.home_chat_jid,
    authentication:{method:"execution",sessionId:provenance.authenticationSessionId ?? null,expiresAt:null},
  };
  const target = resolveAuthorisedChat(database, actor, chatJid, "session.write");
  // Projection deliberately discards extra fields, including any caller-provided labels/tokens.
  const snapshot: ExecutionProvenance = Object.freeze({
    actorUserId:user.id,ownerUserId:user.id,chatJid,kind:provenance.kind,
    ...(provenance.authenticationSessionId ? {authenticationSessionId:provenance.authenticationSessionId} : {}),
  });
  return Object.freeze({provenance:snapshot,username:user.username,displayName:user.display_name,role:user.role,rootChatJid:target.rootChatJid,mode,
    ...(mode === 'family-shared' ? { toolPolicy: readFamilyToolPolicy(database, user.id), preferences: readAccountPreferences(database, user.id), modelDefaults: readAccountModelDefaults(database, user.id) } : {}),
  });
}
