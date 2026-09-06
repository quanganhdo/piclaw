import { beforeEach, afterEach, expect, test } from 'bun:test';
import Database from 'bun:sqlite';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { SettingsManager, SessionManager } from '@earendil-works/pi-coding-agent';
import { getModel } from '@earendil-works/pi-ai/compat';
import { createTempWorkspace, setEnv } from '../helpers.js';
import { createTestModelRuntime } from '../model-services-fixture.js';
import { getDb, initDatabase, closeDatabase } from '../../src/db/connection.js';
import { getUser } from '../../src/db/users.js';
import { createWebSession, revokeUserWebSessions } from '../../src/db/web-sessions.js';
import { provisionFamilyAccount, updateManagedAccount, updateOwnAccount } from '../../src/db/account-administration.js';
import { initializeAccountModelDefaults, readAccountModelDefaults } from '../../src/db/account-model-defaults.js';
import { ownAccountModelDefaults, familySessionModelOptions } from '../../src/agent-pool/family-model-defaults.js';
import { resolveRequestPrincipal } from '../../src/channels/web/auth/principal.js';
import { authoriseExecutionIdentity } from '../../src/agent-pool/execution-identity.js';
import { withExecutionIdentity, type ExecutionIdentity } from '../../src/core/execution-context.js';
import { withChatContext } from '../../src/core/chat-context.js';
import { createSessionInDir } from '../../src/agent-pool/session.js';
import { createOwnedRoot } from '../../src/db/owned-session-lifecycle.js';
import { commitOwnedFork } from '../../src/db/owned-forks.js';
import { RequestRouterService } from '../../src/channels/web/request-router-service.js';
import { WebAuthGateway } from '../../src/channels/web/auth/auth-gateway.js';
import { WebauthnChallengeTracker } from '../../src/channels/web/auth/webauthn-challenges.js';
import { TotpFailureTracker } from '../../src/channels/web/auth/totp-failure-tracker.js';
import { resetRateLimiterStateForTests } from '../../src/channels/web/http/rate-limit.js';

let ws: ReturnType<typeof createTempWorkspace>, restore: () => void;
let admin: ReturnType<typeof actor>, alice: ReturnType<typeof actor>, bob: ReturnType<typeof actor>;
const base = getModel('anthropic', 'claude-sonnet-4-5')!;
const a = { ...base, provider: 'family-test', id: 'a', name: 'Model A', reasoning: true }, b = { ...base, provider: 'family-test', id: 'b', name: '<script>Model B</script>', reasoning: false };
let runtime: ReturnType<typeof createTestModelRuntime>, settings: SettingsManager;
function actor(id: string) {
  const login = createWebSession(`token-${id}`, id, 3600, 'passkey');
  return resolveRequestPrincipal(new Request('https://local', { headers: { cookie: 'piclaw_session=fixture' } }), { mode: 'family-shared', authEnabled: true }, {
    getSession: () => login, getUser: () => getUser(getDb(), id), getLocalDisplayName: () => 'Unused',
  })!;
}
function identity(owner = alice, chatJid = owner.homeChatJid!) { return authoriseExecutionIdentity(getDb(), 'family-shared', chatJid, { actorUserId: owner.userId, ownerUserId: owner.userId, chatJid, kind: 'interactive', authenticationSessionId: owner.authentication.sessionId! })!; }
function run<T>(snapshot: ExecutionIdentity, callback: () => T | Promise<T>): Promise<T> { return withExecutionIdentity(snapshot, () => withChatContext(snapshot.provenance.chatJid, 'web', async () => callback())); }
const input = (model: string | null = 'family-test/a', thinking_level: string | null = 'high', expected_revision = 0) => ({ expected_revision, model, thinking_level });
const read = (owner = alice) => ownAccountModelDefaults(getDb(), owner, runtime, settings);
const save = (value: unknown = input(), owner = alice) => ownAccountModelDefaults(getDb(), owner, runtime, settings, value);
beforeEach(() => {
  ws = createTempWorkspace('piclaw-family-model-defaults-'); restore = setEnv({ PICLAW_WORKSPACE: ws.workspace, PICLAW_STORE: ws.store, PICLAW_DATA: ws.data, PICLAW_SCOPED_MODELS_ONLY: '1' });
  mkdirSync(join(ws.workspace, '.piclaw')); writeFileSync(join(ws.workspace, '.piclaw/config.json'), JSON.stringify({ domains: { access: { mode: 'family-shared' } } }));
  closeDatabase(); initDatabase(); resetRateLimiterStateForTests(); admin = actor('default');
  const users = ['alice', 'bob'].map(name => {
    const user = provisionFamilyAccount(getDb(), admin, { username: name, displayName: name });
    getDb().query("INSERT INTO webauthn_credentials(user_id,rp_id,credential_id,public_key) VALUES (?,'local',?,'key')").run(user.id, name);
    updateManagedAccount(getDb(), admin, user.id, { enabled: true }, { totp: false, passkey: true, rpId: 'local' }); return actor(user.id);
  }); [alice, bob] = users as [typeof alice, typeof bob];
  runtime = createTestModelRuntime([a, b]); settings = SettingsManager.inMemory({ compaction: { enabled: false }, defaultProvider: b.provider, defaultModel: b.id, defaultThinkingLevel: 'medium', enabledModels: ['family-test/*'] });
});
afterEach(() => { closeDatabase(); resetRateLimiterStateForTests(); restore(); ws.cleanup(); });

