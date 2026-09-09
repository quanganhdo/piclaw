import { expect, test } from 'bun:test';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { createTempWorkspace, setEnv } from '../helpers.js';
import { createAddonMessagingRuntimeHandlers } from '../../src/addons/runtime-messaging.js';
import { withExecutionIdentity, type ExecutionIdentity } from '../../src/core/execution-context.js';

function setup() {
  const workspace = createTempWorkspace('addon-messaging-boundary-');
  const restore = setEnv({ PICLAW_WORKSPACE: workspace.workspace, PICLAW_STORE: workspace.store, PICLAW_DATA: workspace.data });
  mkdirSync(join(workspace.workspace, '.piclaw'));
  const path = join(workspace.workspace, '.piclaw', 'config.json');
  const configure = (mode: 'single-user' | 'family-shared') => writeFileSync(path, JSON.stringify({ domains: { access: { mode } } }));
  return { path, configure, cleanup: () => { restore(); workspace.cleanup(); } };
}

const familyIdentity: ExecutionIdentity = {
  mode: 'family-shared', username: 'alice', displayName: 'Alice', role: 'member', rootChatJid: 'web:alice',
  provenance: { actorUserId: 'alice', ownerUserId: 'alice', chatJid: 'web:alice', kind: 'interactive', authenticationSessionId: 'login-a' },
};

function handlers(calls: string[]) {
  return createAddonMessagingRuntimeHandlers({
    listKnownChats: () => { calls.push('list'); return [{ chat_jid: 'web:default', agent_name: 'default' }]; },
    findChatByAgentName: () => { calls.push('resolve'); return { chat_jid: 'web:default', agent_name: 'default' }; },
    enqueueAgentMessage: async () => { calls.push('enqueue'); return { status: 'ok', chat_jid: 'web:default', row_id: 1, thread_id: 1, created: true }; },
  });
}

const delivery = {
  target_agent_name: 'default', content: 'private',
  source: { peer_instance_id: 'peerInstance_123456', peer_fingerprint: 'fingerprint', message_id: 'message-1' },
};

test('add-on messaging list resolve and delivery deny family mode before global callbacks or attachment parsing', async () => {
  const fixture = setup();
  try {
    fixture.configure('family-shared'); const calls: string[] = []; const runtime = handlers(calls);
    for (const identity of [null, familyIdentity]) {
      expect(() => withExecutionIdentity(identity, () => runtime.listAdvertisableAgents())).toThrow('unavailable in multi-user mode');
      expect(() => withExecutionIdentity(identity, () => runtime.resolveLocalTarget({ target_agent_name: 'default' }))).toThrow('unavailable in multi-user mode');
      await expect(withExecutionIdentity(identity, () => runtime.deliverPeerMessage({ ...delivery, attachments: [{} as any] }))).rejects.toThrow('unavailable in multi-user mode');
    }
    expect(calls).toEqual([]);
  } finally { fixture.cleanup(); }
});

test('retained family context and malformed access config cannot reach add-on messaging callbacks', async () => {
  const fixture = setup();
  try {
    fixture.configure('single-user'); const calls: string[] = []; const runtime = handlers(calls);
    expect(() => withExecutionIdentity(familyIdentity, () => runtime.listAdvertisableAgents())).toThrow('unavailable in multi-user mode');
    writeFileSync(fixture.path, '{');
    expect(() => runtime.resolveLocalTarget({ target_agent_name: 'default' })).toThrow('access configuration cannot default safely');
    expect(calls).toEqual([]);
  } finally { fixture.cleanup(); }
});

test('single-user add-on messaging retains existing list resolve and delivery behavior', async () => {
  const fixture = setup();
  try {
    fixture.configure('single-user'); const calls: string[] = []; const runtime = handlers(calls);
    expect(await runtime.listAdvertisableAgents()).toEqual([{ agent_name: 'default', active: false }]);
    expect(await runtime.resolveLocalTarget({ target_agent_name: 'default' })).toMatchObject({ status: 'resolved', target_agent_name: 'default' });
    await expect(runtime.deliverPeerMessage(delivery)).resolves.toMatchObject({ status: 'ok', chat_jid: 'web:default' });
    expect(calls).toContain('list'); expect(calls).toContain('enqueue');
  } finally { fixture.cleanup(); }
});
