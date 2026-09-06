import type { AccessMode } from "../../../core/config-access.js";
import type { UserRecord } from "../../../db/users.js";
import type { WebSessionRecord } from "../../../db/web-sessions.js";
import { getSessionTokenFromRequest } from "./session-auth.js";

export const ACCESS_ACTIONS = [
  "account.read-self", "account.update-self", "account.manage-users",
  "session.read", "session.write", "session.fork", "session.rename", "session.archive",
  "instance.configure",
] as const;
import type { AuthenticatedPrincipal } from "../../../core/access-types.js";
export type { AccessAction, AuthenticatedPrincipal } from "../../../core/access-types.js";

export interface PrincipalResolverDeps {
  getSession(token: string): WebSessionRecord | null;
  getUser(id: string): UserRecord | null;
  getLocalDisplayName(): string;
}

/** Pure per-request resolution. Invalid identities never fall back to a local administrator. */
export function resolveRequestPrincipal(
  req: Request,
  options: { mode: AccessMode; authEnabled: boolean },
  deps: PrincipalResolverDeps,
): AuthenticatedPrincipal | null {
  if (!options.authEnabled) {
    if (options.mode !== "single-user") return null;
    return Object.freeze({
      kind: "local", userId: "default", username: "default", displayName: deps.getLocalDisplayName(),
      role: "admin", mode: options.mode, homeChatJid: "web:default",
      authentication: Object.freeze({ method: "local", sessionId: null, expiresAt: null }),
    });
  }
  const token = getSessionTokenFromRequest(req);
  if (!token) return null;
  const session = deps.getSession(token);
  if (!session) return null;
  const expiry = Date.parse(session.expires_at);
  if (!Number.isFinite(expiry) || expiry <= Date.now()) return null;
  if (options.mode === "single-user" && session.user_id !== "default") return null;
  const user = deps.getUser(session.user_id);
  if (!user?.enabled) return null;
  return Object.freeze({
    kind: "user", userId: user.id, username: user.username,
    displayName: options.mode === "single-user" ? deps.getLocalDisplayName() : user.display_name,
    role: user.role, mode: options.mode, homeChatJid: user.home_chat_jid,
    authentication: Object.freeze({ method: session.auth_method || "unknown", sessionId: session.session_id || null, expiresAt: session.expires_at }),
  });
}

/** Role grants and resource ownership are separate checks. Unknown actions always deny. */
export function canPrincipalAct(principal: AuthenticatedPrincipal, action: string, ownerUserId?: string): boolean {
  if (!(ACCESS_ACTIONS as readonly string[]).includes(action)) return false;
  if (action === "account.manage-users") return principal.role === "admin" && principal.mode !== "single-user";
  if (action === "instance.configure") return principal.role === "admin";
  if (action === "account.read-self" || action === "account.update-self") return !ownerUserId || ownerUserId === principal.userId;
  return ownerUserId === principal.userId;
}

/** Identity endpoint has its own deny response, including when entered without browser authentication. */
export function principalResponse(req: Request, principal: AuthenticatedPrincipal | null): Response {
  const headers = { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "private, no-store", Vary: "Cookie" };
  if (req.method !== "GET" && req.method !== "HEAD") return new Response(JSON.stringify({ error: "Method not allowed" }), { status: 405, headers: { ...headers, Allow: "GET, HEAD" } });
  const payload = principal ? {
    principal,
    auth_enabled: principal.kind !== "local",
    destination: { mode: principal.mode, home_chat_jid: principal.homeChatJid },
    capabilities: {
      manage_users: canPrincipalAct(principal, "account.manage-users"),
      configure_instance: canPrincipalAct(principal, "instance.configure"),
      access_other_users_sessions: false,
    },
  } : { error: "Unauthorized" };
  return new Response(req.method === "HEAD" ? null : JSON.stringify(payload), { status: principal ? 200 : 401, headers });
}