test('model defaults are immutable-owner revisioned preferences, survive reopen/rename and never change shared settings or logins', () => {
  const db = getDb(), before = settings.getGlobalSettings(), logins = db.query('SELECT * FROM web_sessions ORDER BY session_id').all();
  expect(read().preferences).toEqual({ revision: 0, model: null, thinking_level: null });
  expect(read().effective).toEqual({ model: 'family-test/b', thinking_level: 'off', source: 'instance', available: true });
  expect(read().models[1]!.thinking_levels).toEqual(['off']);
  const value = save(); expect(value.preferences).toEqual({ revision: 1, model: 'family-test/a', thinking_level: 'high' });
  expect(value.effective).toEqual({ model: 'family-test/a', thinking_level: 'high', source: 'account', available: true });
  expect(save(input('family-test/a', 'high', 1)).preferences.revision).toBe(1);
  expect(() => save(input())).toThrow('Refresh'); expect(read(bob).preferences.revision).toBe(0); expect(read(admin).preferences.revision).toBe(0);
  updateOwnAccount(db, alice, { username: 'renamed' }); initializeAccountModelDefaults(db); expect(read().preferences).toEqual(value.preferences);
  const path = join(ws.workspace, 'defaults.sqlite'); db.query('VACUUM INTO ?').run(path); const reopened = new Database(path);
  try { expect(readAccountModelDefaults(reopened, alice.userId)).toEqual(value.preferences); } finally { reopened.close(); }
  expect(save(input(null, null, 1)).preferences).toEqual({ revision: 2, model: null, thinking_level: null });
  expect(settings.getGlobalSettings()).toEqual(before); expect(db.query('SELECT * FROM web_sessions ORDER BY session_id').all()).toEqual(logins);
});

test('catalogue validation denies fuzzy/unavailable/out-of-scope/unsupported models and malformed input; disappeared choice remains resettable', () => {
  for (const value of [input('a'), input('family-test/a:high'), input('family-test/missing'), input('family-test/b','high'), input(null, 'high'), input('family-test/a','nope'), input('family-test/a',null,-1), { ...input(), user_id: bob.userId }, {}, [], null]) expect(() => save(value)).toThrow();
  settings.setEnabledModels(['family-test/b']); expect(() => save()).toThrow('unavailable'); settings.setEnabledModels(['family-test/*']); save();
  runtime = createTestModelRuntime([b]); expect(read().preferences.model).toBe('family-test/a'); expect(read().effective.available).toBe(false);
  expect(() => save(input('family-test/a','high',1))).toThrow('unavailable'); expect(save(input(null,null,1)).preferences.model).toBeNull();
  expect(JSON.stringify(read())).not.toMatch(/apiKey|baseUrl|authPath|headers|token-/);
});

