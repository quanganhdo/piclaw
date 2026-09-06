import type Database from "bun:sqlite";
import type { AuthenticatedPrincipal } from "../core/access-types.js";
import { requireAccountActor } from "../db/account-administration.js";
import { ChatAccessDenied, getRootOwnership } from "../db/session-ownership.js";
import { getUser, updateUser } from "../db/users.js";
import { createUuid } from "../utils/ids.js";
import { AccountInvitations } from "./account-invitations.js";

/** Reset another account without reading its factors or changing its session ownership. */
export function resetFamilyAccount(database: Database, actor: AuthenticatedPrincipal, targetId: string, confirmation: string, method: 'totp' | 'passkey' = 'totp'): { token: string; expiresAt: number; method: 'totp' | 'passkey' } {
  return database.transaction(() => {
    requireAccountActor(database, actor, { admin: true, recent: true });
    const target = getUser(database, targetId);
    if (!target || actor.userId === targetId || confirmation !== target.username) throw new ChatAccessDenied();
    const root = target.home_chat_jid ? getRootOwnership(database, target.home_chat_jid) : null;
    if (!root || root.ownerUserId !== target.id || root.rootChatJid !== target.home_chat_jid) throw new ChatAccessDenied();
    // Last-enabled-admin guard is applied before destructive changes.
    updateUser(database, targetId, { enabled: false });
    database.query("DELETE FROM web_sessions WHERE user_id=?").run(targetId);
    database.query("DELETE FROM user_totp_factors WHERE user_id=?").run(targetId);
    database.query("DELETE FROM webauthn_credentials WHERE user_id=?").run(targetId);
    database.query("DELETE FROM user_totp_enrolments WHERE user_id=?").run(targetId);
    database.query("DELETE FROM webauthn_enrollments WHERE user_id=?").run(targetId);
    database.query("DELETE FROM user_passkey_registrations WHERE user_id=?").run(targetId);
    database.query("DELETE FROM user_auth_invitations WHERE user_id=? OR issuer_user_id=?").run(targetId, targetId);
    const grant = new AccountInvitations(database).issue(actor, targetId, method);
    database.query("INSERT INTO account_recovery_events(id,actor_user_id,target_user_id,event,created_at) VALUES (?,?,?,'admin_reset',?)")
      .run(createUuid("recovery"), actor.userId, targetId, new Date().toISOString());
    return grant;
  }).immediate();
}
