import { expect, test } from 'bun:test';
import { SubmissionFeedback, isSubmissionRunStatus } from '../../web/src/ui/submission-feedback.js';
import { refreshAgentStatusForChat } from '../../web/src/ui/app-agent-status-orchestration.js';

function setup() {
  const writes: unknown[] = [], listeners = new Set<(event: any) => void>();
  const oldWindow = globalThis.window, oldEvent = globalThis.CustomEvent;
  (globalThis as any).CustomEvent = class { constructor(public type: string, public options: any) {} get detail() { return this.options.detail; } };
  (globalThis as any).window = { dispatchEvent: (event: any) => { listeners.forEach(fn => fn(event)); return true; } };
  const feedback = new SubmissionFeedback(state => writes.push(state));
  listeners.add(event => { if (event.type === 'piclaw:submission-run-status' && isSubmissionRunStatus(event.detail.type)) feedback.activity(event.detail.chat_jid, event.detail.thread_id); });
  return { writes, feedback, cleanup() { (globalThis as any).window = oldWindow; (globalThis as any).CustomEvent = oldEvent; } };
}
function options(response: unknown): any {
  return { currentChatJid: 'a', getAgentStatus: async () => response, activeChatJidRef: { current: 'a' }, wasAgentActiveRef: { current: false }, viewStateRef: { current: null }, refreshTimeline: () => {}, clearAgentRunState: () => {}, agentStatusRef: { current: null }, pendingRequestRef: { current: null }, thoughtBufferRef: { current: '' }, draftBufferRef: { current: '' }, setAgentStatus: () => {}, setAgentDraft: () => {}, setAgentPlan: () => {}, setAgentThought: () => {}, setPendingRequest: () => {}, setExtensionWorkingState: () => {}, setActiveTurn: () => {}, noteAgentActivity: () => {}, clearLastActivityFlag: () => {} };
}
for (const type of ['done', 'error']) for (const beforeAck of [true, false]) test(`status poll ${type} clears matching feedback ${beforeAck ? 'before' : 'after'} ack`, async () => {
  const f = setup();
  try {
    const generation = f.feedback.begin('a');
    if (!beforeAck) f.feedback.acknowledged(generation, false, 1, 'timestamp-a');
    await refreshAgentStatusForChat(options({ status: 'idle', data: { type, thread_id: 'timestamp-a' } }));
    if (beforeAck) f.feedback.acknowledged(generation, false, 1, 'timestamp-a');
    expect(f.writes.at(-1)).toBeNull();
  } finally { f.cleanup(); }
});
test('unmatched terminal or idle-only polls do not pretend accepted work completed', async () => {
  const f = setup();
  try {
    const generation = f.feedback.begin('a'); f.feedback.acknowledged(generation, false, 1, 'timestamp-a');
    await refreshAgentStatusForChat(options({ status: 'idle', data: { type: 'done', thread_id: 'previous' } }));
    expect(f.writes.at(-1)).toBe('waiting');
    await refreshAgentStatusForChat(options({ status: 'idle' }));
    expect(f.writes.at(-1)).toBe('waiting');
  } finally { f.cleanup(); }
});
