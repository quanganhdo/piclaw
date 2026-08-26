/**
 * db/token-usage.ts – Records LLM token consumption and cost per agent run.
 *
 * After each agent turn completes, the agent pool (agent-pool/usage.ts)
 * calls storeTokenUsage() to persist the token counts, cost breakdown, and
 * model/provider metadata.
 *
 * Consumers:
 *   - agent-pool/usage.ts calls storeTokenUsage() after every agent run.
 *   - agent-control/handlers/info.ts queries the table for `/usage` reports.
 *   - The token-chart skill reads the table to generate usage visualisations.
 */

import { getDb } from "./connection.js";

/** Overall token/cost totals for a chat across all runs. */
export interface TokenUsageTotalsSummary {
  input_tokens: number;
  output_tokens: number;
  reasoning_tokens: number;
  cache_read_tokens: number;
  cache_write_tokens: number;
  total_tokens: number;
  cost_total: number;
  runs: number;
  provider_reported_cost_runs?: number;
  catalogue_estimate_cost_runs?: number;
  unavailable_cost_runs?: number;
  legacy_cost_runs?: number;
}

/** Source category for a persisted usage record. */
export type TokenUsageSource = "assistant" | "tool" | "compaction" | "branch_summary" | "unknown";

/** Provenance for the effective per-run total cost. */
export type TokenUsageCostProvenance = "provider_reported" | "catalogue_estimate" | "unavailable";

/** Latest token/cost record for a chat, including cache-hit telemetry. */
export interface LatestTokenUsageSummary extends TokenUsageTotalsSummary {
  output_tokens: number;
  cost_input: number;
  cost_output: number;
  cost_cache_read: number;
  cost_cache_write: number;
  cache_read_reported: number | null;
  cache_write_reported: number | null;
  provider_cost_total: number | null;
  catalogue_cost_total: number | null;
  cost_provenance: TokenUsageCostProvenance | null;
  model: string | null;
  response_model: string | null;
  provider: string | null;
  api: string | null;
  usage_source: string | null;
  turns: number | null;
  run_at: string | null;
}

/** Aggregated token/cost totals grouped by provider for a chat. */
export interface TokenUsageByProviderSummary extends TokenUsageTotalsSummary {
  provider: string | null;
}

/** Aggregated token/cost totals grouped by model for a chat. */
export interface TokenUsageByModelSummary extends TokenUsageTotalsSummary {
  model: string | null;
}

/** Aggregated token/cost totals grouped by usage source for a chat. */
export interface TokenUsageBySourceSummary extends TokenUsageTotalsSummary {
  usage_source: string | null;
}

/** Latest model metadata recorded for a chat's token-usage stream. */
export interface LatestTokenUsageModelSummary {
  model: string | null;
  response_model: string | null;
  provider: string | null;
  run_at: string | null;
}

/**
 * Shape of a single token-usage record to be persisted.
 * Maps 1:1 to the `token_usage` table columns.
 */
export interface TokenUsageRecord {
  /** Chat JID the agent run belonged to. */
  chat_jid: string;
  /** ISO-8601 timestamp of the agent run. */
  run_at: string;
  /** Number of input (prompt) tokens consumed. */
  input_tokens: number;
  /** Number of output (completion) tokens generated. */
  output_tokens: number;
  /** Reasoning tokens reported by providers when available. Included in output tokens by OpenAI-compatible usage. */
  reasoning_tokens?: number;
  /** Tokens served from the provider's prompt cache. */
  cache_read_tokens: number;
  /** Tokens written into the provider's prompt cache. */
  cache_write_tokens: number;
  /** Whether the provider explicitly reported cache-read tokens. Null means legacy/unknown. */
  cache_read_reported?: boolean | null;
  /** Whether the provider explicitly reported cache-write tokens. Null means legacy/unknown. */
  cache_write_reported?: boolean | null;
  /** Sum of all token categories. */
  total_tokens: number;
  /** Dollar cost attributed to input tokens. */
  cost_input: number;
  /** Dollar cost attributed to output tokens. */
  cost_output: number;
  /** Dollar cost attributed to cache-read tokens. */
  cost_cache_read: number;
  /** Dollar cost attributed to cache-write tokens. */
  cost_cache_write: number;
  /** Effective dollar cost for the run. */
  cost_total: number;
  /** Provider-reported total cost, when available. */
  provider_cost_total?: number | null;
  /** Catalogue-calculated total cost, when available. */
  catalogue_cost_total?: number | null;
  /** Provenance for cost_total. Null means a legacy row. */
  cost_provenance?: TokenUsageCostProvenance | null;
  /** Requested model identifier (e.g. "auto" or "claude-sonnet-4-20250514"). */
  model?: string | null;
  /** Concrete upstream model returned by a router/gateway when it differs from the requested model. */
  response_model?: string | null;
  /** Provider name (e.g. "anthropic"). */
  provider?: string | null;
  /** API variant used (e.g. "messages", "chat"). */
  api?: string | null;
  /** Usage source category, such as assistant turn, tool execution, or compaction summary. */
  usage_source?: TokenUsageSource | string | null;
  /** Number of conversational turns in the run. */
  turns?: number | null;
}

