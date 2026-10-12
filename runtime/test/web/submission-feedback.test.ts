import { expect, test } from 'bun:test';
import { SubmissionFeedback, type SubmissionFeedbackState } from '../../web/src/ui/submission-feedback.js';
function fixture() { const writes: SubmissionFeedbackState[] = []; return { writes, feedback: new SubmissionFeedback(state => writes.push(state)) }; }
test('sending begins immediately and ends at acknowledgement without a waiting state', () => {
  const { writes, feedback } = fixture(); const request = feedback.begin('a');
  expect(writes).toEqual(['sending']);
  feedback.acknowledged(request); expect(writes).toEqual(['sending', null]);
  feedback.finished(request); expect(writes.at(-1)).toBeNull();
});
test('failures and intercepted submissions clear only transient sending feedback', () => {
  const { writes, feedback } = fixture(); let request = feedback.begin('a');
  feedback.failed(request); expect(writes.at(-1)).toBeNull();
  request = feedback.begin('a'); feedback.finished(request); expect(writes.at(-1)).toBeNull();
});
test('chat reset and newer submission reject stale callbacks', () => {
  const { writes, feedback } = fixture(); const old = feedback.begin('a');
  feedback.reset(); feedback.acknowledged(old); expect(writes.at(-1)).toBeNull();
  const next = feedback.begin('b');
  feedback.acknowledged(old); feedback.failed(old); feedback.finished(old);
  expect(writes.at(-1)).toBe('sending');
  feedback.acknowledged(next); expect(writes.at(-1)).toBeNull();
});
