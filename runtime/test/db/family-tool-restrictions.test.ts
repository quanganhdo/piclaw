import { afterEach, beforeEach, expect, test } from 'bun:test';
import '../helpers.js';
import Database from 'bun:sqlite';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { getDb, initDatabase, closeDatabase } from '../../src/db/connection.js';
import { getUser } from '../../src/db/users.js';
import { createWebSession } from '../../src/db/web-sessions.js';
import { provisionFamilyAccount, updateManagedAccount } from '../../src/db/account-administration.js';
import { readAdminToolPolicy, readFamilyToolPolicy, updateAdminToolPolicy } from '../../src/db/family-tool-restrictions.js';
import { FAMILY_WEB_TOOLS } from '../../src/core/family-workspace-policy.js';
import { authoriseExecutionIdentity } from '../../src/agent-pool/execution-identity.js';
import { withExecutionIdentity } from '../../src/core/execution-context.js';
import { createRunToolCeilingController } from '../../src/agent-pool/run-tool-ceiling.js';
import { resolveRequestPrincipal } from '../../src/channels/web/auth/principal.js';
import { RequestRouterService } from '../../src/channels/web/request-router-service.js';
import { WebAuthGateway } from '../../src/channels/web/auth/auth-gateway.js';
import { WebauthnChallengeTracker } from '../../src/channels/web/auth/webauthn-challenges.js';
import { TotpFailureTracker } from '../../src/channels/web/auth/totp-failure-tracker.js';
import { resetRateLimiterStateForTests } from '../../src/channels/web/http/rate-limit.js';

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
    updateManagedAccount(getDb(), admin, user.id, { enabled: true }, { totp: false, passkey: true, rpId: 'family.local' }); return actor(user.id);
  }); [alice, bob] = users as [typeof alice, typeof bob];
});
afterEach(() => { closeDatabase(); resetRateLimiterStateForTests(); });
const patch = (denied_tools: string[], expected_revision = 0) => ({ confirm_username: 'alice', expected_revision, denied_tools });
const identity = () => authoriseExecutionIdentity(getDb(), 'family-shared', alice.homeChatJid!, { actorUserId: alice.userId, ownerUserId: alice.userId, chatJid: alice.homeChatJid!, kind: 'interactive', authenticationSessionId: alice.authentication.sessionId! })!;

test('restriction changes are bounded, revision-checked, audited atomically and cannot revoke account administration', () => {
  const db = getDb(); expect(readFamilyToolPolicy(db, alice.userId).allowed).toEqual([...FAMILY_WEB_TOOLS]);
  const before = db.query('SELECT * FROM web_sessions ORDER BY session_id').all();
  const policy = updateAdminToolPolicy(db, admin, alice.userId, patch(['messages', 'read']));
  expect(policy.denied).toEqual(['read', 'messages']); expect(policy.revision).toBe(1); expect(Object.isFrozen(policy.allowed)).toBe(true);
  expect(readFamilyToolPolicy(db, bob.userId).revision).toBe(0);
  expect(() => updateAdminToolPolicy(db, admin, alice.userId, patch([]))).toThrow('Refresh');
  expect(updateAdminToolPolicy(db, admin, alice.userId, patch(['read', 'messages'], 1))).toEqual(policy);
  expect(db.query('SELECT * FROM user_tool_restriction_events').all()).toHaveLength(1);
  db.exec("CREATE TRIGGER fail_tool_policy BEFORE INSERT ON user_tool_restriction_events BEGIN SELECT RAISE(ABORT,'audit failure'); END");
  expect(() => updateAdminToolPolicy(db, admin, alice.userId, patch([], 1))).toThrow('audit failure');
  expect(readFamilyToolPolicy(db, alice.userId)).toEqual(policy); db.exec('DROP TRIGGER fail_tool_policy');
  const empty = updateAdminToolPolicy(db, admin, alice.userId, patch([...FAMILY_WEB_TOOLS], 1)); expect(empty.allowed).toEqual([]);
  expect(updateAdminToolPolicy(db, admin, alice.userId, patch([], 2)).allowed).toEqual([...FAMILY_WEB_TOOLS]);
  expect(db.query('SELECT * FROM web_sessions ORDER BY session_id').all()).toEqual(before);
  updateAdminToolPolicy(db, admin, admin.userId, { ...patch([...FAMILY_WEB_TOOLS]), confirm_username: 'default' });
  expect(readAdminToolPolicy(db, admin, alice.userId).user.id).toBe(alice.userId);
});

test('restrictions deny invalid names, forged fields, member/stale authority, corruption and absent schema', () => {
  const db = getDb();
  for (const names of [['bash'], ['read', 'read'], ['unknown'], ['__proto__'], [null]]) expect(() => updateAdminToolPolicy(db, admin, alice.userId, patch(names as any))).toThrow();
  for (const input of [{ ...patch([]), allow: ['bash'] }, { ...patch([]), confirm_username: 'bob' }, { ...patch([]), expected_revision: -1 }]) expect(() => updateAdminToolPolicy(db, admin, alice.userId, input)).toThrow();
  expect(() => readAdminToolPolicy(db, alice, bob.userId)).toThrow(); expect(() => updateAdminToolPolicy(db, alice, alice.userId, patch([]))).toThrow();
  db.query("INSERT INTO user_tool_restrictions VALUES (?, '{bad', 1)").run(alice.userId); expect(() => identity()).toThrow();
  db.query("UPDATE user_tool_restrictions SET denied_tools='[\"bash\"]' WHERE user_id=?").run(alice.userId); expect(() => identity()).toThrow();
  db.query('DELETE FROM user_tool_restrictions').run();
  db.query('UPDATE web_sessions SET created_at=? WHERE session_id=?').run(new Date(Date.now()-600000).toISOString(), admin.authentication.sessionId!);
  expect(() => readAdminToolPolicy(db, admin, alice.userId)).toThrow();
  db.exec('DROP TABLE user_tool_restrictions'); expect(() => identity()).toThrow();
});

