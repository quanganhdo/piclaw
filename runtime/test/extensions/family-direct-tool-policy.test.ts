import { beforeEach, afterEach, expect, test } from 'bun:test';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { createTempWorkspace, setEnv } from '../helpers.js';
import { initDatabase, getDb, closeDatabase } from '../../src/db/connection.js';
import { getUser } from '../../src/db/users.js';
import { createWebSession, revokeUserWebSessions } from '../../src/db/web-sessions.js';
import { provisionFamilyAccount, updateManagedAccount } from '../../src/db/account-administration.js';
import { updateAdminToolPolicy } from '../../src/db/family-tool-restrictions.js';
import { createOwnedRoot } from '../../src/db/owned-session-lifecycle.js';
import { storeMessage } from '../../src/db/messages.js';
import { resolveRequestPrincipal } from '../../src/channels/web/auth/principal.js';
import { authoriseExecutionIdentity } from '../../src/agent-pool/execution-identity.js';
import { withExecutionIdentity, type ExecutionIdentity } from '../../src/core/execution-context.js';
import { withChatContext } from '../../src/core/chat-context.js';
import { requireFamilyToolAccess } from '../../src/agent-pool/family-tool-access.js';
import { messagesCrud, runMessagesTool } from '../../src/extensions/messages-crud.js';
import { chatTool } from '../../src/extensions/chat-tool.js';
import { getChatTransportDirectories, registerChatTransport, resetChatTransportRegistryForTests } from '../../src/extensions/chat-transport-registry.js';
import { sessionControl, setSessionControlHandler } from '../../src/extensions/session-control.js';
import { sessionStatus, clearSessionStatusForTests, trackToolStart } from '../../src/extensions/session-status.js';
import { inspectOwnedSession } from '../../src/runtime/owned-session-control.js';

let ws: ReturnType<typeof createTempWorkspace>, restore: () => void;
let admin: ReturnType<typeof actor>, alice: ReturnType<typeof actor>, bob: ReturnType<typeof actor>, target: string;
const tools = new Map<string, any>();
const policy = { totp: false, passkey: true, rpId: 'local' };
function actor(id: string) {
  const login = createWebSession(`token-${id}`, id, 3600, 'passkey');
  return resolveRequestPrincipal(new Request('https://local', { headers: { cookie: 'piclaw_session=fixture' } }), { mode: 'family-shared', authEnabled: true }, {
    getSession: () => login, getUser: () => getUser(getDb(), id), getLocalDisplayName: () => 'Unused',
  })!;
}
function identity(owner = alice) {
  return authoriseExecutionIdentity(getDb(), 'family-shared', owner.homeChatJid!, { actorUserId: owner.userId, ownerUserId: owner.userId, chatJid: owner.homeChatJid!, kind: 'interactive', authenticationSessionId: owner.authentication.sessionId! })!;
}
function run<T>(snapshot: ExecutionIdentity, callback: () => T | Promise<T>): Promise<T> { return withExecutionIdentity(snapshot, () => withChatContext(snapshot.provenance.chatJid, 'web', async () => callback())); }
function deny(names: string[], revision = 0) { return updateAdminToolPolicy(getDb(), admin, alice.userId, { confirm_username: 'alice', expected_revision: revision, denied_tools: names }); }
beforeEach(() => {
  ws = createTempWorkspace('piclaw-direct-policy-'); restore = setEnv({ PICLAW_WORKSPACE: ws.workspace, PICLAW_STORE: ws.store, PICLAW_DATA: ws.data });
  mkdirSync(join(ws.workspace, '.piclaw')); writeFileSync(join(ws.workspace, '.piclaw/config.json'), JSON.stringify({ domains: { access: { mode: 'family-shared' } } }));
  closeDatabase(); initDatabase(); admin = actor('default'); clearSessionStatusForTests();
  const users = ['alice', 'bob'].map(name => {
    const user = provisionFamilyAccount(getDb(), admin, { username: name, displayName: name });
    getDb().query("INSERT INTO webauthn_credentials(user_id,rp_id,credential_id,public_key) VALUES (?,'local',?,'key')").run(user.id, name);
    updateManagedAccount(getDb(), admin, user.id, { enabled: true }, policy); return actor(user.id);
  }); [alice, bob] = users as [typeof alice, typeof bob];
  target = createOwnedRoot(getDb(), alice, 'research').chat_jid;
  storeMessage({ id: 'owned', chat_jid: alice.homeChatJid!, sender: alice.userId, sender_name: 'Alice', content: 'OWNED_CONTENT', timestamp: new Date().toISOString(), is_from_me: false, is_bot_message: false });
  trackToolStart(target, 'owned', 'read', {}); trackToolStart(bob.homeChatJid!, 'foreign', 'read', {});
  tools.clear(); const pi = { on: () => {}, registerTool: (tool: any) => tools.set(tool.name, tool) };
  for (const extension of [messagesCrud, chatTool, sessionControl, sessionStatus]) extension(pi as any);
});
afterEach(() => { clearSessionStatusForTests(); resetChatTransportRegistryForTests(); setSessionControlHandler(undefined); closeDatabase(); restore(); ws.cleanup(); });

