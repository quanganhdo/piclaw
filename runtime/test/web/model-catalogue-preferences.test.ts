import { expect, test } from 'bun:test';

import {
  MODEL_CATALOGUE_PREFERENCES_STORAGE_KEY,
  MODEL_CATALOGUE_RECENT_LIMIT,
  normaliseStoredModelCataloguePreferences,
  readModelCataloguePreferences,
  recordRecentModelKey,
  togglePinnedModelKey,
} from '../../web/src/ui/model-catalogue-preferences.ts';

function createRuntime(initial: unknown = null) {
  const store = new Map<string, string>();
  if (initial != null) store.set(MODEL_CATALOGUE_PREFERENCES_STORAGE_KEY, JSON.stringify(initial));
  return {
    localStorage: {
      getItem: (key: string) => store.get(key) ?? null,
      setItem: (key: string, value: string) => void store.set(key, value),
    },
    dispatchEvent: () => true,
  };
}

test('model catalogue preferences normalise keys, timestamps, sort and bounds', () => {
  const recentByKey = Object.fromEntries(Array.from({ length: MODEL_CATALOGUE_RECENT_LIMIT + 5 }, (_, index) => [
    `OPENROUTER/publisher/model-${index}`,
    new Date(Date.UTC(2026, 0, index + 1)).toISOString(),
  ]));
  const value = normaliseStoredModelCataloguePreferences({
    pinnedKeys: ['OPENROUTER/publisher/model-1', 'openrouter/publisher/model-1', 'malformed'],
    recentByKey: { ...recentByKey, broken: 'not-a-date' },
    sort: 'output-price',
    compatibleOnly: true,
  });
  expect(value.pinnedKeys).toEqual(['openrouter/publisher/model-1']);
  expect(Object.keys(value.recentByKey)).toHaveLength(MODEL_CATALOGUE_RECENT_LIMIT);
  expect(Object.keys(value.recentByKey)[0]).toBe(`openrouter/publisher/model-${MODEL_CATALOGUE_RECENT_LIMIT + 4}`);
  expect(value.sort).toBe('output-price');
  expect(value.compatibleOnly).toBe(true);
});

test('pinning and confirmed recency share one persisted preference record', () => {
  const runtime = createRuntime();
  togglePinnedModelKey('OpenAI/gpt-5', runtime as any);
  recordRecentModelKey('OpenAI/gpt-5', '2026-08-28T20:00:00.000Z', runtime as any);
  const value = readModelCataloguePreferences(runtime as any);
  expect(value.pinnedKeys).toEqual(['openai/gpt-5']);
  expect(value.recentByKey).toEqual({ 'openai/gpt-5': '2026-08-28T20:00:00.000Z' });

  togglePinnedModelKey('openai/gpt-5', runtime as any);
  expect(readModelCataloguePreferences(runtime as any).pinnedKeys).toEqual([]);
});

test('invalid or unavailable persisted preferences fall back safely', () => {
  expect(readModelCataloguePreferences({ localStorage: { getItem: () => '{', setItem() {} } } as any)).toEqual({
    pinnedKeys: [], recentByKey: {}, sort: 'recommended', compatibleOnly: false,
  });
  expect(normaliseStoredModelCataloguePreferences({ sort: 'random' })).toEqual({
    pinnedKeys: [], recentByKey: {}, sort: 'recommended', compatibleOnly: false,
  });
});
