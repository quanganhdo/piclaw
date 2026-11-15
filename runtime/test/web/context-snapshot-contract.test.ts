import { afterEach, expect, test } from 'bun:test';
import {
  getContextUsageRevision,
  mergeContextUsage,
  normalizeContextUsage,
  reconcileContextUsageForChat,
  refreshContextUsageForChat,
  resetContextSessionGenerationsForTests,
  restoreContextUsage,
} from '../../web/src/ui/app-status-refresh-orchestration.js';

const originalWindow = (globalThis as any).window;
afterEach(() => {
  (globalThis as any).window = originalWindow;
  resetContextSessionGenerationsForTests();
});
const oldUsage = { tokens: 777, contextWindow: 10000, percent: 7.77, sessionGeneration: 'stable-session',
  cacheUsage: { latest: { inputTokens: 100, cacheReadTokens: 300, cacheHitRate: 75 } } };
const unknown = { tokens: null, contextWindow: null, percent: null, sessionGeneration: 'stable-session', contextUpdate: 'replace' };

function memoryStorage() {
  const data = new Map<string, string>();
  (globalThis as any).window = { localStorage: {
    getItem: (key: string) => data.get(key) ?? null,
    setItem: (key: string, value: string) => { data.set(key, value); },
  } };
}

test('public replacement clears same-session meters and preserves independent cache usage', () => {
  const previous = normalizeContextUsage(oldUsage);
  const result = mergeContextUsage(previous, unknown);
  expect(result).toMatchObject({ tokens: null, contextWindow: null, percent: null, sessionGeneration: 'stable-session' });
  expect(result?.cacheUsage).toEqual(previous?.cacheUsage);
  expect(normalizeContextUsage(unknown)?.contextUpdate).toBe('replace');
  expect(normalizeContextUsage({ ...unknown, contextUpdate: 'unrecognised' })).not.toHaveProperty('contextUpdate');
});

test('partial/cache-only legacy updates preserve known meters; fresh zero/positive estimates remain valid', () => {
  expect(mergeContextUsage(oldUsage, { tokens: null, percent: null, sessionGeneration: 'stable-session' }))
    .toMatchObject({ tokens: 777, percent: 7.77 });
  expect(mergeContextUsage(oldUsage, { sessionGeneration: 'stable-session', cacheUsage: { latest: { cacheHitRate: 90 } } }))
    .toMatchObject({ tokens: 777, percent: 7.77, cacheUsage: { latest: { cacheHitRate: 90 } } });
  for (const tokens of [0, 42]) {
    expect(mergeContextUsage(oldUsage, { ...unknown, tokens, contextWindow: 10000, percent: tokens / 100 }))
      .toMatchObject({ tokens, contextWindow: 10000, percent: tokens / 100 });
  }
});

test('same-identity reset clears meters even for the older explicit reset envelope', () => {
  const previous = reconcileContextUsageForChat('chat:reset', null, oldUsage, { authoritative: true });
  const { contextUpdate: _mode, ...boundary } = unknown;
  expect(reconcileContextUsageForChat('chat:reset', previous, boundary, { reset: true }))
    .toMatchObject({ tokens: null, percent: null, sessionGeneration: 'stable-session', cacheUsage: previous?.cacheUsage });
});

test('authoritative polling replaces only the current page revision without persisting estimates', async () => {
  memoryStorage();
  let state = reconcileContextUsageForChat('chat:poll', null, oldUsage, { authoritative: true });
  expect(restoreContextUsage('chat:poll')?.tokens).toBe(777);
  await refreshContextUsageForChat({
    currentChatJid: 'chat:poll', activeChatJidRef: { current: 'chat:poll' }, getAgentContext: async () => unknown,
    setContextUsage: next => { state = typeof next === 'function' ? next(state) : next; },
  });
  expect(state).toMatchObject({ tokens: null, contextWindow: null, percent: null, cacheUsage: { latest: { cacheHitRate: 75 } } });
  expect(restoreContextUsage('chat:poll')).toEqual(state);
});

test('an unchanged unknown boundary fences a late poll without reviving historical storage', async () => {
  memoryStorage();
  let state = reconcileContextUsageForChat('chat:race', null, unknown, { authoritative: true });
  // Simulate a stale cached value surviving a previous storage write failure.
  (globalThis as any).window.localStorage.setItem('piclaw:ctx:chat:race',JSON.stringify(oldUsage));
  let resolve!: (value: unknown) => void;
  const response = new Promise<unknown>(done => { resolve = done; });
  const pending = refreshContextUsageForChat({
    currentChatJid: 'chat:race', activeChatJidRef: { current: 'chat:race' }, getAgentContext: () => response,
    setContextUsage: next => { state = typeof next === 'function' ? next(state) : next; },
  });
  const before = getContextUsageRevision('chat:race');
  state = reconcileContextUsageForChat('chat:race', state, unknown);
  expect(getContextUsageRevision('chat:race')).toBeGreaterThan(before);
  expect(restoreContextUsage('chat:race')?.tokens).toBeNull();
  resolve({ ...oldUsage, contextUpdate: 'replace' });
  await pending;
  expect(state?.tokens).toBeNull();
  expect(restoreContextUsage('chat:race')?.tokens).toBeNull();
});

test('old-generation replacement events and late polling cannot cross the current generation', () => {
  const previous = reconcileContextUsageForChat('chat:generation', null, { ...oldUsage, sessionGeneration: 'new-session' }, { authoritative: true });
  const revision = getContextUsageRevision('chat:generation');
  expect(reconcileContextUsageForChat('chat:generation', previous, unknown)).toEqual(previous);
  expect(getContextUsageRevision('chat:generation')).toBe(revision);
  expect(reconcileContextUsageForChat('chat:generation', previous, unknown, {
    authoritative: true, expectedSessionGeneration: 'stable-session', expectedRevision: revision,
  })).toEqual(previous);
});