test('new runs resolve immutable restrictions; existing run and replacement retain old snapshot and caller cannot widen', () => {
  const db = getDb(), original = identity();
  updateAdminToolPolicy(db, admin, alice.userId, patch(['read', 'messages']));
  const next = identity(); expect(original.toolPolicy?.revision).toBe(0); expect(next.toolPolicy?.revision).toBe(1);
  const check = (snapshot: typeof original, expected: string[]) => withExecutionIdentity(snapshot, () => {
    let active = ['read', 'messages', 'ls', 'bash'];
    const session = { getActiveToolNames: () => active, setActiveToolsByName: (names: string[]) => { active = names; } };
    const controller = createRunToolCeilingController({ chatJid: alice.homeChatJid!, runOptions: { toolCeilingFilter: () => true } });
    controller.apply(session); expect(active).toEqual(expected);
    session.setActiveToolsByName(['read', 'messages', 'ls', 'bash']); expect(active).toEqual(expected);
    controller.apply(session); expect(active).toEqual(expected); controller.release();
  });
  check(original, ['read', 'messages', 'ls']); check(next, ['ls']);
  withExecutionIdentity({ ...next, toolPolicy: undefined }, () => expect(() => createRunToolCeilingController({ chatJid: alice.homeChatJid!, runOptions: {} }).apply({})).toThrow('snapshot is required'));
  // Caller-supplied policy in provenance is discarded by the authoriser.
  const injected = authoriseExecutionIdentity(db, 'family-shared', alice.homeChatJid!, { ...next.provenance, toolPolicy: { allowed: ['bash'] } } as any)!;
  expect(injected.toolPolicy?.allowed).not.toContain('read'); expect(injected.toolPolicy?.allowed).not.toContain('bash');
  const dir = mkdtempSync(join(tmpdir(), 'piclaw-tool-policy-')), path = join(dir, 'policy.sqlite');
  db.query('VACUUM INTO ?').run(path); const reopened = new Database(path);
  try { expect(readFamilyToolPolicy(reopened, alice.userId)).toEqual(next.toolPolicy!); }
  finally { reopened.close(); rmSync(dir, { recursive: true, force: true }); }
});

test('HTTP admin policy edits require Origin/pins/strict revision and own workspace reflects effective tools', async () => {
  const json = (value: unknown, status=200) => Response.json(value, { status });
  const authGateway = new WebAuthGateway({ accessMode: 'family-shared', passkeyMode: '', totpSecret: '', internalSecret: '', hasTls: true, sessionTtlSeconds: 3600 }, { json, challenges: new WebauthnChallengeTracker(), failureTracker: new TotpFailureTracker() });
  const router = new RequestRouterService({ json, authGateway } as any, 'family-shared');
  const req = (path: string, method = 'GET', body?: unknown, who=admin, origin='https://family.local', pin=who.userId) => router.handle(new Request('https://family.local'+path, { method, headers: { cookie: `piclaw_session=token-${who.userId}`, origin, 'x-piclaw-account-id': pin, 'x-piclaw-login-id': who.authentication.sessionId! }, ...(body ? { body: JSON.stringify(body) } : {}) }));
  const path = `/admin/users/${alice.userId}/tools`;
  const response = await req(path); expect(response.status).toBe(200); expect(response.headers.get('cache-control')).toBe('private, no-store');
  expect((await req(path, 'GET', undefined, alice)).status).toBe(403); expect((await req(path+'?user=bob')).status).toBe(403);
  expect((await req(path, 'PATCH', patch(['read']), admin, '')).status).toBe(403);
  expect((await req(path, 'PATCH', patch(['read']), admin, 'https://family.local', bob.userId)).status).toBe(409);
  expect((await req(path, 'PATCH', patch(['read']))).status).toBe(200);
  expect((await req(path, 'PATCH', patch([]))).status).toBe(400);
  const own = await req('/account/workspace', 'GET', undefined, alice); const value = await own.json();
  expect(value.tools.denied).toEqual(['read']); expect(value.tools.allowed).not.toContain('read'); expect(value.tools.revision).toBe(1);
});

test('compare-and-swap prevents concurrent editors from overwriting policy and disable/role changes preserve restrictions', () => {
  const db = getDb();
  const a = readAdminToolPolicy(db, admin, alice.userId), b = readAdminToolPolicy(db, admin, alice.userId);
  updateAdminToolPolicy(db, admin, alice.userId, patch(['read'], a.policy.revision));
  expect(() => updateAdminToolPolicy(db, admin, alice.userId, patch(['messages'], b.policy.revision))).toThrow('Refresh');
  expect(readFamilyToolPolicy(db, alice.userId).denied).toEqual(['read']);
  updateManagedAccount(db, admin, alice.userId, { enabled: false }, { totp: false, passkey: true, rpId: 'family.local' });
  updateAdminToolPolicy(db, admin, alice.userId, patch(['read', 'messages'], 1));
  updateManagedAccount(db, admin, alice.userId, { enabled: true, role: 'admin' }, { totp: false, passkey: true, rpId: 'family.local' });
  alice = actor(alice.userId);
  expect(identity().toolPolicy?.allowed).not.toContain('read'); expect(identity().toolPolicy?.allowed).not.toContain('messages');
  expect(identity().role).toBe('admin');
});
