import { afterEach, beforeEach, expect, test } from 'bun:test';
import Database from 'bun:sqlite';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import '../helpers.js';
import { getDb, initDatabase, closeDatabase } from '../../src/db/connection.js';
import { getUser } from '../../src/db/users.js';
import { createWebSession } from '../../src/db/web-sessions.js';
import { provisionFamilyAccount, updateManagedAccount } from '../../src/db/account-administration.js';
import { readAdminHome, assignAdminHome } from '../../src/db/admin-home.js';
import { createOwnedRoot, archiveOwnedSession } from '../../src/db/owned-session-lifecycle.js';
import { getRootOwnership, resolveAuthorisedChat } from '../../src/db/session-ownership.js';
import { commitOwnedFork } from '../../src/db/owned-forks.js';
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
    getDb().query("INSERT INTO webauthn_credentials(user_id,rp_id,credential_id,public_key) VALUES (?,'family.local',?,'key')").run(user.id, name);
    updateManagedAccount(getDb(), admin, user.id, { enabled: true }, policy); return actor(user.id);
  });
  [alice, bob] = users as [typeof alice, typeof bob];
});
afterEach(() => { closeDatabase(); resetRateLimiterStateForTests(); });

test('admin home lists only active owned roots and changes future default without touching identity or logins', () => {
  const db = getDb(), original = alice.homeChatJid!, root = createOwnedRoot(db, alice, 'new-home');
  const archived = createOwnedRoot(db, alice, 'archived'); archiveOwnedSession(db, alice, archived.chat_jid);
  const fork = commitOwnedFork(db, alice, root.chat_jid, 'fork', 'child', '{}');
  const view = readAdminHome(db, admin, alice.userId), beforeLogins = db.query('SELECT * FROM web_sessions ORDER BY session_id').all();
  expect(view.roots).toHaveLength(2); expect(view.roots.find(r => r.branch_id === root.branch_id)?.current).toBe(false);
  for (const hidden of [bob.homeChatJid!, root.chat_jid, fork.branch_id, archived.branch_id, 'seed_json', 'token']) expect(JSON.stringify(view)).not.toContain(hidden);
  expect(assignAdminHome(db, admin, alice.userId, { branch_id: root.branch_id, confirm_username: 'alice' })).toEqual({ changed: true });
  expect(getRootOwnership(db, root.chat_jid)?.ownerUserId).toBe(alice.userId);
  expect(resolveAuthorisedChat(db, alice, undefined, 'session.read').chatJid).toBe(root.chat_jid);
  expect(resolveAuthorisedChat(db, alice, original, 'session.read').chatJid).toBe(original);
  expect(() => resolveAuthorisedChat(db, admin, root.chat_jid, 'session.read')).toThrow();
  expect(db.query('SELECT * FROM web_sessions ORDER BY session_id').all()).toEqual(beforeLogins);
  expect(db.query('SELECT actor_user_id,target_user_id,previous_home_chat_jid,target_branch_id FROM account_home_events').get()).toEqual({ actor_user_id: admin.userId, target_user_id: alice.userId, previous_home_chat_jid: original, target_branch_id: root.branch_id });
  expect(assignAdminHome(db, admin, alice.userId, { branch_id: root.branch_id, confirm_username: 'alice' })).toEqual({ changed: false });
  expect(db.query('SELECT * FROM account_home_events').all()).toHaveLength(1);
});

test('member/self/stale/foreign/fork/archived/forged inputs cannot change home or implicitly adopt roots', () => {
  const db = getDb(), root = createOwnedRoot(db, alice, 'candidate'), other = createOwnedRoot(db, bob, 'other');
  const fork = commitOwnedFork(db, alice, root.chat_jid, 'fork', 'child', '{}');
  const input = { branch_id: root.branch_id, confirm_username: 'alice' };
  for (const who of [alice, bob]) { expect(() => readAdminHome(db, who, alice.userId)).toThrow(); expect(() => assignAdminHome(db, who, alice.userId, input)).toThrow(); }
  expect(() => readAdminHome(db, admin, admin.userId)).toThrow();
  for (const id of [other.branch_id, fork.branch_id, '', 'missing']) expect(() => assignAdminHome(db, admin, alice.userId, { ...input, branch_id: id })).toThrow();
  expect(() => assignAdminHome(db, admin, alice.userId, { ...input, confirm_username: 'bob' })).toThrow();
  expect(() => assignAdminHome(db, admin, alice.userId, { ...input, owner_user_id: bob.userId } as any)).toThrow();
  archiveOwnedSession(db, alice, fork.chat_jid); archiveOwnedSession(db, alice, root.chat_jid);
  expect(() => assignAdminHome(db, admin, alice.userId, input)).toThrow();
  db.query('UPDATE chat_branches SET handle_owner_id=? WHERE branch_id=?').run(alice.userId, other.branch_id);
  expect(() => assignAdminHome(db, admin, alice.userId, { ...input, branch_id: other.branch_id })).toThrow();
  db.query('UPDATE web_sessions SET created_at=? WHERE session_id=?').run(new Date(Date.now()-600_000).toISOString(), admin.authentication.sessionId!);
  expect(() => readAdminHome(db, admin, alice.userId)).toThrow(); expect(() => assignAdminHome(db, admin, alice.userId, input)).toThrow();
  expect(getUser(db, alice.userId)?.home_chat_jid).toBe(alice.homeChatJid);
  expect(db.query('SELECT * FROM account_home_events').all()).toHaveLength(0);
});

