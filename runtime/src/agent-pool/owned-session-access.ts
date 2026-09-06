import type { AuthenticatedPrincipal } from "../core/access-types.js";
import { readAccessConfig } from "../core/config-access.js";
import { getExecutionIdentity } from "../core/execution-context.js";
import { getDb } from "../db/connection.js";
import { ChatAccessDenied } from "../db/session-ownership.js";
import { authoriseExecutionIdentity } from "./execution-identity.js";
import { hasScheduledDispatch } from "./scheduled-dispatch-context.js";

/** All multi-user hydration requires fresh server identity, including cached and side sessions. */
export function requireOwnedSessionExecution(chatJid: string): AuthenticatedPrincipal | null {
  const mode = readAccessConfig().mode;
  if (mode === "single-user" && !hasScheduledDispatch()) return null;
  if (mode !== "family-shared") throw new ChatAccessDenied();
  const context = getExecutionIdentity();
  if (!context || context.mode !== mode) throw new ChatAccessDenied();
  const identity = authoriseExecutionIdentity(getDb(), mode, chatJid, context.provenance);
  if (!identity) throw new ChatAccessDenied();
  return {
    kind: "user", userId: identity.provenance.ownerUserId, username: identity.username,
    displayName: identity.displayName, role: identity.role, mode,
    homeChatJid: identity.rootChatJid,
    authentication: { method: "execution", sessionId: identity.provenance.authenticationSessionId ?? null, expiresAt: null },
  };
}
