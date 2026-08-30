import type { ModelCataloguePreferences, ModelCatalogueSort } from './model-catalogue.ts';

export const MODEL_CATALOGUE_PREFERENCES_STORAGE_KEY = 'piclaw:model-catalogue-preferences:v1';
export const MODEL_CATALOGUE_PREFERENCES_EVENT = 'piclaw:model-catalogue-preferences-changed';
export const MODEL_CATALOGUE_RECENT_LIMIT = 24;

export interface StoredModelCataloguePreferences {
  pinnedKeys: string[];
  recentByKey: Record<string, string>;
  sort: ModelCatalogueSort;
  compatibleOnly: boolean;
}

interface StorageLike {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

interface PreferenceRuntime {
  localStorage?: StorageLike;
  dispatchEvent?: (event: Event) => boolean;
}

const VALID_SORTS = new Set<ModelCatalogueSort>(['recommended', 'name', 'context', 'input-price', 'output-price']);

function emptyPreferences(): StoredModelCataloguePreferences {
  return { pinnedKeys: [], recentByKey: {}, sort: 'recommended', compatibleOnly: false };
}

export function normalizeModelCataloguePreferenceKey(value: unknown): string {
  const key = typeof value === 'string' ? value.trim() : '';
  const slashIndex = key.indexOf('/');
  if (slashIndex <= 0 || slashIndex === key.length - 1) return '';
  return `${key.slice(0, slashIndex).toLowerCase()}${key.slice(slashIndex)}`;
}

function normalizeTimestamp(value: unknown): string | null {
  const timestamp = typeof value === 'string' ? value.trim() : '';
  return timestamp && Number.isFinite(Date.parse(timestamp)) ? new Date(timestamp).toISOString() : null;
}

export function normaliseStoredModelCataloguePreferences(value: unknown): StoredModelCataloguePreferences {
  if (!value || typeof value !== 'object') return emptyPreferences();
  const candidate = value as Partial<StoredModelCataloguePreferences>;
  const pinnedKeys = Array.from(new Set(
    (Array.isArray(candidate.pinnedKeys) ? candidate.pinnedKeys : [])
      .map(normalizeModelCataloguePreferenceKey)
      .filter(Boolean),
  ));
  const recentEntries = Object.entries(candidate.recentByKey && typeof candidate.recentByKey === 'object' ? candidate.recentByKey : {})
    .map(([rawKey, rawTimestamp]) => [normalizeModelCataloguePreferenceKey(rawKey), normalizeTimestamp(rawTimestamp)] as const)
    .filter((entry): entry is readonly [string, string] => Boolean(entry[0] && entry[1]))
    .sort((left, right) => Date.parse(right[1]) - Date.parse(left[1]))
    .slice(0, MODEL_CATALOGUE_RECENT_LIMIT);
  return {
    pinnedKeys,
    recentByKey: Object.fromEntries(recentEntries),
    sort: VALID_SORTS.has(candidate.sort as ModelCatalogueSort) ? candidate.sort as ModelCatalogueSort : 'recommended',
    compatibleOnly: candidate.compatibleOnly === true,
  };
}

function runtimeStorage(runtime: PreferenceRuntime | null | undefined): StorageLike | null {
  try {
    return runtime?.localStorage ?? null;
  } catch {
    return null;
  }
}

export function readModelCataloguePreferences(
  runtime: PreferenceRuntime | null = typeof window !== 'undefined' ? window : null,
): StoredModelCataloguePreferences {
  try {
    const raw = runtimeStorage(runtime)?.getItem(MODEL_CATALOGUE_PREFERENCES_STORAGE_KEY);
    return raw ? normaliseStoredModelCataloguePreferences(JSON.parse(raw)) : emptyPreferences();
  } catch {
    return emptyPreferences();
  }
}

export function writeModelCataloguePreferences(
  value: unknown,
  runtime: PreferenceRuntime | null = typeof window !== 'undefined' ? window : null,
): StoredModelCataloguePreferences {
  const preferences = normaliseStoredModelCataloguePreferences(value);
  try {
    runtimeStorage(runtime)?.setItem(MODEL_CATALOGUE_PREFERENCES_STORAGE_KEY, JSON.stringify(preferences));
  } catch (error) {
    console.debug('[model-catalogue-preferences] Storage unavailable; keeping the in-memory preference result.', error);
  }
  try {
    runtime?.dispatchEvent?.(new CustomEvent(MODEL_CATALOGUE_PREFERENCES_EVENT, { detail: preferences }));
  } catch (error) {
    console.debug('[model-catalogue-preferences] Preference event delivery unavailable.', error);
  }
  return preferences;
}

export function toModelCatalogueNormalisePreferences(
  preferences: StoredModelCataloguePreferences,
): ModelCataloguePreferences {
  return { pinnedKeys: preferences.pinnedKeys, recentByKey: preferences.recentByKey };
}

export function togglePinnedModelKey(
  key: string,
  runtime: PreferenceRuntime | null = typeof window !== 'undefined' ? window : null,
): StoredModelCataloguePreferences {
  const normalizedKey = normalizeModelCataloguePreferenceKey(key);
  const current = readModelCataloguePreferences(runtime);
  if (!normalizedKey) return current;
  const pinned = new Set(current.pinnedKeys);
  if (pinned.has(normalizedKey)) pinned.delete(normalizedKey);
  else pinned.add(normalizedKey);
  return writeModelCataloguePreferences({ ...current, pinnedKeys: Array.from(pinned) }, runtime);
}

export function recordRecentModelKey(
  key: string,
  usedAt = new Date().toISOString(),
  runtime: PreferenceRuntime | null = typeof window !== 'undefined' ? window : null,
): StoredModelCataloguePreferences {
  const normalizedKey = normalizeModelCataloguePreferenceKey(key);
  const timestamp = normalizeTimestamp(usedAt);
  const current = readModelCataloguePreferences(runtime);
  if (!normalizedKey || !timestamp) return current;
  return writeModelCataloguePreferences({
    ...current,
    recentByKey: { ...current.recentByKey, [normalizedKey]: timestamp },
  }, runtime);
}

export function setModelCataloguePreferenceSort(
  sort: ModelCatalogueSort,
  runtime: PreferenceRuntime | null = typeof window !== 'undefined' ? window : null,
): StoredModelCataloguePreferences {
  const current = readModelCataloguePreferences(runtime);
  return writeModelCataloguePreferences({ ...current, sort }, runtime);
}
