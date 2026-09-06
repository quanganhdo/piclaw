import { afterEach, beforeEach, expect, test } from 'bun:test';
import { createHmac } from 'node:crypto';
import Database from 'bun:sqlite';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { closeDatabase, getDb, initDatabase } from '../../src/db/connection.js';
import { getUser } from '../../src/db/users.js';
import { createWebSession } from '../../src/db/web-sessions.js';
import { provisionFamilyAccount, updateManagedAccount, revokeOwnSession, readOwnAccountSettings } from '../../src/db/account-administration.js';
import { resolveRequestPrincipal } from '../../src/channels/web/auth/principal.js';
import { UserAuthFactors } from '../../src/secure/user-auth-factors.js';
import { FamilyTotp } from '../../src/secure/family-totp.js';
import { pruneExpiredAuthState } from '../../src/db/auth-maintenance.js';
import { setEnv } from '../helpers.js';
import { RequestRouterService } from '../../src/channels/web/request-router-service.js';
import { WebAuthGateway } from '../../src/channels/web/auth/auth-gateway.js';
import { TotpFailureTracker } from '../../src/channels/web/auth/totp-failure-tracker.js';
import { WebauthnChallengeTracker } from '../../src/channels/web/auth/webauthn-challenges.js';
import { resetRateLimiterStateForTests } from '../../src/channels/web/http/rate-limit.js';

const origin = 'https://family.local', policy = { totp: true, passkey: true, rpId: 'family.local' };
const code = (secret: string, time = Date.now()) => {
  const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567'; let bits = 0, buffer = 0; const bytes: number[] = [];
  for (const c of secret) { buffer = (buffer << 5) | alphabet.indexOf(c); bits += 5; if (bits >= 8) { bits -= 8; bytes.push((buffer >> bits) & 255); } }
  const counter = Buffer.alloc(8); counter.writeBigUInt64BE(BigInt(Math.floor(time / 30_000)));
  const digest = createHmac('sha1', Buffer.from(bytes)).update(counter).digest();
  return (digest.readUInt32BE(digest[digest.length-1]! & 15) % 0x80000000 % 1_000_000).toString().padStart(6, '0');
};
function actor(id: string, token = `token-${id}`) {
  const session = createWebSession(token, id, 3600, 'passkey');
  return resolveRequestPrincipal(new Request(origin, { headers: { cookie: 'piclaw_session=fixture' } }), { mode: 'family-shared', authEnabled: true }, {
    getSession: () => session, getUser: () => getUser(getDb(), id), getLocalDisplayName: () => 'Unused',
  })!;
}
let alice: ReturnType<typeof actor>, bob: ReturnType<typeof actor>, admin: ReturnType<typeof actor>, restore: () => void;
const factors = () => new UserAuthFactors(getDb(), () => 'totp-self-test-key');
const service = () => new FamilyTotp(getDb(), factors());
beforeEach(() => {
  resetRateLimiterStateForTests();
  restore = setEnv({ PICLAW_KEYCHAIN_KEY: 'totp-self-test-key' }); closeDatabase(); initDatabase(); admin = actor('default');
  const users = ['alice', 'bob'].map(username => {
    const user = provisionFamilyAccount(getDb(), admin, { username, displayName: username });
    getDb().query("INSERT INTO webauthn_credentials(user_id,rp_id,credential_id,public_key) VALUES (?,'family.local',?,'key')").run(user.id, username);
    updateManagedAccount(getDb(), admin, user.id, { enabled: true }, policy); return actor(user.id);
  });
  [alice, bob] = users as [typeof alice, typeof bob];
});
afterEach(() => { closeDatabase(); restore(); resetRateLimiterStateForTests(); });

