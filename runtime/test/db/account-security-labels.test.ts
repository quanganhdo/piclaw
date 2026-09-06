import { afterEach, beforeEach, expect, test } from 'bun:test';
import Database from 'bun:sqlite';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import '../helpers.js';
import { getDb, initDatabase, closeDatabase } from '../../src/db/connection.js';
import { getUser } from '../../src/db/users.js';
import { createWebSession } from '../../src/db/web-sessions.js';
import { provisionFamilyAccount, updateManagedAccount, readOwnAccountSettings, listOwnFactors, listOwnSessions, removeOwnFactor, revokeOwnSession } from '../../src/db/account-administration.js';
import { labelOwnSecurityItem } from '../../src/db/account-security-labels.js';
import { initializeAuthLabelsSchema } from '../../src/db/auth-labels-schema.js';
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
    for (const suffix of ['1', '2']) getDb().query("INSERT INTO webauthn_credentials(user_id,rp_id,credential_id,public_key) VALUES (?,'family.local',?,'key')").run(user.id, name+suffix);
    updateManagedAccount(getDb(), admin, user.id, { enabled: true }, policy); return actor(user.id);
  });
  [alice, bob] = users as [typeof alice, typeof bob];
});
afterEach(() => { closeDatabase(); resetRateLimiterStateForTests(); });

test('labels change only owned metadata and keep exact IDs, keys, counters and login authority unchanged', () => {
  const db = getDb();
  const before = db.query("SELECT * FROM webauthn_credentials WHERE credential_id='alice1'").get() as any;
  const loginBefore = db.query('SELECT * FROM web_sessions WHERE session_id=?').get(alice.authentication.sessionId!) as any;
  expect(labelOwnSecurityItem(db, alice, 'passkey', 'alice1', '  Security key  ')).toBe('Security key');
  expect(labelOwnSecurityItem(db, alice, 'session', alice.authentication.sessionId!, 'Tablet')).toBe('Tablet');
  expect(db.query("SELECT * FROM webauthn_credentials WHERE credential_id='alice1'").get()).toEqual({ ...before, label: 'Security key' });
  expect(db.query('SELECT * FROM web_sessions WHERE session_id=?').get(alice.authentication.sessionId!)).toEqual({ ...loginBefore, label: 'Tablet' });
  expect((listOwnFactors(db, alice).passkeys[0] as any).label).toBe('Security key');
  expect((listOwnSessions(db, alice)[0] as any).label).toBe('Tablet');
  expect(readOwnAccountSettings(db, alice, policy).capabilities.label_security_item).toBe(true);
  // Duplicate labels are display-only; removing one key never resolves by label.
  labelOwnSecurityItem(db, alice, 'passkey', 'alice2', 'Security key');
  removeOwnFactor(db, alice, { kind: 'passkey', credentialId: 'alice2' }, policy);
  expect(db.query("SELECT label FROM webauthn_credentials WHERE credential_id='alice1'").get()).toEqual({ label: 'Security key' });
  expect(db.query('SELECT * FROM web_sessions WHERE user_id=?').all(alice.userId)).toHaveLength(0);
  expect((listOwnSessions(db, bob)[0] as any).label).toBe('');
});

test('labels deny foreign/admin/expired targets, stale principals, unknown kind and malformed text', () => {
  const db = getDb();
  for (const who of [alice, admin]) {
    expect(() => labelOwnSecurityItem(db, who, 'passkey', 'bob1', 'stolen')).toThrow();
    expect(() => labelOwnSecurityItem(db, who, 'session', bob.authentication.sessionId!, 'stolen')).toThrow();
  }
  for (const value of [null, 1, {}, 'a'.repeat(81), 'a\nb', 'a\u0000b', 'a\u202Eb']) expect(() => labelOwnSecurityItem(db, alice, 'passkey', 'alice1', value)).toThrow();
  expect(() => labelOwnSecurityItem(db, alice, 'other' as any, 'alice1', 'text')).toThrow();
  expect(() => labelOwnSecurityItem(db, alice, 'passkey', 'missing', 'text')).toThrow();
  expect(labelOwnSecurityItem(db, alice, 'passkey', 'alice1', 'é'.repeat(80))).toHaveLength(80);
  expect(labelOwnSecurityItem(db, alice, 'passkey', 'alice1', '  ')).toBe('');
  const old = createWebSession('old-device', alice.userId, 3600, 'totp');
  db.query("UPDATE web_sessions SET expires_at='2000-01-01' WHERE session_id=?").run(old.session_id);
  expect(() => labelOwnSecurityItem(db, alice, 'session', old.session_id, 'expired')).toThrow();
  db.query('UPDATE web_sessions SET created_at=? WHERE session_id=?').run(new Date(Date.now()-600_000).toISOString(), alice.authentication.sessionId!);
  expect(() => labelOwnSecurityItem(db, alice, 'passkey', 'alice1', 'stale')).toThrow();
  expect(readOwnAccountSettings(db, alice, policy).capabilities.label_security_item).toBe(false);
  alice = actor(alice.userId); revokeOwnSession(db, alice, alice.authentication.sessionId!);
  expect(() => labelOwnSecurityItem(db, alice, 'passkey', 'alice1', 'revoked')).toThrow();
});

