import type { ExtensionAPI, ExtensionFactory, ModelRuntime } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";
import { peekProviderUsageForRuntime, warmProviderUsage, type ProviderUsageSnapshot, type ProviderUsageWindow } from "../agent-pool/provider-usage.js";

import { createLogger } from "../utils/logger.js";

export const SUPPORTED_PROVIDER_QUOTA_IDS = ["openai-codex", "github-copilot", "openrouter", "zai"] as const;
type UsageRuntime = Pick<ModelRuntime, "getAuth">;
type Dependencies = { peek: typeof peekProviderUsageForRuntime; warm: typeof warmProviderUsage; refreshWaitMs: number; cacheWaitMs: number };
const DEFAULT_DEPS: Dependencies = { peek: peekProviderUsageForRuntime, warm: warmProviderUsage, refreshWaitMs: 5_000, cacheWaitMs: 5_000 };
// Match the shared provider-usage cache's internal TTL. allowStale does not mark aged values stale.
const USAGE_CACHE_TTL_MS = 60_000;
const log = createLogger("extensions.provider-quota");

function result(text: string, details: Record<string, unknown>) { return { content: [{ type: "text" as const, text }], details }; }
function display(value: string | number | boolean | null): string {
  if (value === null || value === "") return "not reported";
  if (typeof value === "boolean") return value ? "yes" : "no";
  return String(value);
}
function usd(value: number | null): string { return value === null ? "not reported" : `$${value.toFixed(4).replace(/0+$/, "").replace(/\.$/, ".00")}`; }
function windowLines(name: "primary" | "secondary", window: ProviderUsageWindow | null): string[] {
  const prefix = name === "primary" ? "Primary window" : "Secondary window";
  if (!window) return [`${prefix}: not reported.`];
  return [
    `${prefix} (${window.label}):`,
    `  Used: ${window.used_percent === null ? "not reported" : `${window.used_percent}%`}.`,
    `  Remaining: ${window.remaining_percent === null ? "not reported" : `${window.remaining_percent}%`}.`,
    `  Duration: ${window.window_minutes === null ? "not reported" : `${window.window_minutes} minutes`}.`,
    `  Reset: ${window.resets_at ?? "not reported"}${window.reset_description ? ` (${window.reset_description})` : ""}.`,
  ];
}
function availabilityText(snapshot: ProviderUsageSnapshot): string {
  switch (snapshot.availability) {
    case "authentication_required": return "Authentication required; no authenticated quota data is available.";
    case "authentication_failed": return "Authentication failed; quota data could not be refreshed.";
    case "temporary_failure": return "Provider quota request failed temporarily.";
    case "malformed_response": return "Provider returned invalid or incomplete quota data.";
    default: return "Quota data is available.";
  }
}
function formatSnapshot(snapshot: ProviderUsageSnapshot, refreshNote: string | null): string {
  const freshness = snapshot.stale
    ? `stale${snapshot.refresh_failure ? `; last refresh failed (${snapshot.refresh_failure})` : ""}`
    : "fresh as of the provider fetch shown below";
  const lines = [
    `Provider quota: ${snapshot.provider}`,
    `Availability: ${snapshot.availability}. ${availabilityText(snapshot)}`,
    `Source: ${display(snapshot.source)}.`,
    `Plan: ${display(snapshot.plan)}.`,
    `Freshness: ${freshness}.`,
    `Fetched at: ${snapshot.fetched_at || "not reported"}.`,
    `Last refresh failure: ${display(snapshot.refresh_failure)}.`,
  ];
  if (refreshNote) lines.push(refreshNote);
  lines.push(...windowLines("primary", snapshot.primary), ...windowLines("secondary", snapshot.secondary));
  lines.push(
    `Credits remaining: ${display(snapshot.credits_remaining)} (credit units, not USD).`,
    `Credits unlimited: ${display(snapshot.credits_unlimited)}.`,
  );
  if (snapshot.provider === "openrouter") {
    const limit = snapshot.key_limit_unlimited ? "no key cap (not unlimited account credits)" : snapshot.key_limit_usd === null ? "not reported" : usd(snapshot.key_limit_usd);
    lines.push(
      "OpenRouter key amounts below are USD, distinct from provider credit units:",
      `  Key usage: ${usd(snapshot.key_usage_usd)}.`,
      `  Key limit: ${limit}.`,
      `  Key limit configured: ${display(snapshot.key_limit_configured)}.`,
      `  No key cap: ${display(snapshot.key_limit_unlimited)}.`,
      `  Key limit remaining: ${usd(snapshot.key_limit_remaining_usd)}.`,
      `  Daily / weekly / monthly usage: ${usd(snapshot.key_usage_daily_usd)} / ${usd(snapshot.key_usage_weekly_usd)} / ${usd(snapshot.key_usage_monthly_usd)}.`,
      `  Key limit reset policy (not a window reset timestamp): ${display(snapshot.key_limit_reset)}.`,
      `  Free tier: ${display(snapshot.is_free_tier)}.`,
      `  BYOK included in limit: ${display(snapshot.include_byok_in_limit)}.`,
    );
  }
  lines.push(`Summary: ${display(snapshot.hint_short)}.`);
  return lines.join("\n");
}