test('self TOTP stores hashes/ciphertext, binds login/origin and confirms once without replacing passkeys or issuing login', async () => {
  const db = getDb(), started = await service().start(alice, origin);
  const before = db.query('SELECT user_id,session_id FROM web_sessions ORDER BY session_id').all();
  const rows = JSON.stringify(db.query('SELECT * FROM user_totp_registrations').all());
  expect(rows).not.toContain(started.token); expect(rows).not.toContain(started.secret);
  expect(Buffer.from((db.query('SELECT ciphertext FROM user_totp_enrolments').get() as any).ciphertext).toString()).not.toContain(started.secret);
  for (const [who, where] of [[bob, origin], [actor(alice.userId, 'other-login'), origin], [alice, 'https://other.local']] as const) {
    await expect(service().confirm(who, where, started.token, code(started.secret))).rejects.toThrow();
  }
  const results = await Promise.all([service().confirm(alice, origin, started.token, code(started.secret)), service().confirm(alice, origin, started.token, code(started.secret))]);
  expect(results.filter(Boolean)).toHaveLength(1);
  expect(db.query('SELECT * FROM user_totp_registrations').all()).toHaveLength(0);
  expect(db.query('SELECT * FROM user_totp_enrolments').all()).toHaveLength(0);
  expect(db.query('SELECT * FROM webauthn_credentials').all()).toHaveLength(2);
  expect(db.query('SELECT session_id FROM web_sessions').all()).toHaveLength(before.length+1);
  expect(readOwnAccountSettings(db, alice, policy).capabilities.enrol_totp).toBe(false);
  await expect(service().start(alice, origin)).rejects.toThrow();
  expect(await factors().verifyLogin('alice', code(started.secret))).toBeNull();
  const future = Date.now()+60_000;
  expect((await new UserAuthFactors(db, () => 'totp-self-test-key', () => future).verifyLogin('alice', code(started.secret, future)))?.userId).toBe(alice.userId);
});

test('cancel and login revocation remove pending ciphertext; expiry prunes reservations', async () => {
  const db = getDb(); let started = await service().start(alice, origin);
  expect(() => service().cancel(bob, origin, started.token)).toThrow();
  service().cancel(alice, origin, started.token);
  expect(db.query('SELECT * FROM user_totp_enrolments').all()).toHaveLength(0);
  started = await service().start(alice, origin); revokeOwnSession(db, alice, alice.authentication.sessionId!);
  expect(db.query('SELECT * FROM user_totp_registrations').all()).toHaveLength(0);
  expect(db.query('SELECT * FROM user_totp_enrolments').all()).toHaveLength(0);
  await expect(service().confirm(alice, origin, started.token, code(started.secret))).rejects.toThrow();
  alice = actor(alice.userId); started = await service().start(alice, origin);
  pruneExpiredAuthState(db, started.expiresAt+1);
  expect(db.query('SELECT * FROM user_totp_registrations').all()).toHaveLength(0);
  expect(db.query('SELECT * FROM user_totp_enrolments').all()).toHaveLength(0);
});

test('reissue resets attempts and a superseded start cannot overwrite the newer ceremony', async () => {
  const db = getDb(); const first = await service().start(alice, origin);
  await Promise.all(Array.from({ length: 6 }, () => service().confirm(alice, origin, first.token, 'invalid')));
  expect(db.query('SELECT attempts FROM user_totp_enrolments').get()).toEqual({ attempts: 5 });
  const second = await service().start(alice, origin);
  expect(db.query('SELECT attempts FROM user_totp_enrolments').get()).toEqual({ attempts: 0 });
  await expect(service().confirm(alice, origin, first.token, code(first.secret))).rejects.toThrow();
  service().cancel(alice, origin, second.token);
  let release!: () => void, entered!: () => void;
  const held = new Promise<void>(r => release = r), waiting = new Promise<void>(r => entered = r);
  const delayed = new FamilyTotp(db, { beginEnrolment: async (userId: string, authorise: any) => { entered(); await held; return factors().beginEnrolment(userId, authorise); } } as UserAuthFactors);
  const pending = delayed.start(alice, origin).then(() => false, () => true); await waiting;
  const current = await service().start(alice, origin); release(); expect(await pending).toBe(true);
  expect(await service().confirm(alice, origin, current.token, code(current.secret))).toBe(true);
});

test('revocation during start or confirm fences asynchronous cryptography and never recreates pending authority', async () => {
  const db = getDb(); let callbacks = 0;
  const revoked = new UserAuthFactors(db, () => { if (++callbacks === 1) revokeOwnSession(db, alice, alice.authentication.sessionId!); return 'totp-self-test-key'; });
  await expect(new FamilyTotp(db, revoked).start(alice, origin)).rejects.toThrow();
  expect(db.query('SELECT * FROM user_totp_enrolments').all()).toHaveLength(0);
  alice = actor(alice.userId); const started = await service().start(alice, origin);
  const confirming = new UserAuthFactors(db, () => { updateManagedAccount(db, admin, alice.userId, { enabled: false }, policy); return 'totp-self-test-key'; });
  expect(await new FamilyTotp(db, confirming).confirm(alice, origin, started.token, code(started.secret))).toBe(false);
  expect(db.query('SELECT * FROM user_totp_factors').all()).toHaveLength(0);
  expect(db.query('SELECT * FROM user_totp_registrations').all()).toHaveLength(0);
});

