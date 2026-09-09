import { beforeEach, afterEach, expect, test } from 'bun:test';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { createTempWorkspace, setEnv } from '../helpers.js';
import { closeDatabase, initDatabase, getDb } from '../../src/db/connection.js';
import { createWebSession } from '../../src/db/web-sessions.js';
import { getUser } from '../../src/db/users.js';
import { provisionFamilyAccount, updateManagedAccount } from '../../src/db/account-administration.js';
import { provisionUserHome } from '../../src/db/session-ownership.js';
import { readFamilyWorkspacePolicy } from '../../src/db/family-workspace-policy.js';
import { FAMILY_WEB_TOOLS, isFamilyWebToolAllowed } from '../../src/core/family-workspace-policy.js';
import { resolveRequestPrincipal } from '../../src/channels/web/auth/principal.js';
import { validateAccessStartup } from '../../src/db/access-state.js';
import { promotePreparedFamilyDatabase } from '../../src/db/access-migration-promotion.js';
import { prepareAccessMigrationCopy, readAccessMigrationInventory } from '../../src/db/access-migration-plan.js';
import { RESOURCE_MIGRATION_POLICY } from '../../src/db/access-resource-migration.js';
import { MIGRATION_INPUT_POLICY } from '../../src/db/migration-input-holds.js';
import { RequestRouterService } from '../../src/channels/web/request-router-service.js';
import { WebAuthGateway } from '../../src/channels/web/auth/auth-gateway.js';
import { WebauthnChallengeTracker } from '../../src/channels/web/auth/webauthn-challenges.js';
import { TotpFailureTracker } from '../../src/channels/web/auth/totp-failure-tracker.js';

let workspace: ReturnType<typeof createTempWorkspace>, restore: () => void;
function actor(id: string) {
  const login = createWebSession(`token-${id}`, id, 3600, 'passkey');
  return resolveRequestPrincipal(new Request('https://family.local', { headers: { cookie: 'piclaw_session=fixture' } }), { mode: 'family-shared', authEnabled: true }, {
    getSession: () => login, getUser: () => getUser(getDb(), id), getLocalDisplayName: () => 'Unused',
  })!;
}
let alice: ReturnType<typeof actor>, admin: ReturnType<typeof actor>;
beforeEach(() => {
  workspace = createTempWorkspace('piclaw-workspace-policy-'); restore = setEnv({ PICLAW_WORKSPACE: workspace.workspace, PICLAW_STORE: workspace.store, PICLAW_DATA: workspace.data });
  mkdirSync(join(workspace.workspace, '.piclaw')); writeFileSync(join(workspace.workspace, '.piclaw/config.json'), JSON.stringify({ domains: { access: { mode: 'family-shared' } } }));
  closeDatabase(); initDatabase(); admin = actor('default');
  getDb().exec("INSERT INTO chats(jid,name,last_message_time) VALUES ('web:default','default','now'); INSERT INTO chat_branches(branch_id,chat_jid,root_chat_jid,agent_name,created_at,updated_at) VALUES ('default','web:default','web:default','default','now','now')");
  provisionUserHome(getDb(),'default','web:default');admin=actor('default');
  const user = provisionFamilyAccount(getDb(), admin, { username: 'alice', displayName: 'Alice' });
  getDb().query("INSERT INTO webauthn_credentials(user_id,rp_id,credential_id,public_key) VALUES (?,'family.local','cHJpdmF0ZS1rZXktaWQ','UFJJVkFURV9LRVk')").run(user.id);
  updateManagedAccount(getDb(), admin, user.id, { enabled: true }, { totp: false, passkey: true, rpId: 'family.local' }); alice = actor(user.id);
  const inventory=readAccessMigrationInventory(getDb());prepareAccessMigrationCopy(getDb(),{...inventory.plan,version:5,child_sessions:[],resource_policy:RESOURCE_MIGRATION_POLICY,
    factor_policy:{passkeys:'preserve-immutable-handles',legacy_totp:'none'},input_policy:MIGRATION_INPUT_POLICY});promotePreparedFamilyDatabase(getDb());admin=actor('default');alice=actor(user.id);
});
afterEach(() => { closeDatabase(); restore(); workspace.cleanup(); });