test('live authority/revision at commit, rollback, frozen run defaults and unavailable model fail closed', async () => {
  const db = getDb();
  for (const forged of [{ ...alice, userId: bob.userId }, { ...admin, userId: alice.userId }, { ...alice, role: 'admin' }]) expect(() => read(forged as any)).toThrow();
  db.query('UPDATE web_sessions SET created_at=? WHERE session_id=?').run(new Date(Date.now()-600000).toISOString(), alice.authentication.sessionId!); save();
  const first = identity(); expect(Object.isFrozen(first.modelDefaults)).toBe(true); save(input('family-test/b','off',1));
  const injected = authoriseExecutionIdentity(db,'family-shared',alice.homeChatJid!,{ ...first.provenance, modelDefaults: { model: 'forged/model', thinking_level: 'max' } } as any)!;
  expect(injected.modelDefaults?.model).toBe('family-test/b');
  expect(first.modelDefaults?.model).toBe('family-test/a'); expect(identity().modelDefaults?.model).toBe('family-test/b');
  const empty = () => SessionManager.inMemory(ws.workspace);
  expect((await run(first, () => familySessionModelOptions(alice.homeChatJid!, empty(), runtime, settings))).model?.id).toBe('a');
  runtime = createTestModelRuntime([b]); await expect(run(first, () => familySessionModelOptions(alice.homeChatJid!, empty(), runtime, settings))).rejects.toThrow('unavailable');
  db.exec("CREATE TRIGGER fail_defaults BEFORE UPDATE ON user_model_defaults BEGIN SELECT RAISE(ABORT,'write failed'); END");
  expect(() => save(input(null,null,2))).toThrow('write failed'); expect(read().preferences.revision).toBe(2); db.exec('DROP TRIGGER fail_defaults');
  revokeUserWebSessions(alice.userId); expect(() => read()).toThrow(); expect(() => save(input(null,null,2))).toThrow();
  await expect(run(first, () => familySessionModelOptions(alice.homeChatJid!, empty(), runtime, settings))).rejects.toThrow();
});

test('root creation supplies SDK defaults but resumed and seeded fork model selections take precedence', async () => {
  save(); const first = identity(); const empty = SessionManager.inMemory(ws.workspace);
  const choice = await run(first, () => familySessionModelOptions(alice.homeChatJid!, empty, runtime, settings)); expect(choice.model?.id).toBe('a'); expect(choice.thinkingLevel).toBe('high');
  const resumed = SessionManager.inMemory(ws.workspace); resumed.appendModelChange(b.provider,b.id); resumed.appendThinkingLevelChange('off');
  const restored = await run(first, () => familySessionModelOptions(alice.homeChatJid!, resumed, runtime, settings)); expect(restored.model?.id).toBe('b'); expect(restored.thinkingLevel).toBe('off');
  resumed.appendMessage({ role: 'user', content: 'hello', timestamp: Date.now() });
  expect((await run(first, () => familySessionModelOptions(alice.homeChatJid!, resumed, runtime, settings))).model?.id).toBe('b');
  const fork = commitOwnedFork(getDb(), alice, alice.homeChatJid!, 'fork-defaults', 'child', '{}');
  expect(await run(identity(alice, fork.chat_jid), () => familySessionModelOptions(fork.chat_jid, SessionManager.inMemory(ws.workspace), runtime, settings))).toEqual({});
  expect((await run(identity(alice,fork.chat_jid), () => familySessionModelOptions(fork.chat_jid, resumed, runtime, settings))).model?.id).toBe('b');
  const root = createOwnedRoot(getDb(), alice, 'fresh'); expect((await run(identity(alice,root.chat_jid), () => familySessionModelOptions(root.chat_jid, SessionManager.inMemory(ws.workspace), runtime, settings))).model?.id).toBe('a');
  await expect(run(identity(bob), () => familySessionModelOptions(alice.homeChatJid!, empty, runtime, settings))).rejects.toThrow();
  await expect(run({ ...first, modelDefaults: undefined }, () => familySessionModelOptions(alice.homeChatJid!, empty, runtime, settings))).rejects.toThrow();
});

