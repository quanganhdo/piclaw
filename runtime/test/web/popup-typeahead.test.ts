import { expect, test } from 'bun:test';
import {
  findPopupTypeaheadMatch,
  isPopupTypeaheadKey,
  resolvePopupTypeaheadMatch,
  updatePopupTypeaheadBuffer,
} from '../../web/src/ui/popup-typeahead.js';

test('detects printable popup typeahead keys', () => {
  expect(isPopupTypeaheadKey({ key: 'a' } as any)).toBe(true);
  expect(isPopupTypeaheadKey({ key: 'A' } as any)).toBe(true);
  expect(isPopupTypeaheadKey({ key: ' ', ctrlKey: false, metaKey: false, altKey: false } as any)).toBe(false);
  expect(isPopupTypeaheadKey({ key: 'ArrowDown' } as any)).toBe(false);
  expect(isPopupTypeaheadKey({ key: 'k', ctrlKey: true } as any)).toBe(false);
  expect(isPopupTypeaheadKey({ key: 'a', defaultPrevented: true })).toBe(false);
  expect(isPopupTypeaheadKey({ key: 'a', repeat: true })).toBe(false);
  expect(isPopupTypeaheadKey({ key: 'a', defaultPrevented: false, repeat: false })).toBe(true);
});

test('resets the typeahead buffer after idle timeout', () => {
  const first = updatePopupTypeaheadBuffer({ value: '', updatedAt: 0 }, 'a', 1000, 700);
  const second = updatePopupTypeaheadBuffer(first, 'b', 1200, 700);
  const third = updatePopupTypeaheadBuffer(second, 'c', 2500, 700);
  expect(first.value).toBe('a');
  expect(second.value).toBe('ab');
  expect(third.value).toBe('c');
});

test('finds prefix matches before substring matches and rotates from active index', () => {
  const items = ['anthropic/claude', 'openai/gpt-4.1', 'google/gemini'];
  expect(findPopupTypeaheadMatch(items, 'gp', 0)).toBe(1);
  expect(findPopupTypeaheadMatch(items, 'mini', 1)).toBe(2);
  expect(findPopupTypeaheadMatch(items, 'cl', 2)).toBe(0);
});

test('normalizes session labels for @handle matching', () => {
  const items = [
    { label: '@alpha — web:default:branch:alpha' },
    { label: '@beta — web:default:branch:beta' },
  ];
  expect(findPopupTypeaheadMatch(items, 'beta', 0, (item) => item.label)).toBe(1);
});

test('refined queries keep the current matching item instead of cycling to the next sibling match', () => {
  const items = ['openai/codex-mini', 'openai/codex', 'openai/codex-pro'];
  expect(resolvePopupTypeaheadMatch(items, 'c', 0)).toBe(0);
  expect(resolvePopupTypeaheadMatch(items, 'co', 0)).toBe(0);
  expect(resolvePopupTypeaheadMatch(items, 'codex', 0)).toBe(0);
});