test('denials apply at direct helpers and registered tools before data or runtime callbacks', async () => {
  deny(['messages', 'chat', 'session_control', 'session_status']); const snapshot = identity(); let inspected = 0, directories = 0;
  const pool = { isActive: () => { inspected++; return false; }, isStreaming: () => { inspected++; return false; } };
  setSessionControlHandler(async request => { inspected++; return inspectOwnedSession(pool, request); });
  registerChatTransport({ id: 'external', kind: 'bang', directory: () => { directories++; return { transport: 'external', generated_at: '', entries: [] }; }, send: async () => { throw Error('must not send'); } });
  const messages = await run(snapshot, () => runMessagesTool({ query: '*' })); expect(messages.details?.error).toBe('access_denied'); expect(JSON.stringify(messages)).not.toContain('OWNED_CONTENT');
  const registeredMessages = await run(snapshot, () => tools.get('messages').execute('call', { action: 'search', query: '*' })); expect(registeredMessages.details.error).toBe('access_denied');
  await expect(run(snapshot, () => getChatTransportDirectories())).rejects.toThrow('Session access denied');
  await expect(run(snapshot, () => tools.get('chat').execute('call', { action: 'directory' }))).rejects.toThrow('Session access denied');
  await expect(run(snapshot, () => inspectOwnedSession(pool, { source_chat_jid: alice.homeChatJid!, target_chat_jid: target, action: 'inspect' }))).rejects.toThrow('Session access denied');
  const control = await run(snapshot, () => tools.get('session_control').execute('call', { target_chat_jid: target, action: 'inspect' })); expect(control.details.ok).toBe(false);
  const status = await run(snapshot, () => tools.get('session_status').execute('call', { action: 'check' })); expect(status.details.error).toBe('access_denied'); expect(status.details.safe_to_restart).toBe(false);
  expect(inspected).toBe(0); expect(directories).toBe(0);
});

test('the existing run retains its snapshot while new runs observe changes, with no owner bleed', async () => {
  const first = identity(); deny(['messages', 'chat', 'session_control', 'session_status']); const restricted = identity();
  const pool = { isActive: () => false, isStreaming: () => false };
  setSessionControlHandler(async request => inspectOwnedSession(pool, request));
  expect(JSON.stringify(await run(first, () => runMessagesTool({ query: '*' })))).toContain('OWNED_CONTENT');
  expect((await run(first, () => getChatTransportDirectories()))[0]?.entries).toHaveLength(2);
  expect((await run(first, () => inspectOwnedSession(pool, { source_chat_jid: alice.homeChatJid!, target_chat_jid: target, action: 'inspect' }))).ok).toBe(true);
  expect((await run(first, () => tools.get('session_status').execute('call', { action: 'list' }))).details.sessions).toHaveLength(1);
  expect((await run(restricted, () => runMessagesTool({ query: '*' }))).details?.error).toBe('access_denied');
  deny([], 1); expect((await run(restricted, () => runMessagesTool({ query: '*' }))).details?.error).toBe('access_denied');
  expect(JSON.stringify(await run(identity(), () => runMessagesTool({ query: '*' })))).toContain('OWNED_CONTENT');
  const results = await Promise.all([
    run(restricted, async () => { await Bun.sleep(5); return runMessagesTool({ query: '*' }); }),
    run(identity(bob), async () => { await Bun.sleep(1); return getChatTransportDirectories(); }),
  ]);
  expect(results[0].details?.error).toBe('access_denied'); expect(results[1][0]?.entries).toHaveLength(1);
  expect(() => requireFamilyToolAccess('messages')).toThrow();
});