type WaitOutcome = "completed" | "timed_out" | "cancelled" | "failed";
type BoundedResult<T> = { outcome: "completed"; value: T } | { outcome: "cancelled" } | { outcome: "failed" } | { outcome: "timed_out" };

function boundedWait<T>(start: () => Promise<T>, signal: AbortSignal | undefined, waitMs: number, provider: string, operation: "refresh" | "cache"): Promise<BoundedResult<T>> {
  // Neither the shared warmer nor credential-bound peek accepts a signal. Bound our wait,
  // not their underlying work. A thunk prevents starting either operation after cancellation.
  if (signal?.aborted) return Promise.resolve({ outcome: "cancelled" });
  return new Promise((resolve) => {
    let settled = false;
    const finish = (outcome: BoundedResult<T>) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      signal?.removeEventListener("abort", onAbort);
      resolve(outcome);
    };
    const onAbort = () => finish({ outcome: "cancelled" });
    const timer = setTimeout(() => finish({ outcome: "timed_out" }), waitMs);
    signal?.addEventListener("abort", onAbort, { once: true });
    if (signal?.aborted) return onAbort();
    const fail = () => {
      // Auth exceptions can embed credentials in their message/stack/cause. Do not log
      // the raw exception, even for a rejection after this tool stopped waiting.
      log.warn("Provider quota operation failed; internal error details omitted.", { provider, operation, after_wait: settled });
      finish({ outcome: "failed" });
    };
    try {
      start().then((value) => finish({ outcome: "completed", value }), fail);
    } catch {
      fail();
    }
  });
}

function ageSnapshot(snapshot: ProviderUsageSnapshot): ProviderUsageSnapshot {
  const fetchedAt = Date.parse(snapshot.fetched_at);
  return { ...snapshot, stale: snapshot.stale || snapshot.refresh_failure !== null || !Number.isFinite(fetchedAt) || Date.now() - fetchedAt >= USAGE_CACHE_TTL_MS };
}