test('HTTP self setup requires Origin, current/recent account, policy and strict body; QR is returned once without cookies', async () => {
  const json = (value: unknown, status=200) => Response.json(value, { status });
  const router = (totp = 'JBSWY3DPEHPK3PXP') => new RequestRouterService({ json, authGateway: new WebAuthGateway({ accessMode: 'family-shared', passkeyMode: totp ? '' : 'passkey-only', totpSecret: totp, internalSecret: '', sessionTtlSeconds: 3600, hasTls: true }, { json, challenges: new WebauthnChallengeTracker(), failureTracker: new TotpFailureTracker() }) } as any, 'family-shared');
  const req = (path: string, body: unknown, opts: { origin?: string; user?: typeof alice; totp?: string } = {}) => {
    const who = opts.user ?? alice;
    return router(opts.totp).handle(new Request(origin+path, { method: 'POST', headers: { cookie: `piclaw_session=token-${who.userId}`, origin: opts.origin ?? origin, 'x-piclaw-account-id': who.userId, 'x-piclaw-login-id': who.authentication.sessionId! }, body: JSON.stringify(body) }));
  };
  for (const opts of [{ origin: '' }, { origin: 'https://other.local' }, { totp: '', }]) expect((await req('/account/totp/start', {}, opts)).status).toBe(403);
  expect((await req('/account/totp/start', { user_id: bob.userId })).status).toBe(403);
  const response = await req('/account/totp/start', {}); expect(response.status).toBe(200); expect(response.headers.get('set-cookie')).toBeNull(); expect(response.headers.get('cache-control')).toBe('private, no-store');
  const start = await response.json(); expect(start.qr_data_url).toStartWith('data:image/svg+xml;base64,');
  expect((await req('/account/totp/confirm', { token: start.token, code: code(start.secret) }, { user: bob })).status).toBe(403);
  expect((await req('/account/totp/confirm', { token: start.token, code: code(start.secret), extra: true })).status).toBe(403);
  expect((await req('/account/totp/confirm', { token: start.token, code: code(start.secret) })).status).toBe(200);
  expect((await req('/account/totp/start', {})).status).toBe(403);
  getDb().query('UPDATE web_sessions SET created_at=? WHERE session_id=?').run(new Date(Date.now()-600_000).toISOString(), bob.authentication.sessionId!);
  expect((await req('/account/totp/start', {}, { user: bob })).status).toBe(403);
});

test('pending self setup survives database reopen with the same login and expiry, and rolls back finalisation errors', async () => {
  const db = getDb(), started = await service().start(alice, origin);
  db.exec("CREATE TRIGGER fail_self_finish BEFORE DELETE ON user_totp_registrations BEGIN SELECT RAISE(ABORT,'finish failure'); END");
  await expect(service().confirm(alice, origin, started.token, code(started.secret))).rejects.toThrow('finish failure');
  expect(db.query('SELECT * FROM user_totp_factors').all()).toHaveLength(0);
  expect(db.query('SELECT * FROM user_totp_enrolments').all()).toHaveLength(1);
  db.exec('DROP TRIGGER fail_self_finish');
  const dir = mkdtempSync(join(tmpdir(), 'piclaw-totp-reopen-')), path = join(dir, 'auth.sqlite');
  db.query('VACUUM INTO ?').run(path);
  const reopened = new Database(path);
  try {
    const current = new FamilyTotp(reopened, new UserAuthFactors(reopened, () => 'totp-self-test-key'));
    expect(await current.confirm(alice, origin, started.token, code(started.secret))).toBe(true);
    expect(reopened.query('SELECT * FROM user_totp_registrations').all()).toHaveLength(0);
    expect(reopened.query('SELECT * FROM user_totp_factors').all()).toHaveLength(1);
  } finally { reopened.close(); rmSync(dir, { recursive: true, force: true }); }
});