test('live revocation, source mismatch, missing snapshot and unknown tools deny even when old policy allows', async () => {
  const snapshot = identity();
  await expect(withExecutionIdentity(snapshot, () => withChatContext(bob.homeChatJid!, 'web', async () => requireFamilyToolAccess('messages')))).rejects.toThrow();
  await expect(run({ ...snapshot, toolPolicy: undefined }, () => requireFamilyToolAccess('messages'))).rejects.toThrow();
  for (const name of ['bash', 'keychain', 'unknown-addon', '__proto__']) await expect(run(snapshot, () => requireFamilyToolAccess(name))).rejects.toThrow();
  revokeUserWebSessions(alice.userId);
  expect((await run(snapshot, () => runMessagesTool({ query: '*' }))).details?.error).toBe('access_denied');
  await expect(run(snapshot, () => getChatTransportDirectories())).rejects.toThrow();
  expect((await run(snapshot, () => tools.get('session_status').execute('call', { action: 'list' }))).details.error).toBe('access_denied');
});

test('policy changes do not weaken existing ownership or action restrictions', async () => {
  const snapshot = identity(), pool = { isActive: () => false, isStreaming: () => false };
  await expect(run(snapshot, () => inspectOwnedSession(pool, { source_chat_jid: alice.homeChatJid!, target_chat_jid: bob.homeChatJid!, action: 'inspect' }))).rejects.toThrow();
  await expect(run(snapshot, () => inspectOwnedSession(pool, { source_chat_jid: alice.homeChatJid!, target_chat_jid: target, action: 'abort' }))).rejects.toThrow();
  expect((await run(snapshot, () => runMessagesTool({ action: 'delete', row_ids: [1] }))).details?.error).toBe('access_denied');
  expect((await run(snapshot, () => tools.get('chat').execute('call', { action: 'send', target_chat_jid: target, content: 'hello' }))).details.error).toContain('disabled');
  // Re-read live role/account at direct invocation without borrowing the target's principal.
  updateManagedAccount(getDb(), admin, alice.userId, { enabled: false }, policy);
  await expect(run(snapshot, () => requireFamilyToolAccess('messages'))).rejects.toThrow();
});

test('single-user keeps existing direct calls, but a stale family context cannot fall through after a config switch', async () => {
  const snapshot = identity();
  writeFileSync(join(ws.workspace, '.piclaw/config.json'), JSON.stringify({ domains: { access: { mode: 'single-user' } } }));
  expect(() => requireFamilyToolAccess('unknown-single-user-tool')).not.toThrow();
  let directories = 0;
  registerChatTransport({ id: 'local', kind: 'local', directory: () => { directories++; return { transport: 'local', generated_at: '', entries: [] }; }, send: async () => { throw Error('unused'); } });
  expect((await getChatTransportDirectories())).toHaveLength(1); expect(directories).toBe(1);
  expect(JSON.stringify(runMessagesTool({ query: '*', chat_jid: alice.homeChatJid! }))).toContain('OWNED_CONTENT');
  expect((await run(snapshot, () => runMessagesTool({ query: '*' }))).details?.error).toBe('access_denied');
  await expect(run(snapshot, () => getChatTransportDirectories())).rejects.toThrow(); expect(directories).toBe(1);
});

test('tool-specific denial does not accidentally require another discovery permission', async () => {
  deny(['chat', 'session_control', 'session_status']); const onlyMessages = identity();
  expect(JSON.stringify(await run(onlyMessages, () => runMessagesTool({ query: '*' })))).toContain('OWNED_CONTENT');
  deny(['messages', 'session_status'], 1); const discovery = identity();
  expect((await run(discovery, () => getChatTransportDirectories()))[0]?.entries).toHaveLength(2);
  const pool = { isActive: () => false, isStreaming: () => false };
  expect((await run(discovery, () => inspectOwnedSession(pool, { source_chat_jid: alice.homeChatJid!, target_chat_jid: target, action: 'inspect' }))).ok).toBe(true);
  expect((await run(discovery, () => tools.get('session_status').execute('call', { action: 'list' }))).details.error).toBe('access_denied');
});
