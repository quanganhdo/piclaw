import { beforeEach, afterEach, expect, test } from 'bun:test';
import { mkdirSync, writeFileSync, readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { Type } from 'typebox';
import { createAgentSession, DefaultResourceLoader, SessionManager, SettingsManager, type ToolDefinition } from '@earendil-works/pi-coding-agent';
import { createTempWorkspace, setEnv } from '../helpers.js';
import { createRealTestModelServices } from '../model-services-fixture.js';
import { getDb, initDatabase, closeDatabase } from '../../src/db/connection.js';
import { getUser } from '../../src/db/users.js';
import { createWebSession, revokeUserWebSessions } from '../../src/db/web-sessions.js';
import { provisionFamilyAccount, updateManagedAccount } from '../../src/db/account-administration.js';
import { updateAdminToolPolicy } from '../../src/db/family-tool-restrictions.js';
import { resolveRequestPrincipal } from '../../src/channels/web/auth/principal.js';
import { authoriseExecutionIdentity } from '../../src/agent-pool/execution-identity.js';
import { withExecutionIdentity, type ExecutionIdentity } from '../../src/core/execution-context.js';
import { withChatContext } from '../../src/core/chat-context.js';
import { createFamilyBuiltinTools, createFamilyToolCallGuard, guardFamilyToolDefinition } from '../../src/agent-pool/family-builtin-tools.js';
import { createSessionInDir } from '../../src/agent-pool/session.js';

let ws: ReturnType<typeof createTempWorkspace>, restore: () => void;
let admin: ReturnType<typeof actor>, alice: ReturnType<typeof actor>, bob: ReturnType<typeof actor>;
function actor(id: string) {
  const login = createWebSession(`token-${id}`, id, 3600, 'passkey');
  return resolveRequestPrincipal(new Request('https://local', { headers: { cookie: 'piclaw_session=fixture' } }), { mode: 'family-shared', authEnabled: true }, {
    getSession: () => login, getUser: () => getUser(getDb(), id), getLocalDisplayName: () => 'Unused',
  })!;
}
function identity(owner = alice) { return authoriseExecutionIdentity(getDb(), 'family-shared', owner.homeChatJid!, { actorUserId: owner.userId, ownerUserId: owner.userId, chatJid: owner.homeChatJid!, kind: 'interactive', authenticationSessionId: owner.authentication.sessionId! })!; }
function run<T>(snapshot: ExecutionIdentity, callback: () => T | Promise<T>): Promise<T> { return withExecutionIdentity(snapshot, () => withChatContext(snapshot.provenance.chatJid, 'web', async () => callback())); }
const invoke = (tool: ToolDefinition, params: unknown, onUpdate?: any) => tool.execute('call', params, undefined, onUpdate, {} as any);
beforeEach(() => {
  ws = createTempWorkspace('piclaw-family-builtins-'); restore = setEnv({ PICLAW_WORKSPACE: ws.workspace, PICLAW_STORE: ws.store, PICLAW_DATA: ws.data });
  mkdirSync(join(ws.workspace, '.piclaw')); writeFileSync(join(ws.workspace, '.piclaw/config.json'), JSON.stringify({ domains: { access: { mode: 'family-shared' } } }));
  closeDatabase(); initDatabase(); admin = actor('default');
  const users = ['alice', 'bob'].map(name => {
    const user = provisionFamilyAccount(getDb(), admin, { username: name, displayName: name });
    getDb().query("INSERT INTO webauthn_credentials(user_id,rp_id,credential_id,public_key) VALUES (?,'local',?,'key')").run(user.id, name);
    updateManagedAccount(getDb(), admin, user.id, { enabled: true }, { totp: false, passkey: true, rpId: 'local' }); return actor(user.id);
  }); [alice, bob] = users as [typeof alice, typeof bob];
  writeFileSync(join(ws.workspace, 'sample.txt'), 'shared test content\nsecond line\n');
});
afterEach(() => { closeDatabase(); restore(); ws.cleanup(); });

test('actual SDK filesystem definitions enforce policy and retain read/search results while mutations never run', async () => {
  const tools = new Map(createFamilyBuiltinTools(ws.workspace, alice.homeChatJid!).map(tool => [tool.name, tool]));
  const first = identity();
  const read = await run(first, () => invoke(tools.get('read')!, { path: 'sample.txt', offset: 2, limit: 1 }));
  expect(JSON.stringify(read.content)).toContain('second line'); expect(JSON.stringify(read.content)).not.toContain('shared test content');
  expect(JSON.stringify(await run(first, () => invoke(tools.get('ls')!, { path: '.' })))).toContain('sample.txt');
  expect(JSON.stringify(await run(first, () => invoke(tools.get('find')!, { pattern: '*.txt', path: '.' })))).toContain('sample.txt');
  expect(JSON.stringify(await run(first, () => invoke(tools.get('grep')!, { pattern: 'shared', path: 'sample.txt' })))).toContain('shared test content');
  for (const [name, params] of [
    ['write', { path: 'sample.txt', content: 'changed' }], ['edit', { path: 'sample.txt', edits: [{ oldText: 'shared', newText: 'changed' }] }],
    ['bash', { command: 'touch SHOULD_NOT_EXIST' }], ['local_bash', { command: 'touch SHOULD_NOT_EXIST' }], ['powershell', { command: 'Write-Output nope' }],
  ] as const) await expect(run(first, () => invoke(tools.get(name)!, params))).rejects.toThrow('Session access denied');
  expect(readFileSync(join(ws.workspace, 'sample.txt'), 'utf8')).toContain('shared'); expect(existsSync(join(ws.workspace, 'SHOULD_NOT_EXIST'))).toBe(false);
  updateAdminToolPolicy(getDb(), admin, alice.userId, { confirm_username: 'alice', expected_revision: 0, denied_tools: ['read', 'ls', 'find', 'grep'] });
  const denied = identity();
  for (const name of ['read', 'ls', 'find', 'grep']) await expect(run(denied, () => invoke(tools.get(name)!, { path: 'missing', pattern: '*' }))).rejects.toThrow('Session access denied');
  expect(JSON.stringify(await run(first, () => invoke(tools.get('read')!, { path: 'sample.txt' })))).toContain('shared test content');
  await expect(run(identity(bob), () => invoke(tools.get('read')!, { path: 'sample.txt' }))).rejects.toThrow();
  await expect(invoke(tools.get('read')!, { path: 'sample.txt' })).rejects.toThrow();
}, 20000);

test('revoked late results and updates are withheld, and read errors do not expose paths after revocation', async () => {
  const snapshot = identity(); let release!: () => void, entered!: () => void, updates = 0;
  const held = new Promise<void>(r => release = r), waiting = new Promise<void>(r => entered = r);
  const delayed: ToolDefinition = { name: 'read', label: 'read', description: 'test', parameters: Type.Object({}), execute: async (_id, _params, _signal, update) => { entered(); await held; update?.({ content: [{ type: 'text', text: 'PRIVATE' }], details: {} }); return { content: [{ type: 'text', text: 'PRIVATE' }], details: {} }; } };
  const guarded = guardFamilyToolDefinition(delayed, alice.homeChatJid!);
  const result = run(snapshot, () => invoke(guarded, {}, () => { updates++; })).then(() => null, error => error);
  await waiting; revokeUserWebSessions(alice.userId); release(); expect((await result).message).toBe('Session access denied.'); expect(updates).toBe(0);
  alice = actor(alice.userId);
  const failing = guardFamilyToolDefinition({ ...delayed, execute: async () => { revokeUserWebSessions(alice.userId); throw new Error('/secret/path'); } }, alice.homeChatJid!);
  await expect(run(identity(), () => invoke(failing, {}))).rejects.toThrow('Session access denied');
});

test('SDK tool-call/user-bash hooks deny unknown and restricted calls and allow only live matching sources', async () => {
  const handlers = new Map<string, any>(); createFamilyToolCallGuard(alice.homeChatJid!)({ on: (name: string, fn: any) => handlers.set(name, fn) } as any);
  const first = identity();
  expect(await run(first, () => handlers.get('tool_call')({ toolName: 'read' }))).toBeUndefined();
  for (const toolName of ['write', 'bash', 'powershell', 'local_bash', 'mcp', 'unknown-addon']) expect((await run(first, () => handlers.get('tool_call')({ toolName }))).block).toBe(true);
  expect(handlers.get('user_bash')().result.exitCode).toBe(1);
  expect((await run(identity(bob), () => handlers.get('tool_call')({ toolName: 'read' }))).block).toBe(true);
  revokeUserWebSessions(alice.userId); expect((await run(first, () => handlers.get('tool_call')({ toolName: 'read' }))).block).toBe(true);
});

test('real SDK registry gives guarded custom definitions precedence over static/dynamic extension overrides', async () => {
  const { modelRuntime } = await createRealTestModelServices(join(ws.workspace, 'agent'));
  const settings = SettingsManager.inMemory({ compaction: { enabled: false } }); let extensionCalls = 0; let registerLate!: () => void;
  const fakeRead: ToolDefinition = { name: 'read', label: 'read', description: 'extension override', parameters: Type.Object({ path: Type.String() }), execute: async () => { extensionCalls++; return { content: [{ type: 'text', text: 'bypass' }], details: {} }; } };
  const loader = new DefaultResourceLoader({ cwd: ws.workspace, agentDir: join(ws.workspace, 'agent'), settingsManager: settings, noExtensions: true, noSkills: true, noPromptTemplates: true, noThemes: true,
    extensionFactories: [createFamilyToolCallGuard(alice.homeChatJid!), pi => { pi.registerTool(fakeRead); registerLate = () => pi.registerTool(fakeRead); }] });
  await loader.reload();
  const { session } = await createAgentSession({ cwd: ws.workspace, agentDir: join(ws.workspace, 'agent'), modelRuntime, settingsManager: settings, resourceLoader: loader, sessionManager: SessionManager.inMemory(ws.workspace), customTools: createFamilyBuiltinTools(ws.workspace, alice.homeChatJid!, [fakeRead]) });
  try {
    for (const late of [false, true]) {
      if (late) registerLate();
      session.setActiveToolsByName(['read', 'bash']);
      const read = session.agent.state.tools.find(tool => tool.name === 'read')!;
      expect(JSON.stringify(await run(identity(), () => read.execute('call', { path: 'sample.txt' })))).toContain('shared test content');
      const bash = session.agent.state.tools.find(tool => tool.name === 'bash')!;
      await expect(run(identity(), () => bash.execute('call', { command: 'touch SHOULD_NOT_EXIST' }))).rejects.toThrow('Session access denied');
    }
    expect(extensionCalls).toBe(0);
    expect((await run(identity(), () => session.extensionRunner!.emitToolCall({ type: 'tool_call', toolName: 'bash', toolCallId: 'call', input: { command: 'nope' } } as any)))?.block).toBe(true);
  } finally { session.dispose(); }
}, 20000);

test('direct family session creation denies missing/foreign identity before session artifacts or model resources', async () => {
  const dir = join(ws.workspace, 'uncreated');
  await expect(createSessionInDir(dir, { tools: [], modelRuntime: {} as any, settingsManager: {} as any })).rejects.toThrow('identity is required');
  await expect(run(identity(bob), () => createSessionInDir(dir, { chatJid: alice.homeChatJid!, tools: [], modelRuntime: {} as any, settingsManager: {} as any }))).rejects.toThrow();
  expect(existsSync(dir)).toBe(false);
});

test('production session creation installs guarded definitions and blocks SDK-routed unknown calls', async () => {
  const { modelRuntime } = await createRealTestModelServices(join(ws.workspace, 'agent'));
  let bypass = 0;
  const override: ToolDefinition = { name: 'read', label: 'read', description: 'test override', parameters: Type.Object({ path: Type.String() }), execute: async () => { bypass++; return { content: [{ type: 'text', text: 'bypass' }], details: {} }; } };
  const runtime = await run(identity(), () => createSessionInDir(join(ws.workspace, 'sessions'), {
    chatJid: alice.homeChatJid!, tools: [], modelRuntime, settingsManager: SettingsManager.inMemory({ compaction: { enabled: false } }), customTools: [override],
  }));
  try {
    runtime.session.setActiveToolsByName(['read', 'write']);
    const read = runtime.session.agent.state.tools.find(tool => tool.name === 'read')!;
    expect(JSON.stringify(await run(identity(), () => read.execute('call', { path: join(ws.workspace, 'sample.txt') })))).toContain('shared test content');
    const write = runtime.session.agent.state.tools.find(tool => tool.name === 'write')!;
    await expect(run(identity(), () => write.execute('call', { path: join(ws.workspace, 'forbidden'), content: 'x' }))).rejects.toThrow('Session access denied');
    expect((await run(identity(), () => runtime.session.extensionRunner!.emitToolCall({ type: 'tool_call', toolName: 'unknown-addon', toolCallId: 'call', input: {} } as any)))?.block).toBe(true);
    expect(bypass).toBe(0); expect(existsSync(join(ws.workspace, 'forbidden'))).toBe(false);
  } finally { await runtime.dispose(); }
}, 20000);
