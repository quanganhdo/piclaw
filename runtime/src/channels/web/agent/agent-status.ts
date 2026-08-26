/**
 * channels/web/agent-status.ts – Agent status/context/models endpoint helpers.
 */

import type { WebAgentBufferEntry } from "./agent-buffers.js";
import { getAddonApiHealthSnapshot } from "../../../addons/addon-api-health.js";
import { getMcpStartupDiagnostics } from "../../../secure/mcp-keychain.js";
import { appendServerTiming, measureAsync, measureSync } from "../http/server-timing.js";

export interface TokenUsageCounterSummary {
  input_tokens: number;
  output_tokens: number;
  reasoning_tokens?: number;
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

export interface LatestTokenUsageCounterSummary extends TokenUsageCounterSummary {
  cache_read_reported?: number | null;
  cache_write_reported?: number | null;
  provider_cost_total?: number | null;
  catalogue_cost_total?: number | null;
  cost_provenance?: string | null;
  model?: string | null;
  response_model?: string | null;
  provider?: string | null;
  api?: string | null;
  turns?: number | null;
  run_at?: string | null;
}

export interface AgentTokenUsageContext {
  latest: LatestTokenUsageCounterSummary | null;
  totals: TokenUsageCounterSummary | null;
}

/** Context contract used by web agent status/context/model endpoint handlers. */
export interface AgentStatusContext {
  defaultChatJid: string;
  json(payload: unknown, status?: number): Response;
  getAgentStatus(chatJid: string): Record<string, unknown> | null;
  getExtensionWorkingState(chatJid: string): Record<string, unknown> | null;
  recoverStaleInflightRun(chatJid: string, options?: { hasActiveStatus?: boolean; minAgeMs?: number }): boolean;
  getBuffer(turnId: string, panel: "thought" | "draft"): WebAgentBufferEntry | undefined;
  getContextUsageForChat(
    chatJid: string
  ): Promise<{ tokens: number | null; contextWindow: number; percent: number | null } | null>;
  getTokenUsageForChat(chatJid: string): AgentTokenUsageContext | null;
  getAvailableModels(chatJid: string): Promise<unknown>;
  getProviderReadyCompletedForInstance(): boolean;
}

function resolveChatJid(req: Request, defaultChatJid: string): string {
  const url = new URL(req.url);
  return (url.searchParams.get("chat_jid") || defaultChatJid).trim() || defaultChatJid;
}

function readTrimmedString(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function computeCacheHitRate(record: TokenUsageCounterSummary | null | undefined): number | null {
  if (!record) return null;
  const input = Number(record.input_tokens) || 0;
  const cacheRead = Number(record.cache_read_tokens) || 0;
  const cacheWrite = Number(record.cache_write_tokens) || 0;
  const denominator = input + cacheRead + cacheWrite;
  const cacheReadReported = "cache_read_reported" in record
    ? (record as LatestTokenUsageCounterSummary).cache_read_reported
    : null;
  if (cacheReadReported === 0 || denominator <= 0) return null;
  if (cacheRead <= 0 && cacheReadReported !== 1) return null;
  return (cacheRead / denominator) * 100;
}

function formatTokenUsageRecord(record: LatestTokenUsageCounterSummary | null | undefined): Record<string, unknown> | null {
  if (!record) return null;
  return {
    inputTokens: record.input_tokens,
    outputTokens: record.output_tokens,
    reasoningTokens: record.reasoning_tokens ?? 0,
    cacheReadTokens: record.cache_read_tokens,
    cacheWriteTokens: record.cache_write_tokens,
    cacheReadReported: record.cache_read_reported == null ? null : Boolean(record.cache_read_reported),
    cacheWriteReported: record.cache_write_reported == null ? null : Boolean(record.cache_write_reported),
    totalTokens: record.total_tokens,
    costTotal: record.cost_total,
    providerCostTotal: record.provider_cost_total ?? null,
    catalogueCostTotal: record.catalogue_cost_total ?? null,
    costProvenance: record.cost_provenance ?? null,
    runs: record.runs,
    cacheHitRate: computeCacheHitRate(record),
    model: record.model ?? null,
    responseModel: record.response_model ?? null,
    provider: record.provider ?? null,
    api: record.api ?? null,
    turns: record.turns ?? null,
    runAt: record.run_at ?? null,
  };
}

function formatTokenUsageTotals(record: TokenUsageCounterSummary | null | undefined): Record<string, unknown> | null {
  if (!record) return null;
  return {
    inputTokens: record.input_tokens,
    outputTokens: record.output_tokens,
    reasoningTokens: record.reasoning_tokens ?? 0,
    cacheReadTokens: record.cache_read_tokens,
    cacheWriteTokens: record.cache_write_tokens,
    totalTokens: record.total_tokens,
    costTotal: record.cost_total,
    runs: record.runs,
    cacheHitRate: computeCacheHitRate(record),
    costCoverage: {
      providerReportedRuns: record.provider_reported_cost_runs ?? 0,
      catalogueEstimateRuns: record.catalogue_estimate_cost_runs ?? 0,
      unavailableRuns: record.unavailable_cost_runs ?? 0,
      legacyRuns: record.legacy_cost_runs ?? 0,
    },
  };
}

function formatTokenUsageContext(usage: AgentTokenUsageContext | null): Record<string, unknown> | null {
  if (!usage || (!usage.latest && !usage.totals)) return null;
  return {
    latest: formatTokenUsageRecord(usage.latest),
    totals: formatTokenUsageTotals(usage.totals),
  };
}

function getMcpStartupStatus(): { degraded: boolean; servers: Array<{ server_name: string; reason: string }> } {
  const diagnostics = getMcpStartupDiagnostics();
  return {
    degraded: diagnostics.length > 0,
    servers: diagnostics.map((diagnostic) => ({
      server_name: diagnostic.serverName,
      reason: diagnostic.reason,
    })),
  };
}

function deriveAgentState(status: Record<string, unknown>): string {
  const explicit = readTrimmedString(status.state);
  if (explicit) return explicit;

  const classifier = readTrimmedString(
    status.classifier
      ?? status.recovery_classifier
      ?? status.recoveryClassifier
      ?? status.failure_classifier,
  );

  if (classifier === "recovery_suppressed") return "recovery_suppressed";
  if (classifier === "auth_config" || classifier === "provider_auth") return "blocked_auth";

  const failureCategory = readTrimmedString(status.failure_category ?? status.failureCategory);
  if (failureCategory === "auth_config") return "blocked_auth";

  return "active";
}

/** Return active/idle agent status plus streamed thought/draft buffers when available. */
export function handleAgentStatusRequest(req: Request, ctx: AgentStatusContext): Response {
  const { result, durationMs } = measureSync(() => {
    const chatJid = resolveChatJid(req, ctx.defaultChatJid);
    const status = ctx.getAgentStatus(chatJid);
    if (!status) {
      ctx.recoverStaleInflightRun(chatJid, { hasActiveStatus: false });
      return ctx.json({ status: "idle", state: "idle", chat_jid: chatJid, data: null, extension_working: ctx.getExtensionWorkingState(chatJid), addon_api: getAddonApiHealthSnapshot(), mcp_startup: getMcpStartupStatus() });
    }
    // The status store retains terminal command events briefly so polling
    // clients cannot miss completion between requests. Retained terminal
    // payloads are observable history, not active work.
    if (status.type === "done" || status.type === "error") {
      const classifier = readTrimmedString(
        status.classifier
          ?? status.recovery_classifier
          ?? status.recoveryClassifier
          ?? status.failure_classifier
          ?? status.failure_category
          ?? status.failureCategory,
      ) || null;
      return ctx.json({
        status: "idle",
        state: status.type === "done" ? "idle" : deriveAgentState(status),
        chat_jid: chatJid,
        provider: readTrimmedString(status.provider) || null,
        model: readTrimmedString(status.model) || null,
        classifier,
        last_error: status.type === "error"
          ? readTrimmedString(status.detail) || readTrimmedString(status.title) || null
          : null,
        recovery_strategy: readTrimmedString(status.recovery_strategy ?? status.recoveryStrategy ?? status.strategy) || null,
        recovery_suppressed_reason: readTrimmedString(status.recovery_suppressed_reason ?? status.recoverySuppressedReason) || null,
        data: status,
        extension_working: ctx.getExtensionWorkingState(chatJid),
        addon_api: getAddonApiHealthSnapshot(),
        mcp_startup: getMcpStartupStatus(),
      });
    }

    const turnId = (status.turn_id || status.turnId) as string | undefined;
    let thought: { text: string; totalLines: number } | undefined;
    let draft: { text: string; totalLines: number } | undefined;
    if (turnId) {
      const tb = ctx.getBuffer(turnId, "thought");
      if (tb) thought = { text: tb.text, totalLines: tb.totalLines };
      const db = ctx.getBuffer(turnId, "draft");
      if (db) draft = { text: db.text, totalLines: db.totalLines };
    }

    const state = deriveAgentState(status);
    const classifier = readTrimmedString(
      status.classifier
      ?? status.recovery_classifier
      ?? status.recoveryClassifier
      ?? status.failure_classifier
      ?? status.failure_category
      ?? status.failureCategory,
    ) || null;

    return ctx.json({
      status: "active",
      state,
      chat_jid: chatJid,
      provider: readTrimmedString(status.provider) || null,
      model: readTrimmedString(status.model) || null,
      classifier,
      last_error: readTrimmedString(status.detail) || readTrimmedString(status.title) || null,
      recovery_strategy: readTrimmedString(status.recovery_strategy ?? status.recoveryStrategy ?? status.strategy) || null,
      recovery_suppressed_reason: readTrimmedString(status.recovery_suppressed_reason ?? status.recoverySuppressedReason) || null,
      data: status,
      thought,
      draft,
      extension_working: ctx.getExtensionWorkingState(chatJid),
      addon_api: getAddonApiHealthSnapshot(),
      mcp_startup: getMcpStartupStatus(),
    });
  });
  return appendServerTiming(result, {
    name: "agent_status",
    durationMs,
  });
}

/** Return context window usage metrics for the requested/default chat. */
export async function handleAgentContextRequest(req: Request, ctx: AgentStatusContext): Promise<Response> {
  const { result, durationMs } = await measureAsync(async () => {
    const chatJid = resolveChatJid(req, ctx.defaultChatJid);
    const cacheUsage = formatTokenUsageContext(ctx.getTokenUsageForChat(chatJid));
    const usage = await ctx.getContextUsageForChat(chatJid);
    if (!usage) {
      return ctx.json({ tokens: null, contextWindow: null, percent: null, cacheUsage });
    }

    return ctx.json({
      tokens: usage.tokens,
      contextWindow: usage.contextWindow,
      percent: usage.percent,
      cacheUsage,
    });
  });
  return appendServerTiming(result, {
    name: "agent_context",
    durationMs,
  });
}

/** Return available model options for the requested/default chat. */
export async function handleAgentModelsRequest(req: Request, ctx: AgentStatusContext): Promise<Response> {
  const { result, durationMs } = await measureAsync(async () => {
    const chatJid = resolveChatJid(req, ctx.defaultChatJid);
    const payload = await ctx.getAvailableModels(chatJid);
    if (payload && typeof payload === "object") {
      return ctx.json({
        ...payload as Record<string, unknown>,
        oobe: {
          ...((payload as { oobe?: Record<string, unknown> }).oobe ?? {}),
          provider_ready_completed_instance: ctx.getProviderReadyCompletedForInstance(),
        },
      }, 200);
    }
    return ctx.json(payload, 200);
  });
  return appendServerTiming(result, {
    name: "agent_models",
    durationMs,
  });
}
