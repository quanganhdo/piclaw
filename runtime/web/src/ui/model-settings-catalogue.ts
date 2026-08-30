import {
  compareModelCatalogueText,
  filterAndRankModels,
  groupModels,
  type ModelCatalogueEntry,
  type ModelCatalogueFilterState,
  type ModelCatalogueProviderGroup,
  type ModelVariantFilter,
} from './model-catalogue.ts';

export const MODEL_SETTINGS_RENDER_LIMIT = 100;

export interface ModelSettingsFacets {
  providers: string[];
  publishers: string[];
  families: string[];
  variants: ModelVariantFilter[];
}

export interface ModelSettingsProjection {
  groups: ModelCatalogueProviderGroup[];
  renderedEntries: ModelCatalogueEntry[];
  totalMatches: number;
  hiddenCount: number;
  selectedEntry: ModelCatalogueEntry | null;
}

function sorted(values: Iterable<string>): string[] {
  return Array.from(new Set(Array.from(values).filter(Boolean))).sort(compareModelCatalogueText);
}

export function collectModelSettingsFacets(entries: readonly ModelCatalogueEntry[]): ModelSettingsFacets {
  const variants = new Set<ModelVariantFilter>();
  for (const entry of entries) {
    if (entry.variants.length === 0 || !entry.variants.some((variant) => ['preview', 'batch', 'free', 'fast'].includes(variant))) {
      variants.add('stable');
    }
    entry.variants.forEach((variant) => variants.add(variant));
  }
  return {
    providers: sorted(entries.map((entry) => entry.provider || 'unknown')),
    publishers: sorted(entries.map((entry) => entry.publisher ?? '')),
    families: sorted(entries.map((entry) => entry.family ?? '')),
    variants: sorted(variants) as ModelVariantFilter[],
  };
}

export function buildModelSettingsProjection(
  entries: readonly ModelCatalogueEntry[],
  filters: ModelCatalogueFilterState = {},
  selectedKey: string | null = null,
  renderLimit = MODEL_SETTINGS_RENDER_LIMIT,
): ModelSettingsProjection {
  const matched = filterAndRankModels(entries, filters);
  const limit = Math.max(1, Math.min(MODEL_SETTINGS_RENDER_LIMIT, Math.floor(renderLimit)));
  let renderedEntries = matched.slice(0, limit);
  const selectedEntry = matched.find((entry) => entry.key === selectedKey)
    ?? matched.find((entry) => entry.current)
    ?? matched[0]
    ?? null;
  const retainedEntries = [
    matched.find((entry) => entry.current) ?? null,
    selectedEntry,
  ].filter((entry, index, list): entry is ModelCatalogueEntry => Boolean(entry) && list.findIndex((candidate) => candidate?.key === entry?.key) === index);
  const missingRetained = retainedEntries.filter((entry) => !renderedEntries.some((candidate) => candidate.key === entry.key));
  if (missingRetained.length > 0) {
    const retainedKeys = new Set(retainedEntries.map((entry) => entry.key));
    renderedEntries = [
      ...renderedEntries.filter((entry) => !retainedKeys.has(entry.key)).slice(0, Math.max(0, limit - retainedEntries.length)),
      ...retainedEntries,
    ];
  }
  return {
    groups: groupModels(renderedEntries),
    renderedEntries,
    totalMatches: matched.length,
    hiddenCount: Math.max(0, matched.length - renderedEntries.length),
    selectedEntry,
  };
}

export type ModelSettingsNavigationAction = 'next' | 'previous' | 'first' | 'last' | 'page-next' | 'page-previous';

export function moveModelSettingsActiveKey(
  entries: readonly ModelCatalogueEntry[],
  activeKey: string | null | undefined,
  action: ModelSettingsNavigationAction,
  pageSize = 8,
): string | null {
  if (entries.length === 0) return null;
  const currentIndex = entries.findIndex((entry) => entry.key === activeKey);
  const page = Math.max(1, Math.floor(pageSize));
  let nextIndex = currentIndex;
  if (action === 'first') nextIndex = 0;
  if (action === 'last') nextIndex = entries.length - 1;
  if (action === 'next') nextIndex = currentIndex < 0 ? 0 : Math.min(entries.length - 1, currentIndex + 1);
  if (action === 'previous') nextIndex = currentIndex < 0 ? entries.length - 1 : Math.max(0, currentIndex - 1);
  if (action === 'page-next') nextIndex = currentIndex < 0 ? 0 : Math.min(entries.length - 1, currentIndex + page);
  if (action === 'page-previous') nextIndex = currentIndex < 0 ? entries.length - 1 : Math.max(0, currentIndex - page);
  return entries[nextIndex]?.key ?? null;
}

export function formatModelCataloguePrice(value: number | null): string {
  if (value == null) return 'Unknown';
  const digits = value >= 1 ? 2 : 4;
  return `$${value.toFixed(digits).replace(/0+$/, '').replace(/\.$/, '')}`;
}

export function formatModelLastUsed(value: string | null): string {
  if (!value || !Number.isFinite(Date.parse(value))) return 'Never';
  return new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(value));
}
