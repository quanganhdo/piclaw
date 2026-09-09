import { expect, test } from 'bun:test';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { createTempWorkspace, setEnv } from '../helpers.js';
import { installAddonRuntimeApi, resetAddonRuntimeContributionsForTests, setAddonAgentMessageEnqueuer } from '../../src/addons/runtime-contributions.js';
import { withExecutionIdentity, type ExecutionIdentity } from '../../src/core/execution-context.js';

function setup() {
  const workspace = createTempWorkspace('addon-enqueue-boundary-');
  const restore = setEnv({ PICLAW_WORKSPACE: workspace.workspace, PICLAW_STORE: workspace.store, PICLAW_DATA: workspace.data });
  mkdirSync(join(workspace.workspace, '.piclaw'));
  const path = join(workspace.workspace, '.piclaw', 'config.json');
  const configure = (mode: 'single-user' | 'family-shared') => writeFileSync(path, JSON.stringify({ domains: { access: { mode } } }));
  resetAddonRuntimeContributionsForTests();
  return { path, configure, cleanup: () => { resetAddonRuntimeContributionsForTests(); restore(); workspace.cleanup(); } };
}

const familyIdentity: ExecutionIdentity = {
  mode: 'family-shared', username: 'alice', displayName: 'Alice', role: 'member', rootChatJid: 'web:alice',
  provenance: { actorUserId: 'alice', ownerUserId: 'alice', chatJid: 'web:alice', kind: 'interactive', authenticationSessionId: 'login-a' },
};
const request = { chatJid: 'web:default', content: 'private', source: 'test.addon' };

test('direct add-on enqueue denies family mode before the injected enqueuer', async () => {
  const fixture = setup();
  try {
    fixture.configure('family-shared'); const calls: unknown[] = [];
    setAddonAgentMessageEnqueuer(async value => { calls.push(value); return { status: 'ok', chat_jid: value.chatJid, thread_id: null, created: true }; });
    const api = installAddonRuntimeApi();
    for (const identity of [null, familyIdentity]) await expect(withExecutionIdentity(identity, () => api.enqueueAgentMessage(request))).rejects.toThrow('unavailable in multi-user mode');
    expect(calls).toEqual([]);
  } finally { fixture.cleanup(); }
});

test('retained family context and malformed config deny before the injected enqueuer', async () => {
  const fixture = setup();
  try {
    fixture.configure('single-user'); const calls: unknown[] = [];
    setAddonAgentMessageEnqueuer(async value => { calls.push(value); return { status: 'ok', chat_jid: value.chatJid, thread_id: null, created: true }; });
    const api = installAddonRuntimeApi();
    await expect(withExecutionIdentity(familyIdentity, () => api.enqueueAgentMessage(request))).rejects.toThrow('unavailable in multi-user mode');
    writeFileSync(fixture.path, '{');
    await expect(api.enqueueAgentMessage(request)).rejects.toThrow('access configuration cannot default safely');
    expect(calls).toEqual([]);
  } finally { fixture.cleanup(); }
});

test('single-user direct add-on enqueue retains existing behavior', async () => {
  const fixture = setup();
  try {
    fixture.configure('single-user'); const calls: unknown[] = [];
    setAddonAgentMessageEnqueuer(async value => { calls.push(value); return { status: 'ok', chat_jid: value.chatJid, row_id: 12, thread_id: 12, created: true }; });
    const api = installAddonRuntimeApi();
    await expect(api.enqueueAgentMessage(request)).resolves.toEqual({ status: 'ok', chat_jid: 'web:default', row_id: 12, thread_id: 12, created: true });
    expect(calls).toEqual([request]);
  } finally { fixture.cleanup(); }
});
