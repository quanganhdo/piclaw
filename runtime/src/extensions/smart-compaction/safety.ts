/**
 * Extracted smart-compaction helper module.
 *
 * Keep this module focused; the public extension facade remains
 * ../smart-compaction.ts.
 */

import {
  BUDGET_SAFETY_MARGIN,
  MAX_KEEP_RECENT_FRACTION,
  MIN_COMPACTION_OUTPUT_TOKENS,
  PROGRESSIVE_FALLBACK_CONTEXT_WINDOW,
  type CompactionReasoningEffort,
  type CompactionReasoningPhase,
  getConfiguredCompactionReasoningEffort,
} from "./config.js";
import { applyTokenEstimateSafetyMultiplier, getCompactionRequestOverheadTokens, getEffectiveContextWindow, getSystemPromptOverheadTokens } from "../../utils/context-window-budget.js";
import { estimateCompactionPromptTokens, estimateTokensFromChars, getModelContextWindow } from "./context.js";


// ---------------------------------------------------------------------------
// Post-compaction verification and keepRecentTokens clamping
// ---------------------------------------------------------------------------

/**
 * Clamp keepRecentTokens to at most MAX_KEEP_RECENT_FRACTION of the effective
 * context window (after subtracting system prompt overhead). Prevents the kept
 * window from consuming so much context that summary + system prompt + tools
 * don't fit.
 */
export function clampKeepRecentTokens(keepRecentTokens: number, contextWindow: number): number {
  const effectiveWindow = getEffectiveContextWindow(contextWindow, getSystemPromptOverheadTokens());
  const maxKeep = Math.floor(effectiveWindow * MAX_KEEP_RECENT_FRACTION);
  return Math.max(0, Math.min(Math.floor(keepRecentTokens), maxKeep));
}

/**
 * Estimate whether the post-compaction context will fit in the model's window.
 * Returns the estimated total and whether it overflows.
 */
export function estimatePostCompactionFit(summary: string, keepRecentTokens: number, contextWindow: number): {
  estimatedTotal: number;
  fits: boolean;
  summaryTokens: number;
  overheadTokens: number;
  margin: number;
} {
  const summaryTokens = applyTokenEstimateSafetyMultiplier(estimateTokensFromChars(summary));
  const safeKeepRecentTokens = applyTokenEstimateSafetyMultiplier(keepRecentTokens);
  const overheadTokens = getSystemPromptOverheadTokens();
  const estimatedTotal = summaryTokens + safeKeepRecentTokens + overheadTokens;
  const margin = contextWindow - estimatedTotal;
  return {
    estimatedTotal,
    fits: margin > 0,
    summaryTokens,
    overheadTokens,
    margin,
  };
}

const COMPACTION_REASONING_ORDER: CompactionReasoningEffort[] = ["minimal", "low", "medium", "high"];

function compactionReasoningRank(effort: CompactionReasoningEffort): number {
  return COMPACTION_REASONING_ORDER.indexOf(effort);
}

function getContextCappedCompactionReasoningEffort(model: unknown): CompactionReasoningEffort {
  const contextWindow = getModelContextWindow(model) ?? PROGRESSIVE_FALLBACK_CONTEXT_WINDOW;
  if (contextWindow <= 32_000) return "minimal";
  if (contextWindow <= 64_000) return "low";
  if (contextWindow <= 128_000) return "medium";
  return "high";
}

function getSupportedCompactionReasoningEfforts(model: unknown): CompactionReasoningEffort[] {
  const anyModel = model as { reasoning?: unknown; thinkingLevelMap?: unknown } | null | undefined;
  if (!anyModel?.reasoning) return [];

  // getSupportedThinkingLevels() intentionally treats missing minimal/low/medium/high
  // thinkingLevelMap keys as provider defaults for interactive turns. Smart
  // compaction is a background side-call and must be stricter: do not invent a
  // compaction reasoning effort from defaults. Only request the side-call efforts
  // that the model explicitly maps to provider-native values. This keeps
  // xhigh/max-only Opus-style models on plain summarization instead of accidentally
  // sending unsupported medium/high reasoning options.
  const thinkingLevelMap = anyModel.thinkingLevelMap;
  if (!thinkingLevelMap || typeof thinkingLevelMap !== "object") return [];
  const map = thinkingLevelMap as Record<string, unknown>;
  return COMPACTION_REASONING_ORDER.filter((level) => {
    if (!Object.prototype.hasOwnProperty.call(map, level)) return false;
    const mapped = map[level];
    return typeof mapped === "string" ? mapped.trim().length > 0 : mapped !== null && mapped !== undefined;
  });
}

