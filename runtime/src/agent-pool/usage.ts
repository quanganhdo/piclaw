/**
 * agent-pool/usage.ts – Extract and persist LLM token usage from session events.
 *
 * Persists provider-reported usage from assistant messages plus Earendil 0.81
 * usage metadata on tool results, branch summaries, and compaction entries.
 */

import type { AgentSession, AgentSessionEvent } from "@earendil-works/pi-coding-agent";
import { storeTokenUsage } from "../db.js";

export type UsageRecordSource = "assistant" | "tool" | "compaction" | "branch_summary" | "unknown";

interface UsageCarrier {
  role?: unknown;
  usage?: unknown;
  timestamp?: unknown;
  model?: unknown;
  responseModel?: unknown;
  provider?: unknown;
  api?: unknown;
}

interface UsageMetadata {
  source: UsageRecordSource;
  timestamp?: unknown;
  model?: unknown;
  responseModel?: unknown;
  provider?: unknown;
  api?: unknown;
  turns?: number | null;
}

type SessionWithUsageRecorder = AgentSession & {
  __piclawUsageRecorderInstalled?: boolean;
  __piclawUsageRecorderChatJid?: string;
  subscribe: (handler: (event: AgentSessionEvent) => void) => () => void;
};

function asRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== "object") return null;
  return value as Record<string, unknown>;
}

function asNumber(record: Record<string, unknown>, key: string): number {
  const value = record[key];
  return typeof value === "number" && Number.isFinite(value) ? value : 0;
}

function asOptionalNonNegativeNumber(...values: unknown[]): number | null {
  for (const value of values) {
    if (typeof value === "number" && Number.isFinite(value) && value >= 0) return value;
  }
  return null;
}

function asOptionalBoolean(...values: unknown[]): boolean | null {
  for (const value of values) {
    if (typeof value === "boolean") return value;
  }
  return null;
}

function asStringOrNull(value: unknown): string | null {
  return typeof value === "string" ? value : null;
}

function firstNumber(...values: unknown[]): number {
  for (const value of values) {
    if (typeof value === "number" && Number.isFinite(value)) return value;
  }
  return 0;
}

function extractReasoningTokens(usage: Record<string, unknown>): number {
  const outputDetails = asRecord(usage.outputTokensDetails)
    ?? asRecord(usage.output_tokens_details)
    ?? asRecord(usage.completion_tokens_details);
  return firstNumber(
    usage.reasoningTokens,
    usage.reasoning_tokens,
    usage.reasoning,
    outputDetails?.reasoning_tokens,
    outputDetails?.reasoningTokens,
  );
}

function normalizeRunAt(timestamp: unknown): string {
  if (typeof timestamp === "string" || typeof timestamp === "number") {
    const ts = new Date(timestamp);
    if (!Number.isNaN(ts.getTime())) return ts.toISOString();
  }
  return new Date().toISOString();
}

function hasUsageTokensOrCost(usage: Record<string, unknown>): boolean {
  const cost = asRecord(usage.cost) ?? {};
  return [
    usage.input,
    usage.output,
    usage.cacheRead,
    usage.cacheWrite,
    usage.totalTokens,
    usage.total,
    cost.input,
    cost.output,
    cost.cacheRead,
    cost.cacheWrite,
    cost.total,
    usage.providerCost,
    usage.provider_cost,
  ].some((value) => typeof value === "number" && Number.isFinite(value) && value !== 0);
}