test('workspace policy distinguishes routing/config/activation and shared filesystem from private conversation scope', () => {
  const db = getDb(), value = readFamilyWorkspacePolicy(db, alice);
  expect(value.deployment).toEqual({ routing_mode: 'family-shared', configured_mode: 'family-shared', activated_mode: 'family-shared', supported_startup_mode: 'family-shared', activation_allowed: false, container_isolation: false });
  expect(value.tools.allowed).toEqual([...FAMILY_WEB_TOOLS]); expect(value.tools.configurable).toBe(false);
  expect(value.memory.personal).toEqual([`notes/users/${alice.userId}/MEMORY.md`, `notes/users/${alice.userId}/preferences.md`]);
  expect(value.memory.family).toBe('notes/family/MEMORY.md');
  expect(value.skills.precedence).toBe('packaged-first');expect(value.skills.entries.some(row=>row.name==='schedule'&&row.provenance==='packaged'&&row.selected)).toBe(true);
  expect(value.operations.find(row => row.name === 'Account management')?.state).toBe('owner-scoped');
  expect(readFamilyWorkspacePolicy(db, admin).operations.find(row => row.name === 'Account management')?.state).toBe('admin-metadata');
  expect(value.resources.find(row => row.name === 'Workspace files')?.scope).toBe('shared');
  expect(value.resources.find(row => row.name === 'Workspace search index')?.detail).toContain('notes/family and .pi/skills only');
  for (const secret of ['PRIVATE_KEY', 'private-key-id', `token-${alice.userId}`, alice.homeChatJid!, workspace.workspace, 'PRIVATE BODY']) expect(JSON.stringify(value)).not.toContain(secret);
  expect(validateAccessStartup(db)).toMatchObject({ effectiveMode:'family-shared' });
  for (const name of ['bash', 'introspect_sql', 'keychain', 'addon-arbitrary', '', 'Read', 'constructor', '__proto__']) expect(isFamilyWebToolAllowed(name)).toBe(false);
  expect(Object.isFrozen(FAMILY_WEB_TOOLS)).toBe(true);
  value.tools.allowed.push('bash'); expect(readFamilyWorkspacePolicy(db, alice).tools.allowed).not.toContain('bash');
});

test('workspace metadata reads allow old live login but deny revocation/malformed mode and never activate the store', () => {
  const db = getDb(); db.query('UPDATE web_sessions SET created_at=? WHERE session_id=?').run(new Date(Date.now()-600000).toISOString(), alice.authentication.sessionId!);
  expect(readFamilyWorkspacePolicy(db, alice).user_id).toBe(alice.userId);
  writeFileSync(join(workspace.workspace, '.piclaw/config.json'), '{bad'); expect(() => readFamilyWorkspacePolicy(db, alice)).toThrow();
  writeFileSync(join(workspace.workspace, '.piclaw/config.json'), JSON.stringify({ domains: { access: { mode: 'single-user' } } }));
  expect(readFamilyWorkspacePolicy(db, alice).deployment.configured_mode).toBe('single-user');
  db.query('DELETE FROM web_sessions WHERE session_id=?').run(alice.authentication.sessionId!);
  expect(() => readFamilyWorkspacePolicy(db, alice)).toThrow();
  expect(db.query('SELECT activated_mode FROM access_state').get()).toEqual({ activated_mode: 'family-shared' });
});

test('workspace endpoint requires live family account, pins and no selectors; all writes deny', async () => {
  const json = (value: unknown, status=200) => Response.json(value, { status });
  const authGateway = new WebAuthGateway({ accessMode: 'family-shared', passkeyMode: '', totpSecret: '', internalSecret: '', hasTls: true, sessionTtlSeconds: 3600 }, { json, challenges: new WebauthnChallengeTracker(), failureTracker: new TotpFailureTracker() });
  const router = new RequestRouterService({ json, authGateway } as any, 'family-shared');
  const req = (path = '/account/workspace', method = 'GET', pin = alice.userId, token = `token-${alice.userId}`) => router.handle(new Request('https://family.local'+path, { method, headers: { cookie: `piclaw_session=${token}`, origin: 'https://family.local', 'x-piclaw-account-id': pin, 'x-piclaw-login-id': alice.authentication.sessionId! }, ...(method === 'GET' ? {} : { body: '{}' }) }));
  const response = await req(); expect(response.status).toBe(200); expect(response.headers.get('cache-control')).toBe('private, no-store'); expect(response.headers.get('vary')).toContain('Cookie');
  expect((await req('/account/workspace?user_id=default')).status).toBe(403);
  expect((await req('/account/workspace', 'GET', 'default')).status).toBe(409);
  expect((await req('/account/workspace', 'GET', alice.userId, 'invalid')).status).toBe(401);
  expect((await req('/account/workspace', 'PATCH')).status).toBe(403);
  expect((await req('/account/workspace', 'POST')).status).toBe(403);
});
