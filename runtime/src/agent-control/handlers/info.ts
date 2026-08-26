/**
 * agent-control/handlers/info.ts – Handlers for informational / read-only commands.
 *
 * Handles /commands, /state, /stats, /context, /quota, /last,
 * /search-workspace, /labels, and /label. These commands display session
 * state, token usage,
 * and search results without modifying the session.
 *
 * Consumers: agent-control-handlers.ts dispatches to these handlers.
 */

import type { AgentSession } from "@earendil-works/pi-coding-agent";
import { getOpenAICodexWebSocketDebugStats } from "@earendil-works/pi-ai/api/openai-codex-responses";
import { statSync } from "fs";
import type { AgentControlCommand, AgentControlResult } from "../agent-control-types.js";
import { formatBytes, formatCompactNumber, formatCurrency } from "../agent-control-helpers.js";
import { CONTROL_COMMAND_DEFINITIONS } from "../command-registry.js";
import { getChatJid } from "../../core/chat-context.js";
import { getCompactionRuntimeConfig, getSessionStorageConfig } from "../../core/config.js";
import { getSessionFileLineCount } from "../../session-rotation.js";
import { getAutoCompactionTokenStatusForSession } from "../../agent-pool/compaction.js";
import { computePromptCacheWaste } from "../../agent-pool/cache-stats.js";
import { peekProviderUsageForRuntime, type ProviderUsageWindow } from "../../agent-pool/provider-usage.js";
import { getTokenUsageByModel, getTokenUsageByProvider, getTokenUsageBySource, getTokenUsageTotals } from "../../db.js";
import { createLogger, debugSuppressedError } from "../../utils/logger.js";
import { searchWorkspace } from "../../workspace-search.js";

const log = createLogger("agent-control.info");

type StateCommand = Extract<AgentControlCommand, { type: "state" }>;
type StatsCommand = Extract<AgentControlCommand, { type: "stats" }>;
type ContextCommand = Extract<AgentControlCommand, { type: "context" }>;
type QuotaCommand = Extract<AgentControlCommand, { type: "quota" }>;
type LastCommand = Extract<AgentControlCommand, { type: "last" }>;
type CommandsCommand = Extract<AgentControlCommand, { type: "commands" }>;
type SearchCommand = Extract<AgentControlCommand, { type: "search_workspace" }>;

