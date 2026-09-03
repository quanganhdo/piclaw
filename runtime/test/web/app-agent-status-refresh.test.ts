import { expect, test } from 'bun:test';

import {
  readAgentTurnId,
  resolveAgentPreviewRestoreState,
  shouldKeepExistingPreview,
} from '../../web/src/ui/app-agent-status-refresh.js';

test('readAgentTurnId prefers snake_case and falls back to camelCase turn ids', () => {
  expect(readAgentTurnId({ turn_id: 'turn:1', turnId: 'turn:2' })).toBe('turn:1');
  expect(readAgentTurnId({ turnId: 'turn:2' })).toBe('turn:2');
  expect(readAgentTurnId({})).toBeNull();
});

test('resolveAgentPreviewRestoreState normalizes preview payloads', () => {
  expect(resolveAgentPreviewRestoreState({ text: 'hello', totalLines: 3 })).toEqual({
    text: 'hello',
    totalLines: 3,
  });
  expect(resolveAgentPreviewRestoreState({ text: 'world', total_lines: 4 })).toEqual({
    text: 'world',
    totalLines: 4,
  });
  expect(resolveAgentPreviewRestoreState({ text: 'fallback' })).toEqual({
    text: 'fallback',
    totalLines: 0,
  });
  expect(resolveAgentPreviewRestoreState({ text: '', totalLines: 0 })).toEqual({
    text: '',
    totalLines: 0,
  });
});

test('shouldKeepExistingPreview retains longer or equal existing preview text', () => {
  expect(shouldKeepExistingPreview({ text: 'existing text' }, 'short')).toBe(true);
  expect(shouldKeepExistingPreview({ text: 'same' }, 'same')).toBe(true);
  expect(shouldKeepExistingPreview({ text: 'old' }, 'longer incoming')).toBe(false);
  expect(shouldKeepExistingPreview({ text: 'stale' }, '')).toBe(false);
  expect(shouldKeepExistingPreview(null, 'incoming')).toBe(false);
});
