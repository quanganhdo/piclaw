import { afterEach, beforeEach, expect, test } from 'bun:test';
import '../helpers.js';
import { getDb, initDatabase, closeDatabase } from '../../src/db/connection.js';
import { getUser } from '../../src/db/users.js';
import { createWebSession } from '../../src/db/web-sessions.js';
import { provisionFamilyAccount, updateManagedAccount, readAdminSecurity, revokeAdminSecurity } from '../../src/db/account-administration.js';
import { resolveRequestPrincipal } from '../../src/channels/web/auth/principal.js';
import { RequestRouterService } from '../../src/channels/web/request-router-service.js';
import { WebAuthGateway } from '../../src/channels/web/auth/auth-gateway.js';
import { TotpFailureTracker } from '../../src/channels/web/auth/totp-failure-tracker.js';
import { WebauthnChallengeTracker } from '../../src/channels/web/auth/webauthn-challenges.js';
import { resetRateLimiterStateForTests } from '../../src/channels/web/http/rate-limit.js';

const policy = { totp: true, passkey: true, rpId: 'family.local' };
function actor(id: string) {
  const login = createWebSession(`token-${id}`, id, 3600, 'passkey');
  return resolveRequestPrincipal(new Request('https://family.local', { headers: { cookie: 'piclaw_session=fixture' } }), { mode: 'family-shared', authEnabled: true }, {
    getSession: () => login, getUser: () => getUser(getDb(), id), getLocalDisplayName: () => 'Unused',
  })!;
}
let admin: ReturnType<typeof actor>, alice: ReturnType<typeof actor>, bob: ReturnType<typeof actor>;
beforeEach(() => {
  closeDatabase(); initDatabase(); resetRateLimiterStateForTests(); admin = actor('default');
  const users = ['alice', 'bob'].map(name => {
    const user = provisionFamilyAccount(getDb(), admin, { username: name, displayName: name });
    for (const suffix of ['1', '2']) getDb().query("INSERT INTO webauthn_credentials(user_id,rp_id,credential_id,public_key,label) VALUES (?,'family.local',?,'public-key',?)").run(user.id, name+suffix, name+' key '+suffix);
    updateManagedAccount(getDb(), admin, user.id, { enabled: true }, policy); return actor(user.id);
  });
  [alice, bob] = users as [typeof alice, typeof bob];
});
afterEach(() => { closeDatabase(); resetRateLimiterStateForTests(); });

test('explicit recent-admin security view returns only selected metadata and denies member/self/stale', () => {
  const db = getDb(), view = readAdminSecurity(db, admin, alice.userId, policy), json = JSON.stringify(view);
  expect(view.user.id).toBe(alice.userId); expect(view.factors.passkeys).toHaveLength(2); expect(view.sessions).toHaveLength(1);
  expect(view.factors.passkeys[0]?.label).toBe('alice key 1');
  for (const hidden of [bob.userId, 'public-key', 'public_key', 'token-', 'home_chat_jid', 'ciphertext', 'sign_count']) expect(json).not.toContain(hidden);
  for (const who of [alice, bob]) expect(() => readAdminSecurity(db, who, alice.userId, policy)).toThrow();
  expect(() => readAdminSecurity(db, admin, admin.userId, policy)).toThrow();
  expect(() => readAdminSecurity(db, admin, 'missing', policy)).toThrow();
  db.query('UPDATE web_sessions SET created_at=? WHERE session_id=?').run(new Date(Date.now()-600_000).toISOString(), admin.authentication.sessionId!);
  expect(() => readAdminSecurity(db, admin, alice.userId, policy)).toThrow();
});

test('device revocation selects target and item exactly, removes pending grants, and audits the acting admin', () => {
  const db = getDb(); const other = createWebSession('other-alice', alice.userId, 3600, 'passkey');
  db.query("INSERT INTO user_passkey_registrations(token_hash,user_id,session_id,rp_id,origin,challenge,expires_at) VALUES ('pending',?,?,'family.local','https://family.local','c',?)").run(alice.userId, other.session_id, Date.now()+60000);
  db.query("INSERT INTO user_totp_registrations(user_id,registration_id,session_id,origin,expires_at) VALUES (?,'pending',?,'https://family.local',?)").run(alice.userId, other.session_id, Date.now()+60000);
  const input = { kind: 'session' as const, item_id: other.session_id, confirm_username: 'alice' };
  expect(() => revokeAdminSecurity(db, admin, alice.userId, { ...input, item_id: bob.authentication.sessionId! }, policy)).toThrow();
  expect(() => revokeAdminSecurity(db, admin, alice.userId, { ...input, confirm_username: 'bob' }, policy)).toThrow();
  expect(() => revokeAdminSecurity(db, alice, alice.userId, input, policy)).toThrow();
  revokeAdminSecurity(db, admin, alice.userId, input, policy);
  expect(readAdminSecurity(db, admin, alice.userId, policy).sessions.map(s => s.session_id)).toEqual([alice.authentication.sessionId!]);
  expect(db.query('SELECT * FROM user_totp_registrations').all()).toHaveLength(0); expect(db.query('SELECT * FROM user_passkey_registrations').all()).toHaveLength(0);
  expect(db.query('SELECT actor_user_id,target_user_id,kind,item_id FROM account_security_events').get()).toEqual({ actor_user_id: admin.userId, target_user_id: alice.userId, kind: 'session', item_id: other.session_id });
  expect(() => revokeAdminSecurity(db, admin, alice.userId, input, policy)).toThrow();
  expect(readAdminSecurity(db, admin, bob.userId, policy).sessions).toHaveLength(1);
});

