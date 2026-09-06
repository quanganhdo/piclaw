import type Database from 'bun:sqlite';
import { createHash, randomBytes } from 'node:crypto';
import { readAccessState } from '../db/access-state.js';
import { getRootOwnership } from '../db/session-ownership.js';
import { getUser } from '../db/users.js';
import { createUuid } from '../utils/ids.js';

export interface OperatorRecoveryInput { userId: string; username: string; method: 'totp' | 'passkey'; origin: string }

/** Offline caller only. No synthetic principal, role change, home adoption or activation. */
export function inspectOperatorRecovery(database: Database, input: OperatorRecoveryInput) {
  if (readAccessState(database).activatedMode !== 'family-shared') throw new Error('Recovery requires an already-migrated family store. No activation is performed.');
  const url = new URL(input.origin);
  if (url.protocol !== 'https:' || url.origin !== input.origin || url.username || url.password || !['totp','passkey'].includes(input.method)) throw new Error('Choose a factor method and exact HTTPS origin without path, credentials, query or fragment.');
  const user = getUser(database, input.userId);
  if (!user || user.username !== input.username || user.role !== 'admin') throw new Error('Exact existing administrator ID and username required.');
  const root = user.home_chat_jid ? getRootOwnership(database, user.home_chat_jid) : null;
  if (!root || root.ownerUserId !== user.id || root.rootChatJid !== user.home_chat_jid) throw new Error('Administrator must have an active already-owned home. Repair migration separately.');
  return { user_id: user.id, username: user.username, enabled: user.enabled, method: input.method, origin: input.origin,
    passkeys: (database.query('SELECT count(*) n FROM webauthn_credentials WHERE user_id=?').get(user.id) as {n:number}).n,
    totp: Boolean(database.query('SELECT 1 FROM user_totp_factors WHERE user_id=?').get(user.id)),
    logins: (database.query('SELECT count(*) n FROM web_sessions WHERE user_id=?').get(user.id) as {n:number}).n };
}

/** Requires caller-held offline runtime + SQLite locks and verified backup. Deliberately not a web/tool API. */
export function issueOperatorRecovery(database: Database, input: OperatorRecoveryInput, writeGrant: (grant: { url: string; expires_at: number }) => void): { recovery_id: string; user_id: string } {
  return database.transaction(() => {
    inspectOperatorRecovery(database, input);
    const id = createUuid('operator-recovery'), now = Date.now(), token = randomBytes(32).toString('base64url');
    database.query('INSERT INTO operator_recovery_events(id,target_user_id,method,origin,created_at) VALUES (?,?,?,?,?)')
      .run(id, input.userId, input.method, input.origin, new Date(now).toISOString());
    // Only this explicit offline path can disable the final administrator, replacing lost factors with a restricted grant.
    database.query('UPDATE users SET enabled=0,updated_at=? WHERE id=?').run(new Date(now).toISOString(), input.userId);
    for (const table of ['web_sessions','user_totp_registrations','user_totp_factors','webauthn_credentials','user_totp_enrolments','webauthn_enrollments','user_passkey_registrations']) {
      database.query(`DELETE FROM ${table} WHERE user_id=?`).run(input.userId);
    }
    database.query('DELETE FROM user_auth_invitations WHERE user_id=? OR issuer_user_id=?').run(input.userId,input.userId);
    database.query(`INSERT INTO user_auth_invitations(token_hash,user_id,issuer_user_id,expires_at,state,created_at,method,recovery_event_id,expected_origin)
      VALUES (?,?,?,?,'issued',?,?,?,?)`).run(createHash('sha256').update(token).digest('hex'),input.userId,input.userId,now+15*60_000,new Date(now).toISOString(),input.method,id,input.origin);
    writeGrant({ url: `${input.origin}/auth/invitation#token=${token}&method=${input.method}`, expires_at: now+15*60_000 });
    return { recovery_id: id, user_id: input.userId };
  }).immediate();
}
