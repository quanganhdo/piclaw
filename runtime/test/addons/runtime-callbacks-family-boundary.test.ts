import { expect, test } from 'bun:test';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { createTempWorkspace, setEnv } from '../helpers.js';
import {
  getAddonStatusPanelPayload, registerAddonAdaptiveCardIntentHandler, registerAddonStatusPanelProvider,
  resetAddonRuntimeContributionsForTests, runAddonAdaptiveCardIntent, runAddonStatusPanelAction,
} from '../../src/addons/runtime-contributions.js';
import { withExecutionIdentity, type ExecutionIdentity } from '../../src/core/execution-context.js';

function setup() {
  const workspace = createTempWorkspace('addon-callback-boundary-');
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

function register(calls: string[]) {
  registerAddonStatusPanelProvider({ key: 'test', getPayload: () => { calls.push('payload'); return { ok: true }; }, runAction: () => { calls.push('action'); return { ok: true }; } });
  registerAddonAdaptiveCardIntentHandler('test', context => { calls.push('intent'); return context.sendMessage('private'); });
}
const cardContext = { chatJid: 'web:alice', rawSubmissionData: {}, sendMessage: async () => {} };

test('add-on status and card callbacks deny family mode before handler execution', async () => {
  const fixture = setup();
  try {
    fixture.configure('family-shared'); const calls: string[] = []; register(calls);
    for (const identity of [null, familyIdentity]) {
      await expect(withExecutionIdentity(identity, () => getAddonStatusPanelPayload('test', 'web:alice'))).rejects.toThrow('unavailable in multi-user mode');
      await expect(withExecutionIdentity(identity, () => runAddonStatusPanelAction('test', 'stop', { chat_jid: 'web:alice' }))).rejects.toThrow('unavailable in multi-user mode');
      await expect(withExecutionIdentity(identity, () => runAddonAdaptiveCardIntent('test', cardContext))).rejects.toThrow('unavailable in multi-user mode');
    }
    expect(calls).toEqual([]);
  } finally { fixture.cleanup(); }
});

test('retained family context and malformed config deny add-on callbacks', async () => {
  const fixture = setup();
  try {
    fixture.configure('single-user'); const calls: string[] = []; register(calls);
    await expect(withExecutionIdentity(familyIdentity, () => getAddonStatusPanelPayload('test', 'web:alice'))).rejects.toThrow('unavailable in multi-user mode');
    writeFileSync(fixture.path, '{');
    await expect(runAddonStatusPanelAction('test', 'stop', {})).rejects.toThrow('access configuration cannot default safely');
    expect(calls).toEqual([]);
  } finally { fixture.cleanup(); }
});

test('single-user add-on status and card callbacks retain existing behavior', async () => {
  const fixture = setup();
  try {
    fixture.configure('single-user'); const calls: string[] = []; register(calls);
    await expect(getAddonStatusPanelPayload('test', 'web:alice')).resolves.toEqual({ ok: true });
    await expect(runAddonStatusPanelAction('test', 'stop', {})).resolves.toEqual({ ok: true });
    await expect(runAddonAdaptiveCardIntent('test', cardContext)).resolves.toBe(true);
    expect(calls).toEqual(['payload', 'action', 'intent']);
  } finally { fixture.cleanup(); }
});