test('production SDK session creation and rehydration use personal defaults without mutating shared Settings', async () => {
  save(); const before = settings.getGlobalSettings(); const dir = join(ws.workspace,'sessions');
  const options = { chatJid: alice.homeChatJid!, tools: [], modelRuntime: runtime, settingsManager: settings };
  const created = await run(identity(), () => createSessionInDir(dir, options));
  try {
    expect(created.session.model?.id).toBe('a'); expect(created.session.thinkingLevel).toBe('high'); expect(settings.getGlobalSettings()).toEqual(before);
    // Force a real persisted session, without provider calls.
    created.session.sessionManager.appendMessage({ role:'user', content:'persisted', timestamp:Date.now() });
    created.session.sessionManager.appendMessage({ role:'assistant', content:[{type:'text',text:'stored'}], api:a.api, provider:a.provider, model:a.id, usage:{input:0,output:0,cacheRead:0,cacheWrite:0,totalTokens:0,cost:{input:0,output:0,cacheRead:0,cacheWrite:0,total:0}}, stopReason:'stop', timestamp:Date.now() });
  } finally { await created.dispose(); }
  save(input('family-test/b','off',1));
  const resumed = await run(identity(), () => createSessionInDir(dir, options));
  try { expect(resumed.session.model?.id).toBe('a'); expect(resumed.session.thinkingLevel).toBe('high'); expect(settings.getGlobalSettings()).toEqual(before); }
  finally { await resumed.dispose(); }
}, 20000);

test('production HTTP model defaults are self-only, Origin/pinned and never hydrate sessions or expose provider details', async () => {
  const json = (value: unknown, status=200) => Response.json(value, { status }); let calls = 0;
  const authGateway = new WebAuthGateway({ accessMode: 'family-shared', passkeyMode: '', totpSecret: '', internalSecret: '', hasTls: true, sessionTtlSeconds: 3600 }, { json, challenges: new WebauthnChallengeTracker(), failureTracker: new TotpFailureTracker() });
  const router = new RequestRouterService({ json, authGateway, agentPool: { accountModelDefaults: (actor: typeof alice, body?: unknown) => { calls++; return ownAccountModelDefaults(getDb(),actor,runtime,settings,body); } } } as any, 'family-shared');
  const req = (path = '/account/model-defaults', method = 'GET', body?: unknown, origin = 'https://local', pin = alice.userId) => router.handle(new Request('https://local'+path,{method,headers:{cookie:`piclaw_session=token-${alice.userId}`,origin,'x-piclaw-account-id':pin,'x-piclaw-login-id':alice.authentication.sessionId!},...(body ? {body:JSON.stringify(body)} : {})}));
  const response = await req(); expect(response.status).toBe(200); expect(response.headers.get('cache-control')).toBe('private, no-store'); expect((await response.json()).user_id).toBe(alice.userId);
  expect((await req('/account/model-defaults?user_id='+bob.userId)).status).toBe(403); expect((await req(`/admin/users/${bob.userId}/model-defaults`)).status).toBe(403);
  expect((await req('/account/model-defaults','PATCH',input(),'')).status).toBe(403); expect((await req('/account/model-defaults','PATCH',input(),'https://local',bob.userId)).status).toBe(409); expect(calls).toBe(1);
  expect((await req('/account/model-defaults','PATCH',{...input(),user_id:bob.userId})).status).toBe(403);
  expect((await req('/account/model-defaults','PATCH',input())).status).toBe(200); expect((await req('/account/model-defaults','PATCH',input())).status).toBe(400);
  expect(read(bob).preferences.revision).toBe(0);
});