function storeUsageRecord(chatJid: string, usage: Record<string, unknown>, metadata: UsageMetadata): void {
  if (!hasUsageTokensOrCost(usage)) return;

  const input = asNumber(usage, "input");
  const output = asNumber(usage, "output");
  const cacheRead = asNumber(usage, "cacheRead");
  const cacheWrite = asNumber(usage, "cacheWrite");
  const reasoningTokens = extractReasoningTokens(usage);
  const totalTokens =
    asNumber(usage, "totalTokens") ||
    asNumber(usage, "total") ||
    input + output + cacheRead + cacheWrite;

  const cost = asRecord(usage.cost) ?? {};
  const costInput = asNumber(cost, "input");
  const costOutput = asNumber(cost, "output");
  const costCacheRead = asNumber(cost, "cacheRead");
  const costCacheWrite = asNumber(cost, "cacheWrite");
  const catalogueCostCandidate = asOptionalNonNegativeNumber(cost.total)
    ?? costInput + costOutput + costCacheRead + costCacheWrite;
  // Earendil's catalogue cost object has no field-presence signal: zero can mean
  // unknown rates, so only a positive total is a trustworthy estimate.
  const catalogueCostTotal = catalogueCostCandidate > 0 ? catalogueCostCandidate : null;
  const providerCostTotal = asOptionalNonNegativeNumber(usage.providerCost, usage.provider_cost);
  const costTotal = providerCostTotal ?? catalogueCostTotal ?? 0;
  const costProvenance = providerCostTotal !== null
    ? "provider_reported"
    : catalogueCostTotal !== null
      ? "catalogue_estimate"
      : "unavailable";

  storeTokenUsage({
    chat_jid: chatJid,
    run_at: normalizeRunAt(metadata.timestamp),
    input_tokens: input,
    output_tokens: output,
    reasoning_tokens: reasoningTokens,
    cache_read_tokens: cacheRead,
    cache_write_tokens: cacheWrite,
    cache_read_reported: asOptionalBoolean(usage.cacheReadReported, usage.cache_read_reported),
    cache_write_reported: asOptionalBoolean(usage.cacheWriteReported, usage.cache_write_reported),
    total_tokens: totalTokens,
    cost_input: costInput,
    cost_output: costOutput,
    cost_cache_read: costCacheRead,
    cost_cache_write: costCacheWrite,
    cost_total: costTotal,
    provider_cost_total: providerCostTotal,
    catalogue_cost_total: catalogueCostTotal,
    cost_provenance: costProvenance,
    model: asStringOrNull(metadata.model),
    response_model: asStringOrNull(metadata.responseModel),
    provider: asStringOrNull(metadata.provider),
    api: asStringOrNull(metadata.api),
    usage_source: metadata.source,
    turns: metadata.turns ?? null,
  });
}

/**
 * Extract token usage from an assistant message and store it in the database.
 * Kept for direct side-prompt streams and existing call sites/tests.
 */
export function recordMessageUsage(chatJid: string, message: unknown): void {
  const msg = asRecord(message) as UsageCarrier | null;
  if (!msg || msg.role !== "assistant") return;

  const usage = asRecord(msg.usage);
  if (!usage) return;

  storeUsageRecord(chatJid, usage, {
    source: "assistant",
    timestamp: msg.timestamp,
    model: msg.model,
    responseModel: msg.responseModel,
    provider: msg.provider,
    api: msg.api,
    turns: 1,
  });
}

/** Extract and persist Earendil 0.81 usage metadata from a session event. */
export function recordSessionEventUsage(chatJid: string, event: unknown): void {
  const eventRecord = asRecord(event);
  const eventType = eventRecord?.type;
  if (!eventRecord || typeof eventType !== "string") return;

  if (eventType === "message_end") {
    const message = asRecord(eventRecord.message) as UsageCarrier | null;
    if (!message) return;

    if (message.role === "assistant") {
      recordMessageUsage(chatJid, message);
      return;
    }

    if (message.role === "toolResult" || message.role === "tool_result") {
      const usage = asRecord(message.usage);
      if (!usage) return;
      storeUsageRecord(chatJid, usage, {
        source: "tool",
        timestamp: message.timestamp,
        turns: 0,
      });
    }
    return;
  }

  if (eventType === "session_compact") {
    const entry = asRecord(eventRecord.compactionEntry);
    const usage = asRecord(entry?.usage);
    if (!usage) return;
    storeUsageRecord(chatJid, usage, {
      source: "compaction",
      timestamp: entry?.timestamp,
      turns: 0,
    });
    return;
  }

  if (eventType === "session_tree") {
    const entry = asRecord(eventRecord.summaryEntry);
    if (entry?.type !== "branch_summary") return;
    const usage = asRecord(entry.usage);
    if (!usage) return;
    storeUsageRecord(chatJid, usage, {
      source: "branch_summary",
      timestamp: entry.timestamp,
      turns: 0,
    });
  }
}

/** Install one per-session usage recorder so compaction/tree events are captured outside prompt subscriptions. */
export function installSessionUsageRecorder(
  session: AgentSession,
  chatJid: string,
  onWarn?: (message: string, details: Record<string, unknown>) => void,
): void {
  const target = session as SessionWithUsageRecorder;
  target.__piclawUsageRecorderChatJid = chatJid;
  if (target.__piclawUsageRecorderInstalled) return;
  target.__piclawUsageRecorderInstalled = true;

  target.subscribe((event) => {
    const currentChatJid = target.__piclawUsageRecorderChatJid ?? chatJid;
    try {
      recordSessionEventUsage(currentChatJid, event);
    } catch (err) {
      onWarn?.("Failed to persist session usage metadata", {
        operation: "session_usage_recorder.record_event_usage",
        chatJid: currentChatJid,
        eventType: (event as { type?: unknown })?.type ?? null,
        err,
      });
    }
  });
}
