import { expect, test } from 'bun:test';
import { handleAgentPanelToggle } from '../../web/src/ui/app-agent-panel-toggle.js';
import { refreshAgentStatusForChat } from '../../web/src/ui/app-agent-status-orchestration.js';
function deferred<T>() { let resolve!: (value: T) => void; const promise = new Promise<T>(yes => { resolve = yes; }); return { promise, resolve }; }
function panel() {
  const state = { thought: { fullText: 'initial', totalLines: 1 } as any };
  const options = { panelKey: 'thought', expanded: true, currentTurnIdRef: { current: 'turn-a' as string | null }, thoughtExpandedRef: { current: false }, draftExpandedRef: { current: false }, thoughtBufferRef: { current: 'initial' }, draftBufferRef: { current: '' }, setAgentThoughtVisibility: async () => {}, getAgentThought: async () => ({ text: 'saved', total_lines: 1 }), setAgentThought: (next: any) => { state.thought = typeof next === 'function' ? next(state.thought) : next; }, setAgentDraft: () => {} };
  return { options, state };
}
for (const change of ['live text', 'turn', 'collapse', 'second expansion']) test(`thought expansion ignores delayed fetch after ${change}`, async () => {
  const { options, state } = panel(), pending = deferred<any>();
  options.getAgentThought = () => pending.promise;
  const run = handleAgentPanelToggle(options);
  await Promise.resolve();
  if (change === 'live text') { options.thoughtBufferRef.current = 'new live thought'; state.thought.fullText = 'new live thought'; }
  if (change === 'turn') { options.currentTurnIdRef.current = 'turn-b'; options.thoughtBufferRef.current = 'new turn'; state.thought.fullText = 'new turn'; }
  if (change === 'collapse') await handleAgentPanelToggle({ ...options, expanded: false });
  if (change === 'second expansion') {
    options.getAgentThought = async () => ({ text: 'newer fetch', total_lines: 1 });
    await handleAgentPanelToggle(options);
  }
  const expected = state.thought.fullText;
  pending.resolve({ text: 'old fetched thought', total_lines: 9 });
  await run;
  expect(state.thought.fullText).toBe(expected);
  expect(options.thoughtBufferRef.current).not.toBe('old fetched thought');
});
for (const change of ['thought', 'draft', 'status', 'turn']) for (const responseKind of ['active', 'idle']) test(`status ${responseKind} cannot overwrite ${change} arriving during request`, async () => {
  const pending = deferred<any>(), changes: any[] = [];
  const options: any = { currentChatJid: 'chat-a', currentTurnIdRef: { current: 'turn-a' }, getAgentStatus: () => pending.promise, activeChatJidRef: { current: 'chat-a' }, wasAgentActiveRef: { current: true }, viewStateRef: { current: {} }, refreshTimeline: () => {}, clearAgentRunState: () => changes.push('clear'), agentStatusRef: { current: { type: 'thinking', turn_id: 'turn-a' } }, pendingRequestRef: { current: null }, thoughtBufferRef: { current: 'initial' }, draftBufferRef: { current: '' }, setAgentStatus: (value: any) => changes.push(value), setAgentDraft: (value: any) => changes.push(value), setAgentPlan: () => {}, setAgentThought: (value: any) => changes.push(value), setPendingRequest: () => {}, setExtensionWorkingState: () => {}, setActiveTurn: (value: any) => changes.push(value), noteAgentActivity: () => {}, clearLastActivityFlag: () => {} };
  const run = refreshAgentStatusForChat(options);
  if (change === 'thought') options.thoughtBufferRef.current = 'new thought';
  if (change === 'draft') options.draftBufferRef.current = 'new draft';
  if (change === 'status') options.agentStatusRef.current = { type: 'tool_call' };
  if (change === 'turn') options.currentTurnIdRef.current = 'turn-b';
  pending.resolve(responseKind === 'idle' ? { status: 'idle' } : { status: 'active', data: { type: 'thinking', turn_id: 'turn-a' }, thought: { text: 'previous long thought snapshot', total_lines: 5 } });
  expect(await run).toBeNull();
  expect(changes).toEqual([]);
});
