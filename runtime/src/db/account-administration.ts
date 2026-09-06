import type Database from "bun:sqlite";
import type { AuthenticatedPrincipal } from "../core/access-types.js";
import type { AccountSettings } from "../core/account-settings.js";
import type { AdministrationSettings } from "../core/administration-settings.js";
import type { AdminSecurity, AdminSecurityRevocation } from '../core/admin-security.js';
import { createUuid } from "../utils/ids.js";
import { createUser, getUser, listUsers, updateUser, type CreateUserInput, type UpdateUserInput, type UserRecord } from "./users.js";
import { ChatAccessDenied, getRootOwnership, provisionUserHome } from "./session-ownership.js";

export interface FactorPolicy { totp: boolean; passkey: boolean; rpId: string }

/** Re-read the login/account instead of trusting a cached browser principal or role. */
export function requireAccountActor(database: Database, principal: AuthenticatedPrincipal, options: { admin?: boolean; recent?: boolean } = {}): UserRecord {
  if (principal.mode !== "family-shared" || principal.kind !== "user" || !principal.authentication.sessionId) throw new ChatAccessDenied();
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

function factorCount(database: Database, userId: string, policy: FactorPolicy): number {
  const totp = policy.totp ? (database.query("SELECT count(*) AS n FROM user_totp_factors WHERE user_id=?").get(userId) as { n: number }).n : 0;
  const passkeys = policy.passkey ? (database.query("SELECT count(*) AS n FROM webauthn_credentials WHERE user_id=? AND rp_id=?").get(userId, policy.rpId) as { n: number }).n : 0;
  return totp + passkeys;
}

/** One consistent snapshot of this account; no selector, secrets or other-user inventory. */
export function readOwnAccountSettings(database: Database, principal: AuthenticatedPrincipal, policy: FactorPolicy): AccountSettings {
  return database.transaction(() => {
    const user = requireAccountActor(database, principal);
    let recent = true;
    try { requireAccountActor(database, principal, { recent: true }); }
    catch (error) { if (!(error instanceof ChatAccessDenied)) throw error; recent = false; }
    const usableCount = factorCount(database, user.id, policy);
    const totp = Boolean(database.query("SELECT 1 FROM user_totp_factors WHERE user_id=?").get(user.id));
    const keys = database.query("SELECT credential_id,label,rp_id,created_at,last_used_at FROM webauthn_credentials WHERE user_id=? ORDER BY created_at,credential_id")
      .all(user.id) as { credential_id: string; label: string; rp_id: string; created_at: string; last_used_at: string | null }[];
    const sessions = listOwnSessions(database, principal) as Omit<AccountSettings["sessions"][number], "current">[];
    return {
      user: { id: user.id, username: user.username, display_name: user.display_name }, recent_auth: recent,
      capabilities: { update_profile: recent, register_passkey: recent && policy.passkey, enrol_totp: recent && policy.totp && !totp, revoke_session: recent, label_security_item: recent },
      factors: {
        totp: { enrolled: totp, removable: recent && totp && usableCount - Number(policy.totp) > 0 },
        passkeys: keys.map(({ rp_id, ...key }) => {
          const usable = policy.passkey && rp_id === policy.rpId;
          return { ...key, usable, removable: recent && usableCount - Number(usable) > 0 };
        }),
      },
      sessions: sessions.map(session => ({ ...session, current: session.session_id === principal.authentication.sessionId })),
    };
  })();
}

export function listManagedAccounts(database: Database, principal: AuthenticatedPrincipal): UserRecord[] {
  requireAccountActor(database, principal, { admin: true });
  return listUsers(database);
}

/** Admin eligibility hints share the write-time policy, but grant no right to content. */
export function readAdministrationSettings(database: Database, principal: AuthenticatedPrincipal, policy: FactorPolicy): AdministrationSettings {
  return database.transaction(() => {
    requireAccountActor(database, principal, { admin: true });
    let recent = true;
    try { requireAccountActor(database, principal, { admin: true, recent: true }); }
    catch (error) { if (!(error instanceof ChatAccessDenied)) throw error; recent = false; }
    const users = listUsers(database), admins = users.filter(user => user.enabled && user.role === 'admin').length;
    return { recent_auth: recent, capabilities: { create_user: recent }, users: users.map((user): AdministrationSettings['users'][number] => {
      let homeValid = false;
      try {
        const home = user.home_chat_jid ? getRootOwnership(database, user.home_chat_jid) : null;
        homeValid = home?.ownerUserId === user.id && home.rootChatJid === user.home_chat_jid;
      } catch (error) { if (!(error instanceof ChatAccessDenied)) throw error; }
      const hasFactors = Boolean(database.query('SELECT 1 FROM user_totp_factors WHERE user_id=?').get(user.id)
        || database.query('SELECT 1 FROM webauthn_credentials WHERE user_id=?').get(user.id));
      const invitation = database.query('SELECT state FROM user_auth_invitations WHERE user_id=? AND expires_at>?').get(user.id, Date.now()) as { state: 'issued' | 'claimed' } | null;
      const protectedAdmin = user.enabled && user.role === 'admin' && admins <= 1;
      return { id: user.id, username: user.username, display_name: user.display_name, role: user.role, enabled: user.enabled,
        invitation: invitation?.state ?? 'none', capabilities: {
          disable: recent && user.enabled && !protectedAdmin,
          enable: recent && !user.enabled && homeValid && factorCount(database, user.id, policy) > 0,
          change_role: recent && !protectedAdmin,
          invite: recent && policy.totp && !user.enabled && homeValid && !hasFactors,
          invite_passkey: recent && policy.passkey && !user.enabled && homeValid && !hasFactors,
          revoke_invitation: recent && Boolean(invitation),
          reset: recent && policy.totp && user.id !== principal.userId && !protectedAdmin && homeValid,
          reset_passkey: recent && policy.passkey && user.id !== principal.userId && !protectedAdmin && homeValid,
          inspect_security: recent && user.id !== principal.userId,
          assign_home: recent && user.id !== principal.userId,
          restrict_tools: recent,
        },
      };
    }) };
  })();
}

/** Disabled user, stable home root and namespace appear together or not at all. */
export function provisionFamilyAccount(database: Database, principal: AuthenticatedPrincipal, input: CreateUserInput): UserRecord {
  return database.transaction(() => {
    requireAccountActor(database, principal, { admin: true, recent: true });
    const user = createUser(database, input);
    const jid = `web:user:${user.id}`;
    const branchId = createUuid("branch");
    const now = new Date().toISOString();
    database.query("INSERT INTO chats(jid,name,last_message_time) VALUES (?,?,?)").run(jid, user.display_name, now);
    database.query(`INSERT INTO chat_branches(branch_id,chat_jid,root_chat_jid,parent_branch_id,agent_name,created_at,updated_at,archived_at,handle_owner_id)
      VALUES (?,?,?,NULL,?,?,?,NULL,?)`).run(branchId, jid, jid, "home", now, now, user.id);
    provisionUserHome(database, user.id, jid);
    return getUser(database, user.id)!;
  }).immediate();
}

/** Role/enable transitions are serialized with factor/home checks and revocation. */
export function updateManagedAccount(database: Database, principal: AuthenticatedPrincipal, userId: string, patch: UpdateUserInput, policy: FactorPolicy): UserRecord {
  return database.transaction(() => {
    requireAccountActor(database, principal, { admin: true, recent: true });
    const current = getUser(database, userId);
    if (!current) throw new ChatAccessDenied();
    if (patch.enabled === true) {
      const home = current.home_chat_jid ? getRootOwnership(database, current.home_chat_jid) : null;
      if (!home || home.ownerUserId !== current.id || home.rootChatJid !== current.home_chat_jid || factorCount(database, current.id, policy) === 0) {
        throw new Error("An active owned home and a configured authentication factor are required.");
      }
    }
    const updated = updateUser(database, userId, patch)!;
    if (patch.enabled === false || updated.enabled !== current.enabled || updated.role !== current.role) {
      database.query("DELETE FROM web_sessions WHERE user_id=?").run(userId);
      database.query("DELETE FROM user_totp_enrolments WHERE user_id=?").run(userId);
      database.query("DELETE FROM webauthn_enrollments WHERE user_id=?").run(userId);
      database.query("DELETE FROM user_auth_invitations WHERE user_id=? OR issuer_user_id=?").run(userId, userId);
      database.query("DELETE FROM user_passkey_registrations WHERE user_id=?").run(userId);
    }
    return updated;
  }).immediate();
}

export function updateOwnAccount(database: Database, principal: AuthenticatedPrincipal, patch: Pick<UpdateUserInput, "displayName" | "username">): UserRecord {
  return database.transaction(() => {
    const user = requireAccountActor(database, principal, { recent: true });
    if (!patch || typeof patch !== "object" || Array.isArray(patch) || Object.keys(patch).some(key => !["displayName", "username"].includes(key))) throw new ChatAccessDenied();
    return updateUser(database, user.id, patch)!;
  }).immediate();
}

export function listOwnSessions(database: Database, principal: AuthenticatedPrincipal): unknown[] {
  requireAccountActor(database, principal);
  return database.query("SELECT session_id,label,auth_method,created_at,expires_at FROM web_sessions WHERE user_id=? AND expires_at>? ORDER BY created_at DESC")
    .all(principal.userId, new Date().toISOString());
}

export function revokeOwnSession(database: Database, principal: AuthenticatedPrincipal, sessionId: string): void {
  database.transaction(() => {
    requireAccountActor(database, principal, { recent: true });
    // Same response for absent/foreign devices; never disclose their owner.
    database.query("DELETE FROM web_sessions WHERE user_id=? AND session_id=?").run(principal.userId, sessionId);
    database.query("DELETE FROM user_passkey_registrations WHERE user_id=? AND session_id=?").run(principal.userId, sessionId);
  }).immediate();
}

/** Factor metadata excludes secrets, public keys and bearer material. */
export function listOwnFactors(database: Database, principal: AuthenticatedPrincipal): { totp: boolean; passkeys: unknown[] } {
  requireAccountActor(database, principal);
  return {
    totp: Boolean(database.query("SELECT 1 FROM user_totp_factors WHERE user_id=?").get(principal.userId)),
    passkeys: database.query("SELECT credential_id,label,created_at,last_used_at FROM webauthn_credentials WHERE user_id=? ORDER BY created_at").all(principal.userId),
  };
}

/** Removal cannot leave an enabled user without a factor permitted by current auth policy. */
export function removeOwnFactor(database: Database, principal: AuthenticatedPrincipal, factor: { kind: "totp" | "passkey"; credentialId?: string }, policy: FactorPolicy): void {
  database.transaction(() => {
    const user = requireAccountActor(database, principal, { recent: true });
    removeAccountFactor(database, user.id, factor, policy);
  }).immediate();
}

/** Called only inside an already-authorised write transaction. */
function removeAccountFactor(database: Database, userId: string, factor: { kind: 'totp' | 'passkey'; credentialId?: string }, policy: FactorPolicy): void {
    let removed: number;
    if (factor.kind === "totp") {
      removed = database.query("DELETE FROM user_totp_factors WHERE user_id=?").run(userId).changes;
    } else if (factor.kind === "passkey" && factor.credentialId) {
      removed = database.query("DELETE FROM webauthn_credentials WHERE user_id=? AND credential_id=?").run(userId, factor.credentialId).changes;
    } else throw new ChatAccessDenied();
    if (!removed) throw new ChatAccessDenied();
    if (factorCount(database, userId, policy) === 0) throw new Error("Cannot remove the last configured authentication factor.");
    database.query("DELETE FROM web_sessions WHERE user_id=?").run(userId);
    database.query("DELETE FROM user_totp_enrolments WHERE user_id=?").run(userId);
    database.query("DELETE FROM webauthn_enrollments WHERE user_id=?").run(userId);
    database.query("DELETE FROM user_auth_invitations WHERE user_id=? OR issuer_user_id=?").run(userId, userId);
    database.query("DELETE FROM user_passkey_registrations WHERE user_id=?").run(userId);
}

function requireAdminSecurityTarget(database: Database, actor: AuthenticatedPrincipal, userId: string): UserRecord {
  requireAccountActor(database, actor, { admin: true, recent: true });
  const user = getUser(database, userId);
  if (!user || user.id === actor.userId) throw new ChatAccessDenied();
  return user;
}

export function readAdminSecurity(database: Database, actor: AuthenticatedPrincipal, userId: string, policy: FactorPolicy): AdminSecurity {
  return database.transaction(() => {
    const user = requireAdminSecurityTarget(database, actor, userId), count = factorCount(database, userId, policy);
    const totp = Boolean(database.query('SELECT 1 FROM user_totp_factors WHERE user_id=?').get(userId));
    const keys = database.query('SELECT credential_id,label,rp_id,created_at,last_used_at FROM webauthn_credentials WHERE user_id=? ORDER BY created_at,credential_id')
      .all(userId) as { credential_id: string; label: string; rp_id: string; created_at: string; last_used_at: string | null }[];
    return { user: { id: user.id, username: user.username, display_name: user.display_name, enabled: user.enabled },
      factors: { totp: { enrolled: totp, removable: totp && count - Number(policy.totp) > 0 }, passkeys: keys.map(({ rp_id, ...key }) => {
        const usable = policy.passkey && rp_id === policy.rpId;
        return { ...key, usable, removable: count - Number(usable) > 0 };
      }) },
      sessions: database.query('SELECT session_id,label,auth_method,created_at,expires_at FROM web_sessions WHERE user_id=? AND julianday(expires_at)>julianday(?) ORDER BY created_at DESC')
        .all(userId, new Date().toISOString()) as AdminSecurity['sessions'],
    };
  })();
}

/** Acting administrator stays distinct from target; never manufacture a target principal. */
export function revokeAdminSecurity(database: Database, actor: AuthenticatedPrincipal, userId: string, input: AdminSecurityRevocation, policy: FactorPolicy): void {
  database.transaction(() => {
    const user = requireAdminSecurityTarget(database, actor, userId);
    if (!input || input.confirm_username !== user.username || !['session', 'passkey', 'totp'].includes(input.kind)) throw new ChatAccessDenied();
    if (Object.keys(input).some(key => !(input.kind === 'totp' ? ['kind', 'confirm_username'] : ['kind', 'confirm_username', 'item_id']).includes(key))) throw new ChatAccessDenied();
    if (input.kind !== 'totp' && (typeof input.item_id !== 'string' || !/^[a-zA-Z0-9_-]+$/.test(input.item_id))) throw new ChatAccessDenied();
    if (input.kind === 'session') {
      const removed = database.query('DELETE FROM web_sessions WHERE user_id=? AND session_id=? RETURNING session_id').get(userId, input.item_id);
      if (!removed) throw new ChatAccessDenied();
      database.query('DELETE FROM user_passkey_registrations WHERE user_id=? AND session_id=?').run(userId, input.item_id);
    } else removeAccountFactor(database, userId, input.kind === 'totp' ? { kind: 'totp' } : { kind: 'passkey', credentialId: input.item_id }, policy);
    database.query('INSERT INTO account_security_events(id,actor_user_id,target_user_id,kind,item_id,created_at) VALUES (?,?,?,?,?,?)')
      .run(createUuid('security'), actor.userId, userId, input.kind, input.kind === 'totp' ? null : input.item_id, new Date().toISOString());
  }).immediate();
}
