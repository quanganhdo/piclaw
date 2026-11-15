import type Database from "bun:sqlite";
import type { AuthenticatedPrincipal } from "../core/access-types.js";
import { getUser, type UserRecord } from "./users.js";
import { ChatAccessDenied } from "./session-ownership.js";

/** Re-read the login/account instead of trusting a cached browser principal or role. */
export function requireAccountActor(database: Database, principal: AuthenticatedPrincipal, options: { admin?: boolean; recent?: boolean } = {}): UserRecord {
  if (principal.mode !== "single-user" || principal.kind !== "user" || !principal.authentication.sessionId) throw new ChatAccessDenied();
  const user = getUser(database, principal.userId);
  const login = database.query("SELECT user_id,created_at,expires_at,auth_method FROM web_sessions WHERE session_id=?")
    .get(principal.authentication.sessionId) as { user_id: string; created_at: string; expires_at: string; auth_method: string } | null;
  if (!user?.enabled || user.role !== principal.role || !login || login.user_id !== user.id
    || !Number.isFinite(Date.parse(login.expires_at)) || Date.parse(login.expires_at) <= Date.now()) throw new ChatAccessDenied();
  if (options.admin && user.role !== "admin") throw new ChatAccessDenied();
  if (options.recent) {
    const age = Date.now() - Date.parse(login.created_at);
    if (!Number.isFinite(age) || age < 0 || age > 5 * 60_000 || !["totp", "passkey"].includes(login.auth_method)) throw new ChatAccessDenied();
  }
  return user;
}