/** Insert a token-usage record for a completed agent run. */
export function storeTokenUsage(record: TokenUsageRecord): void {
  const db = getDb();
  db.prepare(
    `INSERT INTO token_usage (
      chat_jid,
      run_at,
      input_tokens,
      output_tokens,
      reasoning_tokens,
      cache_read_tokens,
      cache_write_tokens,
      cache_read_reported,
      cache_write_reported,
      total_tokens,
      cost_input,
      cost_output,
      cost_cache_read,
      cost_cache_write,
      cost_total,
      provider_cost_total,
      catalogue_cost_total,
      cost_provenance,
      model,
      response_model,
      provider,
      api,
      usage_source,
      turns
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(
    record.chat_jid,
    record.run_at,
    record.input_tokens,
    record.output_tokens,
    record.reasoning_tokens ?? 0,
    record.cache_read_tokens,
    record.cache_write_tokens,
    record.cache_read_reported == null ? null : Number(record.cache_read_reported),
    record.cache_write_reported == null ? null : Number(record.cache_write_reported),
    record.total_tokens,
    record.cost_input,
    record.cost_output,
    record.cost_cache_read,
    record.cost_cache_write,
    record.cost_total,
    record.provider_cost_total ?? null,
    record.catalogue_cost_total ?? null,
    record.cost_provenance ?? null,
    record.model ?? null,
    record.response_model ?? null,
    record.provider ?? null,
    record.api ?? null,
    record.usage_source ?? "assistant",
    record.turns ?? null
  );
}

function normalizeLimit(limit: number): number {
  return Number.isFinite(limit) && limit > 0 ? Math.floor(limit) : 5;
}

/** Return overall token and cost totals for a chat. */
export function getTokenUsageTotals(chatJid: string): TokenUsageTotalsSummary {
  const db = getDb();
  const row = db.prepare(
    `SELECT
      COALESCE(SUM(input_tokens), 0) AS input_tokens,
      COALESCE(SUM(output_tokens), 0) AS output_tokens,
      COALESCE(SUM(reasoning_tokens), 0) AS reasoning_tokens,
      COALESCE(SUM(cache_read_tokens), 0) AS cache_read_tokens,
      COALESCE(SUM(cache_write_tokens), 0) AS cache_write_tokens,
      COALESCE(SUM(total_tokens), 0) AS total_tokens,
      COALESCE(SUM(cost_total), 0) AS cost_total,
      COUNT(*) AS runs,
      COALESCE(SUM(cost_provenance = 'provider_reported'), 0) AS provider_reported_cost_runs,
      COALESCE(SUM(cost_provenance = 'catalogue_estimate'), 0) AS catalogue_estimate_cost_runs,
      COALESCE(SUM(cost_provenance = 'unavailable'), 0) AS unavailable_cost_runs,
      COALESCE(SUM(cost_provenance IS NULL), 0) AS legacy_cost_runs
     FROM token_usage
     WHERE chat_jid = ?`
  ).get(chatJid) as TokenUsageTotalsSummary | undefined;

  return row ?? {
    input_tokens: 0,
    output_tokens: 0,
    reasoning_tokens: 0,
    cache_read_tokens: 0,
    cache_write_tokens: 0,
    total_tokens: 0,
    cost_total: 0,
    runs: 0,
    provider_reported_cost_runs: 0,
    catalogue_estimate_cost_runs: 0,
    unavailable_cost_runs: 0,
    legacy_cost_runs: 0,
  };
}

/** Return the most recent token-usage row for a chat, if any. */
export function getLatestTokenUsage(chatJid: string): LatestTokenUsageSummary | null {
  const db = getDb();
  const row = db.prepare(
    `SELECT
      input_tokens,
      output_tokens,
      reasoning_tokens,
      cache_read_tokens,
      cache_write_tokens,
      cache_read_reported,
      cache_write_reported,
      total_tokens,
      cost_input,
      cost_output,
      cost_cache_read,
      cost_cache_write,
      cost_total,
      provider_cost_total,
      catalogue_cost_total,
      cost_provenance,
      model,
      response_model,
      provider,
      api,
      usage_source,
      turns,
      run_at,
      1 AS runs
     FROM token_usage
     WHERE chat_jid = ?
     ORDER BY run_at DESC, id DESC
     LIMIT 1`
  ).get(chatJid) as LatestTokenUsageSummary | undefined;

  return row ?? null;
}

/** Return per-provider token and cost totals for a chat, sorted by total tokens. */
export function getTokenUsageByProvider(chatJid: string, limit = 5): TokenUsageByProviderSummary[] {
  const db = getDb();
  return db.prepare(
    `SELECT
      provider,
      COALESCE(SUM(input_tokens), 0) AS input_tokens,
      COALESCE(SUM(output_tokens), 0) AS output_tokens,
      COALESCE(SUM(reasoning_tokens), 0) AS reasoning_tokens,
      COALESCE(SUM(cache_read_tokens), 0) AS cache_read_tokens,
      COALESCE(SUM(cache_write_tokens), 0) AS cache_write_tokens,
      COALESCE(SUM(total_tokens), 0) AS total_tokens,
      COALESCE(SUM(cost_total), 0) AS cost_total,
      COUNT(*) AS runs,
      COALESCE(SUM(cost_provenance = 'provider_reported'), 0) AS provider_reported_cost_runs,
      COALESCE(SUM(cost_provenance = 'catalogue_estimate'), 0) AS catalogue_estimate_cost_runs,
      COALESCE(SUM(cost_provenance = 'unavailable'), 0) AS unavailable_cost_runs,
      COALESCE(SUM(cost_provenance IS NULL), 0) AS legacy_cost_runs
     FROM token_usage
     WHERE chat_jid = ?
     GROUP BY provider
     ORDER BY total_tokens DESC
     LIMIT ?`
  ).all(chatJid, normalizeLimit(limit)) as TokenUsageByProviderSummary[];
}

/** Return per-model token and cost totals for a chat, sorted by total tokens. */
export function getTokenUsageByModel(chatJid: string, limit = 5): TokenUsageByModelSummary[] {
  const db = getDb();
  return db.prepare(
    `SELECT
      COALESCE(response_model, model) AS model,
      COALESCE(SUM(input_tokens), 0) AS input_tokens,
      COALESCE(SUM(output_tokens), 0) AS output_tokens,
      COALESCE(SUM(reasoning_tokens), 0) AS reasoning_tokens,
      COALESCE(SUM(cache_read_tokens), 0) AS cache_read_tokens,
      COALESCE(SUM(cache_write_tokens), 0) AS cache_write_tokens,
      COALESCE(SUM(total_tokens), 0) AS total_tokens,
      COALESCE(SUM(cost_total), 0) AS cost_total,
      COUNT(*) AS runs,
      COALESCE(SUM(cost_provenance = 'provider_reported'), 0) AS provider_reported_cost_runs,
      COALESCE(SUM(cost_provenance = 'catalogue_estimate'), 0) AS catalogue_estimate_cost_runs,
      COALESCE(SUM(cost_provenance = 'unavailable'), 0) AS unavailable_cost_runs,
      COALESCE(SUM(cost_provenance IS NULL), 0) AS legacy_cost_runs
     FROM token_usage
     WHERE chat_jid = ?
     GROUP BY COALESCE(response_model, model)
     ORDER BY total_tokens DESC
     LIMIT ?`
  ).all(chatJid, normalizeLimit(limit)) as TokenUsageByModelSummary[];
}

/** Return per-source token and cost totals for a chat, sorted by total tokens. */
export function getTokenUsageBySource(chatJid: string, limit = 5): TokenUsageBySourceSummary[] {
  const db = getDb();
  return db.prepare(
    `SELECT
      usage_source,
      COALESCE(SUM(input_tokens), 0) AS input_tokens,
      COALESCE(SUM(output_tokens), 0) AS output_tokens,
      COALESCE(SUM(reasoning_tokens), 0) AS reasoning_tokens,
      COALESCE(SUM(cache_read_tokens), 0) AS cache_read_tokens,
      COALESCE(SUM(cache_write_tokens), 0) AS cache_write_tokens,
      COALESCE(SUM(total_tokens), 0) AS total_tokens,
      COALESCE(SUM(cost_total), 0) AS cost_total,
      COUNT(*) AS runs,
      COALESCE(SUM(cost_provenance = 'provider_reported'), 0) AS provider_reported_cost_runs,
      COALESCE(SUM(cost_provenance = 'catalogue_estimate'), 0) AS catalogue_estimate_cost_runs,
      COALESCE(SUM(cost_provenance = 'unavailable'), 0) AS unavailable_cost_runs,
      COALESCE(SUM(cost_provenance IS NULL), 0) AS legacy_cost_runs
     FROM token_usage
     WHERE chat_jid = ?
     GROUP BY usage_source
     ORDER BY total_tokens DESC
     LIMIT ?`
  ).all(chatJid, normalizeLimit(limit)) as TokenUsageBySourceSummary[];
}

/** Return the most recent token-usage model metadata for a chat, if any. */
export function getLatestTokenUsageModel(chatJid: string): LatestTokenUsageModelSummary | null {
  const db = getDb();
  const row = db.prepare(
    `SELECT
      model,
      response_model,
      provider,
      run_at
     FROM token_usage
     WHERE chat_jid = ?
     ORDER BY run_at DESC, id DESC
     LIMIT 1`
  ).get(chatJid) as LatestTokenUsageModelSummary | undefined;

  return row ?? null;
}

/**
 * Delete token_usage rows older than the given retention period.
 * All queries on this table use aggregations (SUM/COUNT/GROUP BY) or latest-row
 * lookups, so individual old rows are not needed for correctness.
 *
 * @returns Number of deleted rows.
 */
export function pruneOldTokenUsage(retentionDays = 90): number {
  const db = getDb();
  const cutoff = new Date(Date.now() - retentionDays * 86_400_000).toISOString();
  const result = db.prepare(`DELETE FROM token_usage WHERE run_at < ?`).run(cutoff);
  return result.changes;
}
