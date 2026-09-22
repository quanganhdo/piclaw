export interface ModelStateUpdate {
  hasModel: boolean;
  model: unknown;
  hasThinkingLevel: boolean;
  thinkingLevel: unknown;
  thinkingLevelLabel: unknown;
  hasSupportsThinking: boolean;
  supportsThinking: boolean;
  hasProviderUsage: boolean;
  providerUsage: unknown;
}

const EMPTY_MODEL_STATE_UPDATE: ModelStateUpdate = {
  hasModel: false,
  model: undefined,
  hasThinkingLevel: false,
  thinkingLevel: null,
  thinkingLevelLabel: null,
  hasSupportsThinking: false,
  supportsThinking: false,
  hasProviderUsage: false,
  providerUsage: null,
};

export function resolveModelStateUpdate(payload: Record<string, unknown> | null | undefined): ModelStateUpdate {
  if (!payload || typeof payload !== 'object') {
    return EMPTY_MODEL_STATE_UPDATE;
  }

  const nextModel = payload.model ?? payload.current;

  return {
    hasModel: nextModel !== undefined,
    model: nextModel,
    hasThinkingLevel: payload.thinking_level !== undefined || payload.thinking_level_label !== undefined,
    thinkingLevel: payload.thinking_level ?? null,
    thinkingLevelLabel: payload.thinking_level_label ?? payload.thinking_level ?? null,
    hasSupportsThinking: payload.supports_thinking !== undefined,
    supportsThinking: Boolean(payload.supports_thinking),
    hasProviderUsage: payload.provider_usage !== undefined,
    providerUsage: payload.provider_usage ?? null,
  };
}

/** Merge partial status/SSE payloads without erasing unrelated selection fields.
 * Explicit model changes invalidate old model-specific metadata; callers scope
 * this state to one chat and reset it on a real chat switch. */
export function mergeModelStatePayload(previous: Record<string, any> | null, incoming: Record<string, any> | null | undefined): Record<string, any> | null {
  if (!incoming || typeof incoming !== 'object') return previous;
  const update = resolveModelStateUpdate(incoming);
  const prior = previous?.current ?? previous?.model ?? null;
  const changed = update.hasModel && update.model !== prior;
  const base = changed ? {
    current: null, thinking_level: null, thinking_level_label: null,
    supports_thinking: false, model_options: [], provider_usage: null,
  } : previous || {};
  const next = { ...base, ...Object.fromEntries(Object.entries(incoming).filter(([,value]) => value !== undefined)) };
  if (update.hasModel) { next.current = update.model; delete next.model; }
  // A raw-level-only event must replace its stale human-readable label.
  if (incoming.thinking_level !== undefined && incoming.thinking_level_label === undefined) next.thinking_level_label = incoming.thinking_level;
  if (incoming.supports_thinking === undefined && (incoming.thinking_level || incoming.thinking_level_label)) next.supports_thinking = true;
  if (incoming.supports_thinking === false || (update.hasModel && update.model === null)) {
    next.thinking_level = null; next.thinking_level_label = null;
  }
  return JSON.stringify(next) === JSON.stringify(previous) ? previous : next;
}
