import { expect, test } from 'bun:test';

import { shouldAutoScrollToBottom } from '../../web/src/ui/app-timeline-scroll-orchestration.js';

test('shouldAutoScrollToBottom allows snap when user is near bottom', () => {
  expect(shouldAutoScrollToBottom(0)).toBe(true);
  expect(shouldAutoScrollToBottom(-59)).toBe(true);
  expect(shouldAutoScrollToBottom(60)).toBe(true);
});

test('shouldAutoScrollToBottom prevents snap when user scrolled far away', () => {
  expect(shouldAutoScrollToBottom(-151)).toBe(false);
  expect(shouldAutoScrollToBottom(300)).toBe(false);
  expect(shouldAutoScrollToBottom(-100)).toBe(false);
});