function finitePercent(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function percentOf(numerator: number, denominator: number): number | null {
  return denominator > 0 ? finitePercent((numerator / denominator) * 100) : null;
}

function formatPercent(value: number | null): string {
  return value === null ? "unknown" : `${value.toFixed(1)}%`;
}

function formatPersistedCost(total: number, coverage: {
  provider_reported_cost_runs?: number;
  catalogue_estimate_cost_runs?: number;
  unavailable_cost_runs?: number;
  legacy_cost_runs?: number;
}): string {
  const parts = [
    coverage.provider_reported_cost_runs ? `${coverage.provider_reported_cost_runs} provider-reported` : null,
    coverage.catalogue_estimate_cost_runs ? `${coverage.catalogue_estimate_cost_runs} estimated` : null,
    coverage.unavailable_cost_runs ? `${coverage.unavailable_cost_runs} unavailable` : null,
    coverage.legacy_cost_runs ? `${coverage.legacy_cost_runs} legacy` : null,
  ].filter((part): part is string => Boolean(part));
  return `${formatCurrency(total)}${parts.length > 0 ? ` (${parts.join(", ")})` : ""}`;
}

function contextUsageBar(percent: number | null): string {
  if (percent === null) return "⬜";
  return percent > 90 ? "🟥" : percent > 75 ? "🟧" : "🟩";
}

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

/** Handle /state: display current session state summary. */
export async function handleState(session: AgentSession, _command: StateCommand): Promise<AgentControlResult> {
  const modelLabel = session.model ? `${session.model.provider}/${session.model.id}` : "none";
  const steeringCount = session.getSteeringMessages().length;
  const followUpCount = session.getFollowUpMessages().length;
  const sessionFileSize = (() => {
    if (!session.sessionFile) return null;
    try {
      return statSync(session.sessionFile).size;
    } catch {
      return null;
    }
  })();

  const sessionStorageConfig = getSessionStorageConfig();
  const compactionConfig = getCompactionRuntimeConfig();
  const isOversizedSession = sessionFileSize !== null && sessionFileSize >= sessionStorageConfig.maxSizeBytes;
  const sessionLineCount = getSessionFileLineCount(session.sessionFile);

  const lines = [
    "**Session state**",
    "",
    "| Setting | Value |",
    "|---|---|",
    `| **Model** | ${modelLabel} |`,
    `| **Thinking** | ${session.thinkingLevel}${session.supportsThinking() ? "" : " (off)"} |`,
    `| **Streaming** | ${session.isStreaming ? "yes" : "no"} |`,
    `| **Compacting** | ${session.isCompacting ? "yes" : "no"} |`,
    `| **Retrying** | ${session.isRetrying ? "yes" : "no"} |`,
    `| **Auto-compaction** | ${compactionConfig.autoCompactionEnabled ? "on" : "off"} |`,
    `| **Auto-retry** | ${session.autoRetryEnabled ? "on" : "off"} |`,
    `| **Steering mode** | ${session.steeringMode} |`,
    `| **Follow-up mode** | ${session.followUpMode} |`,
    `| **Pending** | ${session.pendingMessageCount} (steer ${steeringCount}, follow-up ${followUpCount}) |`,
    `| **Session id** | ${session.sessionId} |`,
    `| **Session name** | ${session.sessionName || "none"} |`,
    `| **Session file** | ${session.sessionFile || "none"} |`,
    `| **File size** | ${sessionFileSize === null ? "unknown" : formatBytes(sessionFileSize)} |`,
  ];

  if (sessionLineCount !== null) {
    lines.push(`| **File lines** | ${sessionLineCount}${sessionStorageConfig.maxLines > 0 ? ` / ${sessionStorageConfig.maxLines} max` : ""} |`);
  }

  if (session.model?.provider === "openai-codex") {
    const stats = getOpenAICodexWebSocketDebugStats(session.sessionId);
    lines.push(
      "",
      "**OpenAI Codex WebSocket diagnostics**",
      "",
      "| Metric | Value |",
      "|---|---|",
      `| Session id | ${session.sessionId || "none"} |`,
      `| Requests | ${stats?.requests ?? 0} |`,
      `| Connections | ${stats ? `${stats.connectionsCreated} created, ${stats.connectionsReused} reused` : "none recorded"} |`,
      `| Fallback active | ${stats?.websocketFallbackActive ? "yes" : "no"} |`,
      `| SSE fallbacks | ${stats?.sseFallbacks ?? 0} |`,
      `| WebSocket failures | ${stats?.websocketFailures ?? 0} |`,
      `| Last error | ${stats?.lastWebSocketError ? stats.lastWebSocketError.replace(/\|/g, "\\|") : "none"} |`,
    );
  } else {
    lines.push("", "**OpenAI Codex WebSocket diagnostics**", "", "Not applicable for the current provider.");
  }

  if (isOversizedSession && sessionFileSize !== null) {
    lines.push("", `> [!WARNING]\n> Session file exceeds threshold (${formatBytes(sessionFileSize)} >= ${sessionStorageConfig.maxSizeMb} MB). Consider \`/session-rotate\`.`);
  }
  return { status: "success", message: lines.join("\n") };
}

/** Handle /stats: display token usage and cost statistics. */
export async function handleStats(session: AgentSession, _command: StatsCommand): Promise<AgentControlResult> {
  const stats = session.getSessionStats();
  const tokens = stats.tokens;
  const lines = [
    "**Session stats**",
    "",
    "| Metric | Value |",
    "|---|---|",
    `| Messages | ${stats.userMessages} user, ${stats.assistantMessages} assistant, ${stats.toolResults} tool (${stats.totalMessages} total) |`,
    `| Tool calls | ${stats.toolCalls} |`,
    `| Tokens | in ${formatCompactNumber(tokens.input)}, out ${formatCompactNumber(tokens.output)}, cache-r ${formatCompactNumber(tokens.cacheRead)}, cache-w ${formatCompactNumber(tokens.cacheWrite)}, total ${formatCompactNumber(tokens.total)} |`,
    `| Catalogue cost estimate | ~${formatCurrency(stats.cost)} |`,
  ];

  try {
    const cacheWaste = computePromptCacheWaste(session.sessionManager.getEntries(), session.modelRuntime);
    if (cacheWaste.missedTokens > 0) {
      const missLabel = cacheWaste.missCount === 1 ? "1 miss" : `${cacheWaste.missCount} misses`;
      const cost = cacheWaste.missedCost >= 0.0001 ? `${formatCurrency(cacheWaste.missedCost)}, ` : "";
      lines.push(`| Cache re-billed | ${cost}${formatCompactNumber(cacheWaste.missedTokens)} tokens (${missLabel}) |`);
    }
  } catch (err) {
    debugSuppressedError(log, "Prompt-cache statistics were unavailable while building /stats output.", err, {
      operation: "agent_control.info.stats.prompt_cache",
      chatJid: getChatJid(),
    });
  }

  const chatJid = getChatJid();
  try {
    const totals = getTokenUsageTotals(chatJid);
    if (totals.runs > 0) {
      const providerRows = getTokenUsageByProvider(chatJid, 5);
      const modelRows = getTokenUsageByModel(chatJid, 5);
      const sourceRows = getTokenUsageBySource(chatJid, 5);

      lines.push(
        "",
        "**Tracked usage (persisted)**",
        "",
        "| Metric | Value |",
        "|---|---|",
        `| Tokens | in ${formatCompactNumber(totals.input_tokens)}, out ${formatCompactNumber(totals.output_tokens)}, reason ${formatCompactNumber(totals.reasoning_tokens ?? 0)}, cache-r ${formatCompactNumber(totals.cache_read_tokens)}, cache-w ${formatCompactNumber(totals.cache_write_tokens)}, total ${formatCompactNumber(totals.total_tokens)} |`,
        `| Cost | ${formatPersistedCost(totals.cost_total, totals)} |`,
        `| Runs | ${formatCompactNumber(totals.runs)} |`,
      );

      if (sourceRows.length > 0) {
        lines.push(
          "",
          "**Per source**",
          "",
          "| Source | Tokens | Reasoning | Tracked cost | Runs |",
          "|---|---|---|---|---|",
        );
        for (const row of sourceRows) {
          lines.push(`| ${row.usage_source || "unknown"} | ${formatCompactNumber(row.total_tokens)} | ${formatCompactNumber(row.reasoning_tokens ?? 0)} | ${formatPersistedCost(row.cost_total, row)} | ${formatCompactNumber(row.runs)} |`);
        }
      }

      if (providerRows.length > 0) {
        lines.push(
          "",
          "**Per provider**",
          "",
          "| Provider | Tokens | Reasoning | Tracked cost | Runs |",
          "|---|---|---|---|---|",
        );
        for (const row of providerRows) {
          lines.push(`| ${row.provider || "unknown"} | ${formatCompactNumber(row.total_tokens)} | ${formatCompactNumber(row.reasoning_tokens ?? 0)} | ${formatPersistedCost(row.cost_total, row)} | ${formatCompactNumber(row.runs)} |`);
        }
      }

      if (modelRows.length > 0) {
        lines.push(
          "",
          "**Per model**",
          "",
          "| Model | Tokens | Reasoning | Tracked cost | Runs |",
          "|---|---|---|---|---|",
        );
        for (const row of modelRows) {
          lines.push(`| ${row.model || "unknown"} | ${formatCompactNumber(row.total_tokens)} | ${formatCompactNumber(row.reasoning_tokens ?? 0)} | ${formatPersistedCost(row.cost_total, row)} | ${formatCompactNumber(row.runs)} |`);
        }
      }
    }
  } catch (err) {
    debugSuppressedError(log, "Token-usage statistics were unavailable while building /stats output.", err, {
      operation: "agent_control.info.stats.token_usage",
      chatJid,
    });
  }

  return { status: "success", message: lines.join("\n") };
}

/** Handle /context: display context window usage breakdown. */
export async function handleContext(session: AgentSession, _command: ContextCommand): Promise<AgentControlResult> {
  const usage = session.getContextUsage();
  if (!usage) {
    return { status: "error", message: "Context usage unavailable (no model configured)." };
  }
  if (usage.tokens === null) {
    return {
      status: "success",
      message: `Context window: ${formatCompactNumber(usage.contextWindow)} tokens. Usage unknown.`,
    };
  }
  const percent = finitePercent(usage.percent) ?? percentOf(usage.tokens, usage.contextWindow);
  const bar = contextUsageBar(percent);
  const lines = [
    "**Context usage**",
    "",
    "| Metric | Value |",
    "|---|---|",
    `| **Provider-reported used** | ${formatCompactNumber(usage.tokens)} / ${formatCompactNumber(usage.contextWindow)} tokens |`,
    `| **Provider fill** | ${bar} ${formatPercent(percent)} |`,
  ];

  try {
    const compactionStatus = getAutoCompactionTokenStatusForSession(session, getChatJid());
    if (compactionStatus) {
      const scoped = compactionStatus.tokenStatus;
      const activePercent = percentOf(compactionStatus.contextTokens, compactionStatus.contextWindow);
      const scopedPercent = percentOf(scoped.autoCompactionScopeTokens, scoped.autoCompactionScopeLimit);
      lines.push(
        `| **Piclaw active estimate** | ${formatCompactNumber(compactionStatus.contextTokens)} / ${formatCompactNumber(compactionStatus.contextWindow)} tokens (${formatPercent(activePercent)}) |`,
        `| **Raw active estimate** | ${formatCompactNumber(compactionStatus.rawContextTokens)} tokens |`,
        `| **Effective window** | ${formatCompactNumber(compactionStatus.effectiveContextWindow)} tokens after ${formatCompactNumber(compactionStatus.overheadTokens)} overhead |`,
        `| **Auto-compaction scope** | ${scoped.scope === "body_after_prefix" ? "body after prefix" : "total context"} |`,
        `| **Scoped usage** | ${formatCompactNumber(scoped.autoCompactionScopeTokens)} / ${formatCompactNumber(scoped.autoCompactionScopeLimit)} tokens (${formatPercent(scopedPercent)}) |`,
        `| **Hard ceiling** | ${formatCompactNumber(scoped.fullContextWindowLimit)} tokens${scoped.fullContextWindowLimitReached ? " (reached)" : ""} |`,
        `| **Reserve** | ${formatCompactNumber(compactionStatus.reserveTokens)} tokens |`,
      );
      if (scoped.baselineTokens !== null || scoped.prefillTokens !== null) {
        lines.push(`| **Compaction window** | #${scoped.windowOrdinal ?? 1}, baseline ${scoped.baselineTokens === null ? "unset" : formatCompactNumber(scoped.baselineTokens)}, prefill ${scoped.prefillTokens === null ? "unset" : formatCompactNumber(scoped.prefillTokens)} |`);
      }
    }
  } catch (error) {
    debugSuppressedError(log, "Failed to compute Piclaw context estimate for /context", error, {
      operation: "agent_control.context.compaction_status",
    });
  }

  return {
    status: "success",
    message: lines.join("\n"),
  };
}

/** Handle /quota: dump the cached provider usage snapshot for the current model (no live refetch). */
export async function handleQuota(session: AgentSession, _command: QuotaCommand): Promise<AgentControlResult> {
  const provider = session.model?.provider ?? null;
  const modelLabel = session.model ? `${session.model.provider}/${session.model.id}` : "<none>";
  const snapshot = provider
    ? await peekProviderUsageForRuntime(session.modelRuntime, provider, { allowStale: true })
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

/** Handle /last: display the last assistant response. */
export async function handleLast(session: AgentSession, _command: LastCommand): Promise<AgentControlResult> {
  const last = session.getLastAssistantText();
  if (!last) {
    return { status: "error", message: "No assistant messages yet." };
  }
  return { status: "success", message: `Last assistant response:\n\n${last}` };
}

/** Handle /search-workspace: full-text search across workspace files. */
export async function handleSearchWorkspace(_session: AgentSession, command: SearchCommand): Promise<AgentControlResult> {
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

/** Handle /commands: list all available control commands. */
export async function handleCommands(session: AgentSession, _command: CommandsCommand): Promise<AgentControlResult> {
  type CommandSource = "core" | "extension" | "pi-extension" | "template" | "skill";
  type ExtensionMeta = { source: CommandSource; detail?: string };
  interface CommandEntry {
    name: string;
    description?: string;
    source: CommandSource;
    detail?: string;
    scope?: string;
    extensions: ExtensionMeta[];
  }

  const describeSource = (source: CommandSource, detail?: string, scope?: string): string => {
    const base =
      source === "core" ? "core"
        : source === "extension" ? "workspace extension"
          : source === "pi-extension" ? "pi extension"
            : source === "template" ? "prompt template"
              : "skill";
    const parts = [base];
    if (scope && scope !== "project") parts.push(scope);
    if (detail) parts.push(detail);
    return parts.length > 1 ? `${parts[0]} (${parts.slice(1).join(", ")})` : parts[0];
  };

  const entries = new Map<string, CommandEntry>();
  const addEntry = (name: string, description: string | undefined, source: CommandSource, detail?: string, scope?: string) => {
    const trimmed = name.trim();
    if (!trimmed) return;
    const key = trimmed.toLowerCase();
    const existing = entries.get(key);
    if (!existing) {
      entries.set(key, { name: trimmed, description, source, detail, scope, extensions: [] });
      return;
    }

    if (!existing.description && description) {
      existing.description = description;
    }

    if (existing.source === "core") {
      existing.extensions.push({ source, detail });
      return;
    }

    if (source === "core") {
      const previous: ExtensionMeta = { source: existing.source, detail: existing.detail };
      entries.set(key, {
        name: trimmed,
        description: description ?? existing.description,
        source: "core",
        detail: undefined,
        extensions: [...existing.extensions, previous],
      });
      return;
    }

    existing.extensions.push({ source, detail });
  };

  for (const command of CONTROL_COMMAND_DEFINITIONS) {
    addEntry(command.name, command.description, "core");
  }

  const extensionRunner = session.extensionRunner;
  if (extensionRunner) {
    const extCommands = extensionRunner.getRegisteredCommands();
    const isPiBuiltin = (path: string | undefined) => {
      if (!path) return false;
      return path.includes("node_modules/@earendil-works/pi-");
    };
    for (const entry of extCommands) {
      const name = entry.invocationName || entry.name;
      if (!name) continue;
      const si = entry.sourceInfo;
      const entryPath = si?.path;
      const entryScope = si?.scope;
      const description = entry.description || `extension (${entryPath || "unknown"})`;
      const source: CommandSource = isPiBuiltin(entryPath) ? "pi-extension" : "extension";
      const detail = si ? `${si.source}${si.origin === "package" ? " pkg" : ""}` : (entryPath || undefined);
      addEntry(`/${name}`, description, source, detail, entryScope);
    }
  }

  for (const template of session.promptTemplates) {
    const description = template.description || "prompt template";
    const si = template.sourceInfo;
    const detail = si ? si.source : template.name;
    addEntry(`/${template.name}`, description, "template", detail, si?.scope);
  }

  const skills = session.resourceLoader.getSkills().skills;
  for (const skill of skills) {
    const description = skill.description || "skill";
    const si = skill.sourceInfo;
    const detail = si ? si.source : skill.name;
    addEntry(`/skill:${skill.name}`, description, "skill", detail, si?.scope);
  }

  const sorted = Array.from(entries.values()).sort((a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: "base" }));
  const rows: string[] = [];
  for (const entry of sorted) {
    const desc = entry.description || "";
    const notes: string[] = [];
    if (entry.source !== "core") {
      notes.push(describeSource(entry.source, entry.detail, entry.scope));
    }
    if (entry.extensions.length) {
      const extNotes = entry.extensions.map((ext) => describeSource(ext.source, ext.detail));
      notes.push(`extended by ${extNotes.join(", ")}`);
    }
    const noteText = notes.length ? ` _[${notes.join("; ")}]_` : "";
    rows.push(`| \`${entry.name}\` | ${desc}${noteText} |`);
  }

  return {
    status: "success",
    message: [
      "**Available commands**",
      "",
      "| Command | Description |",
      "|---|---|",
      ...rows,
    ].join("\n"),
  };
}
