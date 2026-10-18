/**
 * Extracted smart-compaction helper module.
 *
 * Keep this module focused; the public extension facade remains
 * ../smart-compaction.ts.
 */

import { getSmartCompactionReasoningFallback } from "../../core/config.js";
import { getUnknownModelContextWindow } from "../../utils/context-window-budget.js";

// ---------------------------------------------------------------------------
// Env helpers (must precede constant definitions that reference them)
// ---------------------------------------------------------------------------

export function parsePositiveEnvInt(name: string): number | null {
  const parsed = Number.parseInt(String(process.env[name] || "").trim(), 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
}

export type CompactionReasoningEffort = "minimal" | "low" | "medium" | "high";

export type CompactionReasoningPhase =
  | "selective"
  | "progressive_chunk"
  | "progressive_merge"
  | "progressive_final"
  | "progressive_compress";

const COMPACTION_REASONING_EFFORTS = new Set<CompactionReasoningEffort>(["minimal", "low", "medium", "high"]);

const COMPACTION_REASONING_PHASE_ENV: Record<CompactionReasoningPhase, string> = {
  selective: "PICLAW_SMART_COMPACTION_SELECTIVE_REASONING",
  progressive_chunk: "PICLAW_PROGRESSIVE_CHUNK_REASONING",
  progressive_merge: "PICLAW_PROGRESSIVE_MERGE_REASONING",
  progressive_final: "PICLAW_PROGRESSIVE_FINAL_REASONING",
  progressive_compress: "PICLAW_PROGRESSIVE_COMPRESS_REASONING",
};

const DEFAULT_COMPACTION_REASONING_BY_PHASE: Record<CompactionReasoningPhase, CompactionReasoningEffort> = {
  selective: "medium",
  progressive_chunk: "low",
  progressive_merge: "medium",
  progressive_final: "high",
  progressive_compress: "low",
};

export function parseCompactionReasoningEffort(value: unknown): CompactionReasoningEffort | null {
  const normalized = String(value || "").trim().toLowerCase();
  return COMPACTION_REASONING_EFFORTS.has(normalized as CompactionReasoningEffort)
    ? normalized as CompactionReasoningEffort
    : null;
}

export function getConfiguredCompactionReasoningEffort(phase: CompactionReasoningPhase): CompactionReasoningEffort {
  const domainFallback = getSmartCompactionReasoningFallback();
  return parseCompactionReasoningEffort(process.env[COMPACTION_REASONING_PHASE_ENV[phase]])
    ?? parseCompactionReasoningEffort(domainFallback)
    ?? DEFAULT_COMPACTION_REASONING_BY_PHASE[phase];
}

// ---------------------------------------------------------------------------
// Configuration
// ---------------------------------------------------------------------------

/** Default cap on progressive prompt chars; an explicit operator env override may raise it. */
export const MAX_PROMPT_CHARS = 60_000;

/**
 * Upper bound for progressive compaction input prompts.
 *
 * Keep the legacy 60k MAX_PROMPT_CHARS for output-validation callers, but let
 * high-context models use larger progressive chunks by default. Otherwise a
 * 1M-token model is split into ~100 tiny chunks, making timeout partials likely
 * to retain nearly the whole tail verbatim and grow the context.
 */
export const MAX_PROGRESSIVE_PROMPT_CHARS = parsePositiveEnvInt("PICLAW_PROGRESSIVE_COMPACTION_MAX_PROMPT_CHARS") ?? 320_000;

/**
 * Target chunk count for high-context progressive compaction preflight.
 * 0 disables the target; by default only very large-context models use it.
 */
export const DEFAULT_HIGH_CONTEXT_PROGRESSIVE_TARGET_CHUNKS = 12;
export const DEFAULT_HIGH_CONTEXT_PROGRESSIVE_MAX_CHUNKS = 24;
export const HIGH_CONTEXT_PROGRESSIVE_TARGET_MIN_CONTEXT = 512_000;

/** Conservative latency assumptions for high-context feasibility preflight. */
export const PROGRESSIVE_INITIAL_BATCH_ESTIMATE_MS = 30_000;
export const PROGRESSIVE_MIN_BATCH_ESTIMATE_MS = 5_000;
export const PROGRESSIVE_MERGE_RESERVE_MS = 60_000;
export const PROGRESSIVE_MIN_MERGE_RESERVE_MS = 10_000;
export const PROGRESSIVE_FINAL_SETTLEMENT_RESERVE_MS = 10_000;
export const PROGRESSIVE_OBSERVED_BATCH_SAFETY_MULTIPLIER = 1.10;
export const MAX_PROGRESSIVE_CHUNK_OUTPUT_TOKENS = 2_048;

/** Per-tool-result truncation limit when serializing. */
export const TOOL_RESULT_MAX_CHARS = 1_500;

/** Char budget for the backwards-walk recent context. */
export const RECENT_CONTEXT_BUDGET_CHARS = 25_000;

/** Char budget for kept-message context (what survives compaction). */
export const KEPT_CONTEXT_BUDGET_CHARS = 8_000;

/** How many earliest user turns to include for goal context. */
export const HEAD_USER_TURNS = 3;

/** Context messages to pin around a detected topic-shift boundary. */
export const TOPIC_SHIFT_CONTEXT_BEFORE = 2;
export const TOPIC_SHIFT_CONTEXT_AFTER = 6;

/** Preview length for embedded user-topic snippets. */
export const USER_PREVIEW_MAX_CHARS = 300;

/** Minimum acceptable summary length (chars). */
export const MIN_SUMMARY_CHARS = 100;

/** Conservative fallback context window for models that do not publish one. */
export const PROGRESSIVE_FALLBACK_CONTEXT_WINDOW = getUnknownModelContextWindow();

/** Reserve this much of the model context for system prompt, instructions, and output. */
export const PROGRESSIVE_INPUT_CONTEXT_FRACTION = 0.42;

/** Keep chunk prompts smaller than final merge prompts; smaller models need room to answer. */
export const PROGRESSIVE_CHUNK_FRACTION = 0.72;

// ---------------------------------------------------------------------------
// Safety margin constants
// ---------------------------------------------------------------------------

/**
 * Safety margin applied to all budget calculations. Accounts for:
 * - Token estimation inaccuracy (chars/4 is approximate)
 * - Provider-side token counting differences
 * - Summary generation variability
 */
export const BUDGET_SAFETY_MARGIN = 0.85;

/**
 * Optional maximum progressive compaction chunk count.
 * 0 means unbounded by count; elapsed-time and per-call prompt budgets remain
 * the safety limits. Do not increase chunk size to satisfy this cap, because
 * oversized chunks are exactly what progressive mode is meant to avoid.
 */
export const MAX_PROGRESSIVE_CHUNKS = parsePositiveEnvInt("PICLAW_PROGRESSIVE_COMPACTION_MAX_CHUNKS") ?? 0;

/** Number of progressive chunk summaries to run concurrently. Keep this small to avoid provider throttling. */
export const PROGRESSIVE_COMPACTION_CONCURRENCY = Math.min(
  8,
  Math.max(1, parsePositiveEnvInt("PICLAW_PROGRESSIVE_COMPACTION_CONCURRENCY") ?? 3),
);

/** Minimum interval between live smart-compaction progress updates. */
export const SMART_COMPACTION_PROGRESS_INTERVAL_MS = parsePositiveEnvInt("PICLAW_SMART_COMPACTION_PROGRESS_INTERVAL_MS") ?? 5_000;

/** Maximum fraction of context window that keepRecentTokens may consume. */
export const MAX_KEEP_RECENT_FRACTION = 0.50;

/** Elapsed-time guard: abort progressive compaction if approaching timeout. */
export const PROGRESSIVE_TIME_BUDGET_FRACTION = 0.80;

/** Minimum useful output budget for a compaction LLM call. */
export const MIN_COMPACTION_OUTPUT_TOKENS = 512;