/** Create the read-only provider_quota tool. Dependencies are injectable for mock-only tests. */
export function createProviderQuotaExtension(options: { modelRuntime?: UsageRuntime; dependencies?: Partial<Dependencies> } = {}): ExtensionFactory {
  const dependencies = { ...DEFAULT_DEPS, ...options.dependencies };
  return (pi: ExtensionAPI) => {
    pi.registerTool({
      name: "provider_quota",
      label: "provider_quota",
      description: "Read credential-bound cached quota/usage for the current or selected provider. Authentication resolution and cache/refresh waits are bounded (up to 5 seconds each) and cancellable. refresh=true requests the existing shared usage warmer, which may reuse fresh cache or in-flight work; it does not force a network fetch. Never changes provider configuration.",
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true },
      promptSnippet: "provider_quota: inspect cached provider quota; set refresh=true only when a bounded wait for the shared provider usage warmer is needed.",
      parameters: Type.Object({
        provider: Type.Optional(Type.String({ description: "Provider ID; defaults to the current model provider." })),
        refresh: Type.Optional(Type.Boolean({ description: "Request the existing shared usage warmer and wait briefly; fresh cache or in-flight work may be reused, not a forced network fetch. Default false reads credential-bound cache only (authentication may still be resolved)." })),
      }),
      async execute(_id, params, signal, _update, ctx) {
        const provider = typeof params.provider === "string" ? params.provider.trim() : ctx.model?.provider?.trim();
        if (!provider) return result(`No model/provider is selected. Supported providers: ${SUPPORTED_PROVIDER_QUOTA_IDS.join(", ")}.`, {
          ok: false, reason: "no_model", provider: null, supported_providers: SUPPORTED_PROVIDER_QUOTA_IDS,
        });
        if (!(SUPPORTED_PROVIDER_QUOTA_IDS as readonly string[]).includes(provider)) return result(`Provider "${provider}" is unsupported for quota reporting. Supported providers: ${SUPPORTED_PROVIDER_QUOTA_IDS.join(", ")}.`, {
          ok: false, reason: "unsupported_provider", provider, supported_providers: SUPPORTED_PROVIDER_QUOTA_IDS,
        });
        const runtime = (ctx as typeof ctx & { modelRuntime?: UsageRuntime }).modelRuntime ?? options.modelRuntime;
        if (!runtime) return result(`Provider quota for ${provider} is unavailable because no model runtime is present.`, {
          ok: false, reason: "no_model_runtime", provider, supported_providers: SUPPORTED_PROVIDER_QUOTA_IDS,
        });

        const refreshRequested = params.refresh === true;
        let waitOutcome: WaitOutcome | "not_requested" = refreshRequested ? "cancelled" : "not_requested";
        let cacheOutcome: WaitOutcome | "not_requested" = "not_requested";
        let refreshStarted = false;
        const reply = (text: string, details: Record<string, unknown>) => result([
          text,
          `Refresh requested: ${display(refreshRequested)}.`,
          `Shared warmer started: ${display(refreshStarted)}.`,
          `Refresh wait: ${waitOutcome}.`,
          `Credential-bound cache wait: ${cacheOutcome}.`,
          `Supported providers: ${SUPPORTED_PROVIDER_QUOTA_IDS.join(", ")}.`,
        ].join("\n"), {
          ...details, provider, refresh_requested: refreshRequested, refresh_started: refreshStarted,
          refresh_wait: waitOutcome, cache_wait: cacheOutcome, supported_providers: SUPPORTED_PROVIDER_QUOTA_IDS,
        });
        const cancelled = () => reply(refreshStarted
          ? "Provider quota lookup cancelled. The shared warmer and authentication lookup have no abort support; already-started work may continue. No further quota work was started."
          : "Provider quota lookup cancelled. No shared warmer was started; any already-started authentication lookup may continue.",
          { ok: false, reason: "cancelled" });
        if (signal?.aborted) return cancelled();
        if (refreshRequested) {
          const warmed = await boundedWait(() => {
            refreshStarted = true;
            return dependencies.warm(runtime, provider);
          }, signal, dependencies.refreshWaitMs, provider, "refresh");
          waitOutcome = warmed.outcome;
          if (waitOutcome === "cancelled") return cancelled();
        }
        const cached = await boundedWait(() => dependencies.peek(runtime, provider, { allowStale: true }), signal, dependencies.cacheWaitMs, provider, "cache");
        cacheOutcome = cached.outcome;
        if (cached.outcome === "cancelled") return cancelled();
        if (cached.outcome === "timed_out") return reply(`Credential-bound quota cache/authentication lookup for ${provider} timed out. No unverified cached quota is returned; already-started work may continue.`, {
          ok: false, reason: "cache_wait_timed_out",
        });
        if (cached.outcome === "failed") return reply(`Unable to read credential-bound cached quota data for ${provider}. Authentication or cache lookup failed; no internal error or credential details are exposed.`, {
          ok: false, reason: "auth_or_cache_error",
        });
        // Cancellation can occur between completed operations; do not return account data then.
        if (signal?.aborted) return cancelled();
        const refreshNote = !refreshRequested ? null : [
          "Refresh requests the existing shared usage warmer; fresh cache or in-flight work may be reused. It does not force a network fetch.",
          waitOutcome === "timed_out"
            ? "Refresh wait timed out. The shared warmer has no abort support; already-started work may still update its cache. Showing credential-bound cached data when available."
            : waitOutcome === "failed" ? "The shared warmer failed. Showing credential-bound cached data when available." : "The shared warmer wait completed.",
        ].join("\n");
        if (cached.value === null) {
          const base = refreshRequested
            ? "No credential-bound quota data is cached after the bounded shared-warmer wait. Credentials may be unavailable, authentication may have failed, or the quota request may have failed."
            : "No credential-bound cached quota data is available. No quota API refresh was requested; retry with refresh=true to request the shared usage warmer.";
          return reply(`${base}${refreshNote ? `\n${refreshNote}` : ""}`, {
            ok: false, reason: refreshRequested ? "no_data_after_refresh" : "no_cached_data",
          });
        }
        const snapshot = ageSnapshot(cached.value);
        return reply(formatSnapshot(snapshot, refreshNote), { ok: snapshot.availability === "available", snapshot });
      },
    });
  };
}

/** Default factory; parent integrations should use createProviderQuotaExtension({ modelRuntime }). */
export const providerQuota: ExtensionFactory = createProviderQuotaExtension();
