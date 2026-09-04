import { expect, test } from 'bun:test';

import {
  readPersistedIntermediateTurnId,
  resolveSteerQueuedTurnId,
  shouldAdoptIncomingTurn,
  shouldIgnoreMismatchedTurn,
} from '../../web/src/ui/app-agent-turn-events.js';

test('readPersistedIntermediateTurnId accepts exact typed markers from response envelopes', () => {
  for (const marker of [
    { kind: 'intermediate', cause: 'tool_use', followed_by_tool_use: true },
    { kind: 'intermediate', cause: 'completed_boundary' },
    { kind: 'intermediate', cause: 'failed_boundary' },
    { kind: 'draft_snapshot', cause: 'interrupted_text_start' },
  ]) {
    expect(readPersistedIntermediateTurnId({
      data: {
        content_blocks: [{ type: 'agent_turn_marker', turn_id: 'turn-42', ...marker }],
      },
    })).toBe('turn-42');
  }
});

test('readPersistedIntermediateTurnId rejects contradictory and terminal response metadata', () => {
  for (const marker of [
    { kind: 'intermediate', cause: 'tool_use' },
    { kind: 'intermediate', cause: 'completed_boundary', followed_by_tool_use: true },
    { kind: 'draft_snapshot', cause: 'interrupted_text_start', followed_by_tool_use: true },
    { kind: 'terminal', cause: 'tool_use', followed_by_tool_use: true },
  ]) {
    expect(readPersistedIntermediateTurnId({
      data: {
        content_blocks: [{ type: 'agent_turn_marker', turn_id: 'turn-42', ...marker }],
      },
    })).toBeNull();
  }
});

test('shouldIgnoreMismatchedTurn only blocks events tied to a different active turn', () => {
  expect(shouldIgnoreMismatchedTurn('turn:1', 'turn:2')).toBe(true);
  expect(shouldIgnoreMismatchedTurn('turn:1', 'turn:1')).toBe(false);
  expect(shouldIgnoreMismatchedTurn('turn:1', null)).toBe(false);
  expect(shouldIgnoreMismatchedTurn(null, 'turn:1')).toBe(false);
});

test('shouldAdoptIncomingTurn mirrors app turn-adoption semantics', () => {
  expect(shouldAdoptIncomingTurn('turn:1', null)).toBe(true);
  expect(shouldAdoptIncomingTurn('turn:1', 'turn:2')).toBe(false);
  expect(shouldAdoptIncomingTurn('', null)).toBe(false);
});

test('resolveSteerQueuedTurnId prefers event turn id and falls back to current turn', () => {
  expect(resolveSteerQueuedTurnId('turn:1', 'turn:2')).toBe('turn:1');
  expect(resolveSteerQueuedTurnId(null, 'turn:2')).toBe('turn:2');
  expect(resolveSteerQueuedTurnId(undefined, undefined)).toBeNull();
});