export function getCompactionReasoningReserveTokens(model: unknown): number {
  if (getSupportedCompactionReasoningEfforts(model).length === 0) return 0;
  const contextWindow = getModelContextWindow(model) ?? PROGRESSIVE_FALLBACK_CONTEXT_WINDOW;
  if (contextWindow <= 64_000) return 512;
  if (contextWindow <= 128_000) return 1_024;
  if (contextWindow <= 256_000) return 2_048;
  return 4_096;
}

export function getCompactionModelContextWindow(model: unknown): number {
  return getModelContextWindow(model) ?? PROGRESSIVE_FALLBACK_CONTEXT_WINDOW;
}

/** Legacy public sizing helper retained for facade API compatibility. */
export function getCompactionRetryPromptTokenTarget(model: unknown, fraction = 0.65): number {
  const contextWindow = getCompactionModelContextWindow(model);
  const effectiveWindow = getEffectiveContextWindow(contextWindow, getCompactionRequestOverheadTokens());
  return Math.max(MIN_COMPACTION_OUTPUT_TOKENS, Math.floor(effectiveWindow * fraction));
}

/**
 * Normalize the operator reserve into the output target used by every path.
 * The reserve is the only summary-size policy here; model and context limits
 * are applied per request by getSafeCompactionMaxTokens().
 */
export function getCompactionOutputTokenTarget(reserveTokens: number): number {
  const requested = Math.floor(Math.max(0, Number(reserveTokens) || 0) * 0.8);
  return Math.max(MIN_COMPACTION_OUTPUT_TOKENS, requested);
}

/** The model's declared output limit, when it provides a usable one. */
function getModelOutputTokenLimit(model: unknown): number | undefined {
  const maxTokens = Math.floor(Number((model as { maxTokens?: unknown } | null | undefined)?.maxTokens));
  return Number.isFinite(maxTokens) && maxTokens > 0 ? maxTokens : undefined;
}

export function getSafeCompactionMaxTokens(model: unknown, promptText: string, requestedMaxTokens: number): {
  maxTokens: number;
  promptTokens: number;
  availableOutputTokens: number;
  contextWindow: number;
  reasoningReserveTokens: number;
} {
  const contextWindow = getModelContextWindow(model) ?? PROGRESSIVE_FALLBACK_CONTEXT_WINDOW;
  const promptTokens = estimateCompactionPromptTokens(promptText);
  const reasoningReserveTokens = getCompactionReasoningReserveTokens(model);
  const availableOutputTokens = Math.floor((contextWindow - promptTokens - reasoningReserveTokens) * BUDGET_SAFETY_MARGIN);
  if (availableOutputTokens < MIN_COMPACTION_OUTPUT_TOKENS) {
    throw new Error(
      `Compaction prompt exceeds safe model budget: prompt+overhead=${promptTokens}t, reasoningReserve=${reasoningReserveTokens}t, context=${contextWindow}t, availableOutput=${availableOutputTokens}t`,
    );
  }
  const modelOutputLimit = getModelOutputTokenLimit(model) ?? Number.POSITIVE_INFINITY;
  return {
    // Never ask a provider for more than the model declares, even for the minimum.
    maxTokens: Math.min(modelOutputLimit, Math.max(
      MIN_COMPACTION_OUTPUT_TOKENS,
      Math.min(Math.floor(requestedMaxTokens), availableOutputTokens),
    )),
    promptTokens,
    availableOutputTokens,
    contextWindow,
    reasoningReserveTokens,
  };
}

export function getCompactionReasoningEffort(
  model: unknown,
  phase: CompactionReasoningPhase = "selective",
): CompactionReasoningEffort | undefined {
  const supported = getSupportedCompactionReasoningEfforts(model);
  if (supported.length === 0) return undefined;

  const configured = getConfiguredCompactionReasoningEffort(phase);
  const contextCap = getContextCappedCompactionReasoningEffort(model);
  const cappedTarget = COMPACTION_REASONING_ORDER[
    Math.min(compactionReasoningRank(configured), compactionReasoningRank(contextCap))
  ];
  const cappedRank = compactionReasoningRank(cappedTarget);
  const supportedAtOrBelowTarget = supported
    .filter((level) => compactionReasoningRank(level) <= cappedRank)
    .sort((a, b) => compactionReasoningRank(b) - compactionReasoningRank(a));
  if (supportedAtOrBelowTarget[0]) return supportedAtOrBelowTarget[0];

  // If every explicitly supported effort is above the context/config cap, omit
  // reasoning entirely. Falling upward to the model's lowest explicit level can
  // burn the tiny reserve on small-context compaction calls.
  return undefined;
}
