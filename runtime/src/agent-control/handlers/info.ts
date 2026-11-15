/** Cached provider quota and workspace search; no session lifecycle ownership. */
import type { AgentSession } from '@earendil-works/pi-coding-agent';
import type { AgentControlCommand, AgentControlResult } from '../agent-control-types.js';
import { peekProviderUsageForRuntime, type ProviderUsageWindow } from '../../agent-pool/provider-usage.js';
import { searchWorkspace } from '../../workspace-search.js';
type SearchCommand = Extract<AgentControlCommand, { type: 'search_workspace' }>;

function formatQuotaMoney(value: number | null): string {
  if (value === null || !Number.isFinite(value)) return "unavailable";
  return `$${value.toFixed(value >= 0.01 ? 2 : 4)}`;
}

function formatQuotaResetDescription(window: ProviderUsageWindow | null): string | null {
  if (!window?.resets_at) return window?.reset_description ?? null;
  const resetDate = new Date(window.resets_at);
  const resetAt = resetDate.getTime();
  if (!Number.isFinite(resetAt)) return window.reset_description;

  const deltaMs = resetAt - Date.now();
  if (!Number.isFinite(deltaMs)) return window.reset_description;
  if (deltaMs <= 0) return "resets soon";

  const totalMinutes = Math.max(1, Math.round(deltaMs / 60000));
  if (totalMinutes < 60) return `resets in ~${totalMinutes}m`;

  const totalHours = Math.floor(totalMinutes / 60);
  if (totalHours < 24) {
    const mins = totalMinutes % 60;
    return mins > 0 ? `resets in ~${totalHours}h ${mins}m` : `resets in ~${totalHours}h`;
  }

  const days = Math.floor(totalHours / 24);
  const hours = totalHours % 24;
  return `resets in ~${days}d ${hours}h`;
}

/** Cached, credential-bound quota read; no session object or live refresh required. */
export async function handleProviderQuota(modelRuntime: Parameters<typeof peekProviderUsageForRuntime>[0], model?: { readonly provider: string; readonly id: string }): Promise<AgentControlResult> {
  const provider = model?.provider ?? null;
  const modelLabel = model ? `${model.provider}/${model.id}` : "<none>";
  const snapshot = provider
    ? await peekProviderUsageForRuntime(modelRuntime, provider, { allowStale: true })
    : null;
  if (!snapshot) {
    return { status: "success", message: `${modelLabel}\nNo quota data available.` };
  }

  if (snapshot.provider === "openrouter") {
    if (snapshot.availability !== "available") {
      return { status: "success", message: `${modelLabel}\n${snapshot.hint_short || "OpenRouter key usage unavailable."}` };
    }
    const limit = snapshot.key_limit_configured === true
      ? formatQuotaMoney(snapshot.key_limit_usd)
      : snapshot.key_limit_unlimited
        ? "not configured (unlimited)"
        : "unavailable";
    const reset = snapshot.key_limit_reset ?? "not configured";
    const freshness = snapshot.stale
      ? `stale; refresh failed (${snapshot.refresh_failure ?? "unknown"})`
      : `fetched ${snapshot.fetched_at}`;
    return {
      status: "success",
      message: [
        modelLabel,
        "**OpenRouter key usage**",
        "",
        "| Metric | Value |",
        "|---|---|",
        `| Spend | ${formatQuotaMoney(snapshot.key_usage_usd)} |`,
        `| Limit | ${limit} |`,
        `| Remaining | ${formatQuotaMoney(snapshot.key_limit_remaining_usd)} |`,
        `| Daily / weekly / monthly | ${formatQuotaMoney(snapshot.key_usage_daily_usd)} / ${formatQuotaMoney(snapshot.key_usage_weekly_usd)} / ${formatQuotaMoney(snapshot.key_usage_monthly_usd)} |`,
        `| Tier | ${snapshot.is_free_tier === null ? "unavailable" : snapshot.is_free_tier ? "free" : "paid"} |`,
        `| BYOK included in limit | ${snapshot.include_byok_in_limit === null ? "unavailable" : snapshot.include_byok_in_limit ? "yes" : "no"} |`,
        `| Limit reset | ${reset} |`,
        `| Telemetry | ${freshness} |`,
      ].join("\n"),
    };
  }

  const parts = [
    snapshot.plan ? `Plan: ${snapshot.plan}` : null,
    snapshot.hint_short?.trim() || null,
    formatQuotaResetDescription(snapshot.primary),
    formatQuotaResetDescription(snapshot.secondary),
  ].filter((part): part is string => Boolean(part));
  const quotaLine = parts.length > 0 ? parts.join(" • ") : "No quota data available.";

  return {
    status: "success",
    message: `${modelLabel}\n${quotaLine}`,
  };
}

/** Handle /search-workspace: full-text search across workspace files. */
export async function handleSearchWorkspace(_session: AgentSession | undefined, command: SearchCommand): Promise<AgentControlResult> {
  const query = command.query?.trim();
  if (!query) {
    return {
      status: "error",
      message: "Usage: /search <query> [--scope notes|skills|all] [--limit N] [--offset N] [--no-refresh] [--max-kb N]",
    };
  }

  const { rows, limit, offset, error } = await searchWorkspace({
    query,
    scope: command.scope,
    limit: command.limit,
    offset: command.offset,
    refresh: command.refresh ?? true,
    max_kb: command.max_kb,
  });

  if (error) {
    return { status: "error", message: error };
  }

  if (!rows.length) {
    return { status: "success", message: "No matching workspace files found." };
  }

  const header = `Workspace matches (${rows.length} result${rows.length === 1 ? "" : "s"}; limit ${limit}, offset ${offset}):`;
  const lines = rows.map((row) => `• ${row.path} — ${row.snippet}`);
  return { status: "success", message: `${header}\n${lines.join("\n")}` };
}
