import { expect, test } from 'bun:test';
import { SubmissionFeedback, isSubmissionRunStatus, type SubmissionFeedbackState } from '../../web/src/ui/submission-feedback.js';
function fixture() { const writes: SubmissionFeedbackState[] = []; return { writes, feedback: new SubmissionFeedback(state => writes.push(state)) }; }
test('send feedback is immediate but acceptance requires acknowledgement', () => {
  const { writes, feedback } = fixture(); const request = feedback.begin('a');
  expect(writes).toEqual(['sending']);
  feedback.acknowledged(request, false, 10); expect(writes.at(-1)).toBe('waiting');
  feedback.activity('a', 10); expect(writes.at(-1)).toBeNull();
});
test('backend timestamp lifecycle identity matches the durable row acknowledgement', () => {
  const { writes, feedback } = fixture(); const request = feedback.begin('a');
  feedback.acknowledged(request, false, 10, '2026-10-07T20:00:00.001Z');
  expect(writes.at(-1)).toBe('waiting');
  feedback.activity('a', '2026-10-07T20:00:00.001Z');
  expect(writes.at(-1)).toBeNull();
});
test('matched status before ack prevents waiting cue revival', () => {
  const { writes, feedback } = fixture(); const request = feedback.begin('a');
  feedback.activity('a', 10); expect(writes.at(-1)).toBe('sending');
  feedback.acknowledged(request, false, 10); expect(writes.at(-1)).toBeNull();
});
test('other chat and previous thread activity cannot conceal startup wait', () => {
  const { writes, feedback } = fixture(); const request = feedback.begin('a');
  feedback.activity('b', 10); feedback.activity('a', 9); feedback.activity('a');
  feedback.acknowledged(request, false, 10); expect(writes.at(-1)).toBe('waiting');
  feedback.activity('a', 9); expect(writes.at(-1)).toBe('waiting');
  feedback.activity('a', 10); expect(writes.at(-1)).toBeNull();
});
test('queued or command acknowledgements do not claim startup', () => {
  const { writes, feedback } = fixture(); const request = feedback.begin('a');
  feedback.acknowledged(request, true); expect(writes.at(-1)).toBeNull();
});
test('failures and intercepted submissions clear local cue', () => {
  const { writes, feedback } = fixture(); let request = feedback.begin('a');
  feedback.failed(request); expect(writes.at(-1)).toBeNull();
  request = feedback.begin('a'); feedback.finished(request); expect(writes.at(-1)).toBeNull();
});
test('chat reset and later sends reject stale acknowledgement/finally/error', () => {
  const { writes, feedback } = fixture(); const old = feedback.begin('a');
  feedback.reset(); feedback.acknowledged(old, false, 10); expect(writes.at(-1)).toBeNull();
  const next = feedback.begin('b'); feedback.acknowledged(next, false, 20);
  feedback.failed(old); feedback.finished(old); expect(writes.at(-1)).toBe('waiting');
  feedback.finished(next); expect(writes.at(-1)).toBe('waiting');
});
test('bookkeeping and intent updates are not proof of starting the accepted run', () => {
  expect(isSubmissionRunStatus('context_usage')).toBe(false);
  expect(isSubmissionRunStatus('intent')).toBe(false);
  for (const type of ['thinking', 'tool_call', 'waiting', 'pending_request', 'done', 'error']) expect(isSubmissionRunStatus(type)).toBe(true);
});