test('factor revocation preserves last usable factor and account ownership, revokes all target logins, and audit failures roll back', () => {
  const db = getDb(), before = getUser(db, alice.userId);
  const input = { kind: 'passkey' as const, item_id: 'alice1', confirm_username: 'alice' };
  db.exec("CREATE TRIGGER fail_security_audit BEFORE INSERT ON account_security_events BEGIN SELECT RAISE(ABORT,'audit failure'); END");
  expect(() => revokeAdminSecurity(db, admin, alice.userId, input, policy)).toThrow('audit failure');
  expect(readAdminSecurity(db, admin, alice.userId, policy).factors.passkeys).toHaveLength(2); expect(readAdminSecurity(db, admin, alice.userId, policy).sessions).toHaveLength(1);
  db.exec('DROP TRIGGER fail_security_audit');
  revokeAdminSecurity(db, admin, alice.userId, input, policy);
  expect(getUser(db, alice.userId)).toEqual(before); expect(readAdminSecurity(db, admin, alice.userId, policy).sessions).toHaveLength(0);
  expect(readAdminSecurity(db, admin, alice.userId, policy).factors.passkeys[0]?.removable).toBe(false);
  expect(() => revokeAdminSecurity(db, admin, alice.userId, { ...input, item_id: 'alice2' }, policy)).toThrow('last configured');
  expect(db.query('SELECT * FROM account_security_events').all()).toHaveLength(1);
  db.query("INSERT INTO webauthn_credentials(user_id,rp_id,credential_id,public_key) VALUES (?,'other.local','other-rp','key')").run(alice.userId);
  expect(() => revokeAdminSecurity(db, admin, alice.userId, { ...input, item_id: 'alice2' }, policy)).toThrow('last configured');
  expect(readAdminSecurity(db, admin, alice.userId, policy).factors.passkeys.find(k => k.credential_id === 'other-rp')?.removable).toBe(true);
});

test('TOTP policy, strict revocation input and disabled-account factors keep protections', () => {
  const db = getDb(); db.query("INSERT INTO user_totp_factors(user_id,ciphertext,salt,nonce,revision,last_used_step,created_at) VALUES (?,?,?,?,?,-1,'now')")
    .run(alice.userId, new Uint8Array([1]), new Uint8Array([2]), new Uint8Array([3]), 'rev');
  expect(() => revokeAdminSecurity(db, admin, alice.userId, { kind: 'totp', confirm_username: 'alice', item_id: 'wrong' } as any, policy)).toThrow();
  expect(() => revokeAdminSecurity(db, admin, alice.userId, { kind: 'unknown', confirm_username: 'alice' } as any, policy)).toThrow();
  expect(() => revokeAdminSecurity(db, admin, alice.userId, { kind: 'totp', confirm_username: 'alice' }, { ...policy, passkey: false })).toThrow('last configured');
  updateManagedAccount(db, admin, alice.userId, { enabled: false }, policy);
  revokeAdminSecurity(db, admin, alice.userId, { kind: 'totp', confirm_username: 'alice' }, policy);
  expect(readAdminSecurity(db, admin, alice.userId, policy).factors.totp.enrolled).toBe(false);
  expect(getUser(db, alice.userId)?.enabled).toBe(false);
});

test('HTTP security routes require recent admin, pins, Origin, exact confirmation and never open foreign timeline', async () => {
  const json = (value: unknown, status=200) => Response.json(value, { status });
  const authGateway = new WebAuthGateway({ accessMode: 'family-shared', passkeyMode: '', totpSecret: '', internalSecret: '', hasTls: true, sessionTtlSeconds: 3600 }, { json, challenges: new WebauthnChallengeTracker(), failureTracker: new TotpFailureTracker() });
  const router = new RequestRouterService({ json, authGateway } as any, 'family-shared');
  const req = (path: string, method = 'GET', body?: unknown, who=admin, origin='https://family.local', pin=who.userId) => router.handle(new Request('https://family.local'+path, { method, headers: { cookie: `piclaw_session=token-${who.userId}`, origin, 'x-piclaw-account-id': pin, 'x-piclaw-login-id': who.authentication.sessionId! }, ...(body ? { body: JSON.stringify(body) } : {}) }));
  const path = `/admin/users/${alice.userId}/security`, input = { kind: 'passkey', item_id: 'alice1', confirm_username: 'alice' };
  const response = await req(path); expect(response.status).toBe(200); expect(response.headers.get('cache-control')).toBe('private, no-store'); expect(response.headers.get('vary')).toContain('Cookie');
  expect((await req(path, 'GET', undefined, bob)).status).toBe(403); expect((await req(path+'?user_id=bob')).status).toBe(403);
  expect((await req(path, 'GET', undefined, admin, 'https://family.local', bob.userId)).status).toBe(409);
  for (const origin of ['', 'https://foreign.local']) expect((await req(path+'/revoke', 'POST', input, admin, origin)).status).toBe(403);
  expect((await req(path+'/revoke', 'POST', { ...input, actor_user_id: admin.userId })).status).toBe(403);
  expect((await req('/timeline?chat_jid='+alice.homeChatJid)).status).toBe(403);
  expect((await req(path+'/revoke', 'POST', input)).status).toBe(200);
  expect((await req(path+'/revoke', 'POST', input)).status).toBe(403);
});
