import type { AgentContext, ModelPricing, ProviderUsage, TokenUsageSummary } from "./types";

function finiteNumber(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function formatCompact(value: number): string {
  if (value >= 1_000_000) return `${(value / 1_000_000).toFixed(1)}M`;
  if (value >= 1_000) return `${Math.round(value / 1_000)}K`;
  return String(value);
}

function formatUsd(value: unknown): string | null {
  const numeric = finiteNumber(value);
  if (numeric === null || numeric < 0) return null;
  return `$${numeric.toFixed(numeric >= 0.01 ? 2 : 4)}`;
}

function requestedModelLabel(latest: TokenUsageSummary): string | null {
  const provider = typeof latest.provider === "string" && latest.provider.trim() ? latest.provider.trim() : null;
  const model = typeof latest.model === "string" && latest.model.trim() ? latest.model.trim() : null;
  if (!model) return provider;
  if (!provider || model.startsWith(`${provider}/`)) return model;
  return `${provider}/${model}`;
}

function sameRequestedModel(left: string | null, right: string | null): boolean {
  const a = left?.trim().toLowerCase();
  const b = right?.trim().toLowerCase();
  if (!a || !b) return false;
  if (a.includes("/") && b.includes("/")) return a === b;
  return a === b || a.endsWith(`/${b}`) || b.endsWith(`/${a}`);
}

export function mergeVisualLiveContext(
  previous: AgentContext | null,
  live: {
    tokens?: number | null;
    contextWindow?: number | null;
    percent?: number | null;
    cacheUsage?: AgentContext["cacheUsage"];
  },
): AgentContext {
  return {
    tokens: live.tokens ?? previous?.tokens ?? null,
    contextWindow: live.contextWindow ?? previous?.contextWindow ?? 0,
    percent: live.percent ?? previous?.percent ?? null,
    cacheUsage: live.cacheUsage ?? previous?.cacheUsage ?? null,
  };
}

export function formatVisualLatestRunUsage(context: AgentContext | null, activeModel: string | null): { label: string; title: string } | null {
  const latest = context?.cacheUsage?.latest;
  if (!latest) return null;
  const requestedModel = requestedModelLabel(latest);
  const previous = Boolean(activeModel && requestedModel && !sameRequestedModel(activeModel, requestedModel));
  const input = finiteNumber(latest.inputTokens) ?? 0;
  const cacheRead = finiteNumber(latest.cacheReadTokens) ?? 0;
  const cacheWrite = finiteNumber(latest.cacheWriteTokens) ?? 0;
  const denominator = input + cacheRead + cacheWrite;
  const cacheRate = latest.cacheReadReported === false || denominator <= 0 || (cacheRead <= 0 && latest.cacheReadReported !== true)
    ? null
    : (cacheRead / denominator) * 100;
  const cacheLabel = cacheRate === null ? "CH—" : `CH${cacheRate.toFixed(1)}%`;
  const total = finiteNumber(latest.totalTokens);
  const cost = formatUsd(latest.costTotal);
  const costLabel = latest.costProvenance === "provider_reported" ? cost
    : latest.costProvenance === "catalogue_estimate" && cost ? `~${cost}` : null;
  const detail = [
    ["in", latest.inputTokens],
    ["out", latest.outputTokens],
    ["reason", latest.reasoningTokens],
    ["cache-r", latest.cacheReadTokens],
    ["cache-w", latest.cacheWriteTokens],
    ["total", latest.totalTokens],
  ].map(([label, value]) => {
    const numeric = finiteNumber(value);
    return numeric === null ? null : `${label} ${formatCompact(numeric)}`;
  }).filter(Boolean).join(", ");
  const responseModel = typeof latest.responseModel === "string" && latest.responseModel.trim() ? latest.responseModel.trim() : null;
  const cacheTitle = cacheRate === null
    ? latest.cacheReadReported === false ? "Prompt cache telemetry unavailable" : "Prompt cache hit unavailable"
    : `Prompt cache hit: ${cacheRate.toFixed(1)}%`;
  const costTitle = latest.costProvenance === "provider_reported" && cost
    ? `Provider-reported cost: ${cost}`
    : latest.costProvenance === "catalogue_estimate" && cost
      ? `Catalogue cost estimate: ~${cost}`
      : "Cost unavailable";
  return {
    label: [previous ? "Prev" : "Last", total === null ? null : formatCompact(total), cacheLabel, costLabel].filter(Boolean).join(" • "),
    title: [
      `${previous ? "Previous" : "Latest"} run${requestedModel ? `: ${requestedModel}` : ""}`,
      responseModel && responseModel !== latest.model ? `Response model: ${responseModel}` : null,
      detail || null,
      cacheTitle,
      costTitle,
    ].filter(Boolean).join(" • "),
  };
}

export function formatVisualProviderUsage(usage: ProviderUsage | null): { label: string; title: string } | null {
  if (!usage) return null;
  if (usage.provider === "openrouter") {
    const label = usage.hint_short?.trim() || "OpenRouter key usage unavailable";
    if (usage.availability !== "available") return { label, title: label };
    const limit = usage.key_limit_configured === true
      ? formatUsd(usage.key_limit_usd) || "unavailable"
      : usage.key_limit_unlimited ? "not configured (unlimited)" : "unavailable";
    return {
      label,
      title: [
        `Key spend: ${formatUsd(usage.key_usage_usd) || "unavailable"}`,
        `Key limit: ${limit}`,
        `Key remaining: ${formatUsd(usage.key_limit_remaining_usd) || "unavailable"}`,
        usage.stale ? `Telemetry stale after ${usage.refresh_failure || "refresh failure"}` : null,
      ].filter(Boolean).join(" • "),
    };
  }
  if (usage.primary && typeof usage.primary.used_percent === "number") {
    return {
      label: `${usage.primary.used_percent}% ${usage.primary.label || "premium"}`,
      title: [usage.provider ? `Provider: ${usage.provider}` : null, usage.plan ? `Plan: ${usage.plan}` : null].filter(Boolean).join(" • "),
    };
  }
  return usage.hint_short?.trim() ? { label: usage.hint_short.trim(), title: usage.hint_short.trim() } : null;
}

export function formatVisualModelPricing(pricing: ModelPricing | null | undefined): string {
  if (!pricing) return "";
  const parts: Array<[string, unknown]> = [
    ["in", pricing.input_per_million],
    ["out", pricing.output_per_million],
    ["cache-r", pricing.cache_read_per_million],
    ["cache-w", pricing.cache_write_per_million],
  ];
  const rates = parts.map(([label, value]) => {
    const numeric = finiteNumber(value);
    if (numeric === null || numeric < 0) return null;
    return `${label} $${numeric.toFixed(numeric >= 1 ? 2 : 4).replace(/0+$/, "").replace(/\.$/, "")}`;
  }).filter(Boolean);
  return rates.length ? `${rates.join(" / ")} per 1M` : "";
}