test('audit failure rolls home change back; disabled-account assignment persists through reopen without enablement', () => {
  const db = getDb(), root = createOwnedRoot(db, alice, 'candidate'), input = { branch_id: root.branch_id, confirm_username: 'alice' };
  db.exec("CREATE TRIGGER fail_home_audit BEFORE INSERT ON account_home_events BEGIN SELECT RAISE(ABORT,'audit failure'); END");
  expect(() => assignAdminHome(db, admin, alice.userId, input)).toThrow('audit failure');
  expect(getUser(db, alice.userId)?.home_chat_jid).toBe(alice.homeChatJid); db.exec('DROP TRIGGER fail_home_audit');
  updateManagedAccount(db, admin, alice.userId, { enabled: false }, policy);
  expect(assignAdminHome(db, admin, alice.userId, input).changed).toBe(true); expect(getUser(db, alice.userId)?.enabled).toBe(false);
  const dir = mkdtempSync(join(tmpdir(), 'piclaw-admin-home-')), file = join(dir, 'home.sqlite'); db.query('VACUUM INTO ?').run(file); const reopened = new Database(file);
  try { expect(readAdminHome(reopened, admin, alice.userId).roots.find(r => r.branch_id === root.branch_id)?.current).toBe(true); expect(reopened.query('SELECT * FROM account_home_events').all()).toHaveLength(1); }
  finally { reopened.close(); rmSync(dir, { recursive: true, force: true }); }
});

test('HTTP home operations are recent-admin-only, pinned, Origin-checked and selector-free without transcript access', async () => {
  const json = (value: unknown, status=200) => Response.json(value, { status });
  const authGateway = new WebAuthGateway({ accessMode: 'family-shared', passkeyMode: '', totpSecret: '', internalSecret: '', hasTls: true, sessionTtlSeconds: 3600 }, { json, challenges: new WebauthnChallengeTracker(), failureTracker: new TotpFailureTracker() });
  const router = new RequestRouterService({ json, authGateway } as any, 'family-shared');
  const req = (path: string, method = 'GET', body?: unknown, who=admin, origin='https://family.local', pin=who.userId) => router.handle(new Request('https://family.local'+path, { method, headers: { cookie: `piclaw_session=token-${who.userId}`, origin, 'x-piclaw-account-id': pin, 'x-piclaw-login-id': who.authentication.sessionId! }, ...(body ? { body: JSON.stringify(body) } : {}) }));
  const root = createOwnedRoot(getDb(), alice, 'home-next'), path = `/admin/users/${alice.userId}/home`, input = { branch_id: root.branch_id, confirm_username: 'alice' };
  const response = await req(path); expect(response.status).toBe(200); expect(response.headers.get('cache-control')).toBe('private, no-store'); expect(response.headers.get('vary')).toContain('Cookie');
  expect((await req(path, 'GET', undefined, bob)).status).toBe(403); expect((await req(path+'?owner=bob')).status).toBe(403);
  expect((await req(path, 'GET', undefined, admin, 'https://family.local', bob.userId)).status).toBe(409);
  for (const origin of ['', 'https://other.local']) expect((await req(path, 'PATCH', input, admin, origin)).status).toBe(403);
  expect((await req(path, 'PATCH', { ...input, chat_jid: root.chat_jid })).status).toBe(403);
  expect((await req(path, 'PATCH', input)).status).toBe(200);
  expect((await req('/timeline?chat_jid='+root.chat_jid)).status).toBe(403);
});

test('stale eligibility is rechecked after archive or ownership removal and revoked admins cannot use a previous list', () => {
  const db = getDb(), root = createOwnedRoot(db, alice, 'candidate'), input = { branch_id: root.branch_id, confirm_username: 'alice' };
  expect(readAdminHome(db, admin, alice.userId).roots.some(r => r.branch_id === root.branch_id)).toBe(true);
  db.query('DELETE FROM session_roots WHERE root_branch_id=?').run(root.branch_id);
  expect(() => assignAdminHome(db, admin, alice.userId, input)).toThrow();
  expect(db.query('SELECT * FROM session_roots WHERE root_branch_id=?').get(root.branch_id)).toBeNull();
  expect(readAdminHome(db, admin, alice.userId).roots.some(r => r.branch_id === root.branch_id)).toBe(false);
  const active = createOwnedRoot(db, alice, 'active');
  readAdminHome(db, admin, alice.userId); archiveOwnedSession(db, alice, active.chat_jid);
  expect(() => assignAdminHome(db, admin, alice.userId, { ...input, branch_id: active.branch_id })).toThrow();
  db.query('DELETE FROM web_sessions WHERE session_id=?').run(admin.authentication.sessionId!);
  expect(() => readAdminHome(db, admin, alice.userId)).toThrow();
  expect(() => assignAdminHome(db, admin, alice.userId, input)).toThrow();
  expect(getUser(db, alice.userId)?.home_chat_jid).toBe(alice.homeChatJid);
  expect(db.query('SELECT * FROM account_home_events').all()).toHaveLength(0);
});