test('schema migration is additive/idempotent and labels persist across reopen without orphan rows', () => {
  const legacy = new Database(':memory:');
  try {
    legacy.exec("CREATE TABLE web_sessions(token TEXT PRIMARY KEY,user_id TEXT,session_id TEXT); INSERT INTO web_sessions VALUES ('hash','alice','login'); CREATE TABLE webauthn_credentials(credential_id TEXT PRIMARY KEY,public_key TEXT); INSERT INTO webauthn_credentials VALUES ('key','public');");
    initializeAuthLabelsSchema(legacy); initializeAuthLabelsSchema(legacy);
    expect(legacy.query('SELECT * FROM web_sessions').get()).toEqual({ token: 'hash', user_id: 'alice', session_id: 'login', label: '' });
    expect(legacy.query('SELECT * FROM webauthn_credentials').get()).toEqual({ credential_id: 'key', public_key: 'public', label: '' });
  } finally { legacy.close(); }
  labelOwnSecurityItem(getDb(), alice, 'passkey', 'alice1', 'Laptop');
  labelOwnSecurityItem(getDb(), alice, 'session', alice.authentication.sessionId!, 'Browser');
  const dir = mkdtempSync(join(tmpdir(), 'piclaw-labels-')), file = join(dir, 'labels.sqlite');
  getDb().query('VACUUM INTO ?').run(file); const reopened = new Database(file);
  try {
    initializeAuthLabelsSchema(reopened);
    expect(readOwnAccountSettings(reopened, alice, policy).factors.passkeys.find(k => k.credential_id === 'alice1')?.label).toBe('Laptop');
    expect(readOwnAccountSettings(reopened, alice, policy).sessions[0]?.label).toBe('Browser');
    reopened.query("DELETE FROM webauthn_credentials WHERE credential_id='alice1'").run();
    expect(reopened.query("SELECT label FROM webauthn_credentials WHERE credential_id='alice1'").get()).toBeNull();
  } finally { reopened.close(); rmSync(dir, { recursive: true, force: true }); }
});

test('failed label writes and interrupted schema migration roll back without changing authority', () => {
  const db = getDb(); labelOwnSecurityItem(db, alice, 'passkey', 'alice1', 'Original');
  db.exec("CREATE TRIGGER fail_label BEFORE UPDATE OF label ON webauthn_credentials BEGIN SELECT RAISE(ABORT,'label failure'); END");
  expect(() => labelOwnSecurityItem(db, alice, 'passkey', 'alice1', 'New')).toThrow('label failure');
  expect(readOwnAccountSettings(db, alice, policy).factors.passkeys.find(k => k.credential_id === 'alice1')?.label).toBe('Original');
  expect(listOwnSessions(db, alice)).toHaveLength(1);
  db.exec('DROP TRIGGER fail_label');
  const broken = new Database(':memory:');
  try {
    broken.exec('CREATE TABLE web_sessions(token TEXT PRIMARY KEY)');
    expect(() => initializeAuthLabelsSchema(broken)).toThrow();
    expect((broken.query('PRAGMA table_info(web_sessions)').all() as any[]).some(column => column.name === 'label')).toBe(false);
    broken.exec('CREATE TABLE webauthn_credentials(credential_id TEXT PRIMARY KEY)'); initializeAuthLabelsSchema(broken);
    expect((broken.query('PRAGMA table_info(web_sessions)').all() as any[]).some(column => column.name === 'label')).toBe(true);
  } finally { broken.close(); }
});

test('label PATCH routes enforce strict body, Origin, pins and owner scope without exposing bearer tokens', async () => {
  const json = (body: unknown, status=200) => Response.json(body, { status });
  const authGateway = new WebAuthGateway({ accessMode: 'family-shared', passkeyMode: '', totpSecret: '', internalSecret: '', hasTls: true, sessionTtlSeconds: 3600 }, { json, challenges: new WebauthnChallengeTracker(), failureTracker: new TotpFailureTracker() });
  const router = new RequestRouterService({ json, authGateway } as any, 'family-shared');
  const req = (path: string, body: unknown, origin = 'https://family.local', pin = alice.userId) => router.handle(new Request('https://family.local'+path, { method: 'PATCH', headers: {
    cookie: `piclaw_session=token-${alice.userId}`, origin, 'x-piclaw-account-id': pin, 'x-piclaw-login-id': alice.authentication.sessionId!,
  }, body: JSON.stringify(body) }));
  for (const origin of ['', 'https://other.local']) expect((await req('/account/factors/passkey/alice1', { label: 'New' }, origin)).status).toBe(403);
  for (const body of [{}, { label: 'x', user_id: alice.userId }]) expect((await req('/account/factors/passkey/alice1', body)).status).toBe(403);
  expect((await req('/account/factors/passkey/bob1', { label: 'x' })).status).toBe(403);
  expect((await req('/account/factors/passkey/alice1?user_id=bob', { label: 'x' })).status).toBe(403);
  expect((await req('/account/factors/passkey/alice1', { label: 'x' }, 'https://family.local', bob.userId)).status).toBe(409);
  const response = await req('/account/factors/passkey/alice1', { label: ' Hardware key ' });
  expect(response.status).toBe(200); expect(response.headers.get('cache-control')).toBe('private, no-store'); expect(await response.json()).toEqual({ label: 'Hardware key' });
  expect((await req(`/account/sessions/${alice.authentication.sessionId}`, { label: 'Browser' })).status).toBe(200);
  expect((await req('/account/factors/passkey/alice1', { label: '\n' })).status).toBe(400);
});
