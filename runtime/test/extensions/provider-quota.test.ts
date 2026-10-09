import { afterEach, beforeEach, describe, expect, mock, test } from "bun:test";
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { createTempWorkspace, type TempWorkspace } from "../helpers.js";
import { createProviderQuotaExtension, SUPPORTED_PROVIDER_QUOTA_IDS } from "../../src/extensions/provider-quota.js";
import { clearProviderUsageCache, peekProviderUsageForRuntime, warmProviderUsage, type ProviderUsageSnapshot } from "../../src/agent-pool/provider-usage.js";
import { addLogSink, removeLogSink, type LogRecord } from "../../src/utils/logger.js";

const runtime = { getAuth: async () => undefined } as any;
function snapshot(overrides: Partial<ProviderUsageSnapshot> = {}): ProviderUsageSnapshot {
  return {
    provider: "openai-codex", source: "mock-source", availability: "available", stale: false,
    refresh_failure: null, plan: "pro", fetched_at: new Date(Date.now()).toISOString(),
    primary: { label: "5h", used_percent: 25, remaining_percent: 75, window_minutes: 300, resets_at: "2026-03-01T17:00:00.000Z", reset_description: "resets in ~5h" },
    secondary: null, credits_remaining: 12.5, credits_unlimited: false,
    key_usage_usd: null, key_limit_usd: null, key_limit_remaining_usd: null,
    key_limit_configured: null, key_limit_unlimited: false, key_limit_reset: null,
    key_usage_daily_usd: null, key_usage_weekly_usd: null, key_usage_monthly_usd: null,
    is_free_tier: null, include_byok_in_limit: null, hint_short: "5h 75% • credits 12.5",
    ...overrides,
  };
}
function setup(options: any = {}) {
  const tools = new Map<string, any>();
  createProviderQuotaExtension({ modelRuntime: runtime, ...options })({ registerTool: (tool: any) => tools.set(tool.name, tool) } as any);
  const tool = tools.get("provider_quota");
  const call = (params: any = {}, ctx: any = { model: { provider: "openai-codex" } }, signal?: AbortSignal) =>
    tool.execute("call", params, signal, undefined, ctx);
  return { tool, call };
}
function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}

const fixtures: TempWorkspace[] = [];
function authRuntime(credentials: Record<string, any>) {
  const fixture = createTempWorkspace("piclaw-provider-quota-");
  fixtures.push(fixture);
  const authPath = join(fixture.base, "auth.json");
  writeFileSync(authPath, JSON.stringify(credentials), { mode: 0o600 });
  return {
    authPath,
    getAuth: async (provider: string) => {
      const credential = credentials[provider];
      const apiKey = credential?.type === "oauth" ? credential.access : credential?.key;
      return apiKey ? { auth: { apiKey }, source: "mock credential" } : undefined;
    },
  } as any;
}

let previousFetch: typeof fetch;
let previousNow: typeof Date.now;
let apiCalls: number;
const logs: LogRecord[] = [];
const logSink = (record: LogRecord) => { if (["extensions.provider-quota", "agent-pool.provider-usage"].includes(record.module)) logs.push(record); };

beforeEach(() => {
  clearProviderUsageCache();
  previousFetch = globalThis.fetch;
  previousNow = Date.now;
  apiCalls = 0;
  logs.length = 0;
  addLogSink(logSink);
  // Guard every test against accidentally calling a live endpoint, including via default dependencies.
  globalThis.fetch = mock(async () => { apiCalls++; throw new Error("Unexpected API request in mock-only quota test"); }) as any;
});
afterEach(() => {
  globalThis.fetch = previousFetch;
  Date.now = previousNow;
  clearProviderUsageCache();
  removeLogSink(logSink);
  for (const fixture of fixtures.splice(0)) fixture.cleanup();
});

describe("provider_quota", () => {
  test("real shared warmer does not log secret authentication errors at debug level", async () => {
    const oldLevel = process.env.PICLAW_LOG_LEVEL;
    process.env.PICLAW_LOG_LEVEL = "debug";
    try {
      const secret = "fixture-secret-in-message-stack-and-cause";
      const auth = authRuntime({ "openai-codex": { type: "oauth", access: "fixture-access", accountId: "fixture-account" } });
      auth.getAuth = async () => { throw new Error(secret, { cause: { token: secret } }); };
      const { call } = setup({ modelRuntime: auth });
      const out = await call({ provider: "openai-codex", refresh: true });
      expect(out.details.reason).toBe("no_data_after_refresh");
      expect(logs.some((record) => record.module === "agent-pool.provider-usage")).toBe(true);
      expect(JSON.stringify(logs)).not.toContain(secret);
      expect(JSON.stringify(out)).not.toContain(secret);
      expect(apiCalls).toBe(0);
    } finally { if (oldLevel === undefined) delete process.env.PICLAW_LOG_LEVEL; else process.env.PICLAW_LOG_LEVEL = oldLevel; }
  });
  test("registers read-only annotations and uses factory runtime for current-provider cached-only lookup", async () => {
    const data = snapshot();
    const peek = mock(async (r: any, provider: string, opts: any) => {
      expect(r).toBe(runtime);
      expect(provider).toBe("openai-codex");
      expect(opts).toEqual({ allowStale: true });
      return data;
    });
    const warm = mock(async () => null);
    const { tool, call } = setup({ dependencies: { peek, warm } });
    const out = await call();
    expect(tool.name).toBe("provider_quota");
    expect(tool.annotations).toEqual({ readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true });
    expect(tool.description).toContain("does not force a network fetch");
    expect(tool.parameters.properties.refresh.description).toContain("authentication may still be resolved");
    expect(peek).toHaveBeenCalledTimes(1);
    expect(warm).not.toHaveBeenCalled();
    expect(apiCalls).toBe(0);
    expect(out.details).toMatchObject({ ok: true, refresh_requested: false, refresh_started: false, refresh_wait: "not_requested", cache_wait: "completed" });
    expect(out.content[0].text).toContain("Availability: available. Quota data is available");
    expect(out.content[0].text).toContain("Used: 25%");
    expect(out.content[0].text).toContain("Credits remaining: 12.5 (credit units, not USD)");
    expect(out.content[0].text).toContain(`Fetched at: ${data.fetched_at}`);
  });

  test("reports missing model/runtime and rejects unsupported provider IDs before auth or refresh", async () => {
    const peek = mock(async () => null);
    const warm = mock(async () => null);
    const { call } = setup({ dependencies: { peek, warm } });
    expect((await call({}, {})).details.reason).toBe("no_model");
    expect((await call({ provider: " " })).details.reason).toBe("no_model");
    expect((await setup({ modelRuntime: undefined }).call()).details.reason).toBe("no_model_runtime");
    for (const provider of ["anthropic", "openai", "codex", "copilot", "z.ai", "OpenRouter", "custom-provider"]) {
      const out = await call({ provider, refresh: true });
      expect(out.details.reason).toBe("unsupported_provider");
      expect(out.content[0].text).toContain("openai-codex, github-copilot, openrouter, zai");
    }
    expect(peek).not.toHaveBeenCalled();
    expect(warm).not.toHaveBeenCalled();
    expect(apiCalls).toBe(0);
  });

  test("accepts exactly the four supported IDs, trims provider input, and explicit selection wins", async () => {
    expect(SUPPORTED_PROVIDER_QUOTA_IDS).toEqual(["openai-codex", "github-copilot", "openrouter", "zai"]);
    for (const provider of SUPPORTED_PROVIDER_QUOTA_IDS) {
      const { call } = setup({ dependencies: { peek: async (_r: any, id: string) => {
        expect(id).toBe(provider); return snapshot({ provider });
      } } });
      expect((await call({ provider: ` ${provider} ` }, { model: { provider: "anthropic" } })).details.provider).toBe(provider);
    }
    const { call } = setup({ dependencies: { peek: async () => snapshot() } });
    expect((await call({}, { model: { provider: " openai-codex " } })).details.ok).toBe(true);
    expect(apiCalls).toBe(0);
  });

  test("describes missing cache separately from missing data after a shared-warmer request", async () => {
    const warm = mock(async () => null);
    const { call } = setup({ dependencies: { peek: async () => null, warm } });
    const empty = await call({ provider: "zai" });
    expect(empty.details.reason).toBe("no_cached_data");
    expect(empty.content[0].text).toContain("No quota API refresh was requested");
    expect(warm).not.toHaveBeenCalled();
    const refreshed = await call({ provider: "zai", refresh: true });
    expect(refreshed.details.reason).toBe("no_data_after_refresh");
    expect(refreshed.content[0].text).toContain("does not force a network fetch");
  });

  test("refresh waits for the shared warmer then re-peeks rather than trusting the warmer's return", async () => {
    const calls: string[] = [];
    const { call } = setup({ dependencies: {
      warm: async (_r: any, provider: string) => { calls.push(`warm:${provider}`); return snapshot({ plan: "wrong-account" }); },
      peek: async (_r: any, provider: string) => { calls.push(`peek:${provider}`); return snapshot({ stale: true, refresh_failure: "temporary_failure" }); },
    } });
    const out = await call({ refresh: true });
    expect(calls).toEqual(["warm:openai-codex", "peek:openai-codex"]);
    expect(out.details.refresh_wait).toBe("completed");
    expect(out.content[0].text).toContain("Freshness: stale; last refresh failed (temporary_failure)");
    expect(out.content[0].text).not.toContain("wrong-account");
  });

  test("never returns warmer data if credential-bound peek finds no cache", async () => {
    const { call } = setup({ dependencies: { warm: async () => snapshot(), peek: async () => null } });
    const out = await call({ refresh: true });
    expect(out.details.reason).toBe("no_data_after_refresh");
    expect(out.details.snapshot).toBeUndefined();
  });

  for (const age of [0, 59_999, 60_000, 60_001]) {
    test(`marks cache age ${age}ms stale at the exact 60s TTL without mutating shared cache`, async () => {
      const now = 1_800_000_000_000;
      Date.now = () => now;
      const data = snapshot({ fetched_at: new Date(now - age).toISOString() });
      const { call } = setup({ dependencies: { peek: async () => data } });
      const out = await call();
      expect(out.details.snapshot.stale).toBe(age >= 60_000);
      expect(data.stale).toBe(false);
      expect(out.details.snapshot).not.toBe(data);
      expect(out.content[0].text).toContain(age >= 60_000 ? "Freshness: stale" : "Freshness: fresh");
    });
  }

  test("retains explicit stale/failure flags and does not call undated quota fresh", async () => {
    for (const data of [snapshot({ stale: true }), snapshot({ refresh_failure: "authentication_failed" }), snapshot({ fetched_at: "invalid" }), snapshot({ fetched_at: "" })]) {
      const out = await setup({ dependencies: { peek: async () => data } }).call();
      expect(out.details.snapshot.stale).toBe(true);
    }
  });

  test("bounds refresh waiting without claiming that shared work was aborted", async () => {
    const pending = deferred<ProviderUsageSnapshot | null>();
    const { call } = setup({ dependencies: { warm: () => pending.promise, peek: async () => snapshot(), refreshWaitMs: 5 } });
    const out = await call({ refresh: true });
    expect(out.details.refresh_wait).toBe("timed_out");
    expect(out.details.cache_wait).toBe("completed");
    expect(out.content[0].text).toContain("shared warmer has no abort support");
    expect(out.content[0].text).toContain("does not force a network fetch");
    expect(out.content[0].text).not.toContain("fetch terminated");
    pending.resolve(null);
    await Bun.sleep(0);
  });

  for (const refresh of [false, true]) {
    test(`pre-aborted signal starts neither auth/cache peek nor warmer (refresh=${refresh})`, async () => {
      const controller = new AbortController();
      const peek = mock(async () => snapshot());
      const warm = mock(async () => snapshot());
      const { call } = setup({ dependencies: { peek, warm } });
      controller.abort(new Error("private cancellation reason"));
      const out = await call({ refresh }, undefined, controller.signal);
      expect(out.details.reason).toBe("cancelled");
      expect(out.details.refresh_started).toBe(false);
      expect(out.content[0].text).toContain("No shared warmer was started");
      expect(peek).not.toHaveBeenCalled();
      expect(warm).not.toHaveBeenCalled();
      expect(JSON.stringify(out)).not.toContain("private cancellation reason");
    });
  }

  test("cancellation during refresh stops waiting and starts no subsequent cache/auth lookup", async () => {
    const pending = deferred<ProviderUsageSnapshot | null>();
    const started = deferred<void>();
    const controller = new AbortController();
    const peek = mock(async () => snapshot());
    const { call } = setup({ dependencies: { warm: () => { started.resolve(); return pending.promise; }, peek } });
    const running = call({ refresh: true }, undefined, controller.signal);
    await started.promise;
    controller.abort();
    const out = await running;
    expect(out.details).toMatchObject({ reason: "cancelled", refresh_wait: "cancelled", cache_wait: "not_requested", refresh_started: true });
    expect(out.content[0].text).toContain("already-started work may continue");
    expect(peek).not.toHaveBeenCalled();
    pending.resolve(null);
    await Bun.sleep(0);
  });

  test("cancellation between completed warmer and peek starts no peek", async () => {
    const controller = new AbortController();
    const peek = mock(async () => snapshot());
    const { call } = setup({ dependencies: { warm: async () => { controller.abort(); return snapshot(); }, peek } });
    expect((await call({ refresh: true }, undefined, controller.signal)).details.reason).toBe("cancelled");
    expect(peek).not.toHaveBeenCalled();
  });

  test("bounds the actual credential-bound peek's authentication wait", async () => {
    const auth = deferred<any>();
    const fixtureRuntime = authRuntime({});
    fixtureRuntime.getAuth = () => auth.promise;
    const { call } = setup({ modelRuntime: fixtureRuntime, dependencies: { cacheWaitMs: 5 } });
    const out = await call({ provider: "openrouter" });
    expect(out.details).toMatchObject({ reason: "cache_wait_timed_out", refresh_wait: "not_requested", cache_wait: "timed_out" });
    expect(out.content[0].text).toContain("No unverified cached quota is returned");
    expect(out.details.snapshot).toBeUndefined();
    expect(apiCalls).toBe(0);
    auth.resolve(undefined);
    await Bun.sleep(0);
  });

  test("bounds authentication inside the actual shared warmer", async () => {
    const auth = deferred<any>();
    const fixtureRuntime = authRuntime({});
    fixtureRuntime.getAuth = () => auth.promise;
    const { call } = setup({ modelRuntime: fixtureRuntime, dependencies: { refreshWaitMs: 5, cacheWaitMs: 5 } });
    const out = await call({ provider: "openrouter", refresh: true });
    expect(out.details).toMatchObject({ refresh_wait: "timed_out", cache_wait: "timed_out", reason: "cache_wait_timed_out" });
    expect(apiCalls).toBe(0);
    auth.resolve(undefined);
    await Bun.sleep(0);
  });

  test("cancellation during actual cache authentication is bounded and returns no quota", async () => {
    const auth = deferred<any>();
    const started = deferred<void>();
    const fixtureRuntime = authRuntime({});
    fixtureRuntime.getAuth = () => { started.resolve(); return auth.promise; };
    const controller = new AbortController();
    const { call } = setup({ modelRuntime: fixtureRuntime });
    const running = call({ provider: "openrouter" }, undefined, controller.signal);
    await started.promise;
    controller.abort();
    const out = await running;
    expect(out.details).toMatchObject({ reason: "cancelled", cache_wait: "cancelled" });
    expect(out.details.snapshot).toBeUndefined();
    expect(apiCalls).toBe(0);
    auth.resolve(undefined);
    await Bun.sleep(0);
  });

  test("cancellation at completed peek does not publish the returned account data", async () => {
    const controller = new AbortController();
    const { call } = setup({ dependencies: { peek: async () => { controller.abort(); return snapshot(); } } });
    const out = await call({}, undefined, controller.signal);
    expect(out.details.reason).toBe("cancelled");
    expect(out.details.snapshot).toBeUndefined();
  });

  test("prints both windows, zero values, nulls, units, flags and refresh metadata", async () => {
    const data = snapshot({
      plan: null, credits_remaining: 0, credits_unlimited: true,
      primary: { label: "premium", used_percent: 0, remaining_percent: 100, window_minutes: null, resets_at: null, reset_description: null },
      secondary: { label: "chat", used_percent: null, remaining_percent: 0, window_minutes: 0, resets_at: "2026-10-07T00:00:00Z", reset_description: "resets in ~1d" },
    });
    const out = await setup({ dependencies: { peek: async () => data } }).call();
    const text = out.content[0].text;
    for (const line of ["Plan: not reported", "Primary window (premium)", "Used: 0%", "Remaining: 100%", "Duration: not reported", "Reset: not reported", "Secondary window (chat)", "Used: not reported", "Remaining: 0%", "Duration: 0 minutes", "Reset: 2026-10-07T00:00:00Z (resets in ~1d)", "Credits remaining: 0 (credit units, not USD)", "Credits unlimited: yes", "Last refresh failure: not reported", "Refresh requested: no", "Shared warmer started: no", "Refresh wait: not_requested", "Credential-bound cache wait: completed"]) expect(text).toContain(line);
    expect(out.details.snapshot.credits_remaining).toBe(0);
  });

  test("OpenRouter no-key-cap does not invent remaining dollars or unlimited account credits", async () => {
    for (const remaining of [null, 0, 8.75]) {
      const data = snapshot({ provider: "openrouter", credits_remaining: null, credits_unlimited: false, key_limit_usd: null, key_limit_configured: false, key_limit_unlimited: true, key_limit_remaining_usd: remaining });
      const out = await setup({ dependencies: { peek: async () => data } }).call({ provider: "openrouter" });
      expect(out.content[0].text).toContain("Key limit: no key cap (not unlimited account credits)");
      expect(out.content[0].text).toContain(`Key limit remaining: ${remaining === null ? "not reported" : remaining === 0 ? "$0.00" : "$8.75"}`);
      expect(out.content[0].text).toContain("Credits remaining: not reported");
      expect(out.content[0].text).toContain("Credits unlimited: no");
      expect(out.content[0].text).not.toContain("remaining: unlimited");
      expect(out.details.snapshot.key_limit_remaining_usd).toBe(remaining);
    }
  });

  test("OpenRouter displays USD amounts, tri-state flags and reset policy distinctly from absolute window resets", async () => {
    const data = snapshot({ provider: "openrouter", key_usage_usd: 0, key_limit_usd: 10, key_limit_remaining_usd: 0, key_limit_configured: true, key_limit_reset: "monthly", key_usage_daily_usd: 0, key_usage_weekly_usd: null, key_usage_monthly_usd: 1.25, is_free_tier: false, include_byok_in_limit: true });
    const text = (await setup({ dependencies: { peek: async () => data } }).call({ provider: "openrouter" })).content[0].text;
    for (const line of ["Key usage: $0.00", "Key limit: $10.00", "Key limit remaining: $0.00", "Key limit configured: yes", "No key cap: no", "Daily / weekly / monthly usage: $0.00 / not reported / $1.25", "Key limit reset policy (not a window reset timestamp): monthly", "Reset: 2026-03-01T17:00:00.000Z (resets in ~5h)", "Free tier: no", "BYOK included in limit: yes"]) expect(text).toContain(line);
    const unknown = (await setup({ dependencies: { peek: async () => snapshot({ provider: "openrouter", primary: null, hint_short: "" }) } }).call({ provider: "openrouter" })).content[0].text;
    for (const line of ["Key limit: not reported", "Key limit configured: not reported", "Free tier: not reported", "BYOK included in limit: not reported", "Summary: not reported"]) expect(unknown).toContain(line);
  });

  for (const availability of ["available", "authentication_required", "authentication_failed", "temporary_failure", "malformed_response"] as const) {
    test(`reports availability ${availability} in both text and structured details`, async () => {
      const out = await setup({ dependencies: { peek: async () => snapshot({ availability }) } }).call();
      expect(out.details.ok).toBe(availability === "available");
      expect(out.details.snapshot.availability).toBe(availability);
      expect(out.content[0].text).toContain(`Availability: ${availability}`);
    });
  }

  for (const operation of ["warm", "peek"] as const) {
    for (const synchronous of [false, true]) {
      test(`${operation} ${synchronous ? "throw" : "rejection"} is classified and safely logged without leaking credentials`, async () => {
        const secret = "secret-token-value";
        const failure = () => {
          const error = new Error(secret, { cause: { apiKey: secret } });
          if (synchronous) throw error;
          return Promise.reject(error);
        };
        const { call } = setup({ dependencies: { peek: async () => snapshot(), warm: async () => null, [operation]: failure } });
        const out = await call({ refresh: operation === "warm" });
        expect(operation === "warm" ? out.details.refresh_wait : out.details.reason).toBe(operation === "warm" ? "failed" : "auth_or_cache_error");
        expect(logs).toHaveLength(1);
        expect(logs[0]).toMatchObject({ operation: operation === "warm" ? "refresh" : "cache", after_wait: false });
        expect(JSON.stringify({ out, logs })).not.toContain(secret);
      });
    }
  }

  for (const operation of ["warm", "peek"] as const) {
    test(`late ${operation} rejection after timeout is handled and safely logged, not silently swallowed`, async () => {
      const pending = deferred<ProviderUsageSnapshot | null>();
      const { call } = setup({ dependencies: { peek: async () => snapshot(), warm: async () => null, [operation]: () => pending.promise, refreshWaitMs: 5, cacheWaitMs: 5 } });
      const out = await call({ refresh: operation === "warm" });
      expect(operation === "warm" ? out.details.refresh_wait : out.details.cache_wait).toBe("timed_out");
      pending.reject(new Error("late-secret"));
      await Bun.sleep(0);
      expect(logs).toHaveLength(1);
      expect(logs[0].after_wait).toBe(true);
      expect(JSON.stringify({ out, logs })).not.toContain("late-secret");
    });
  }

  test("late warmer rejection after cancellation is safely handled", async () => {
    const pending = deferred<ProviderUsageSnapshot | null>();
    const controller = new AbortController();
    const { call } = setup({ dependencies: { warm: () => pending.promise } });
    const running = call({ refresh: true }, undefined, controller.signal);
    controller.abort();
    const out = await running;
    pending.reject(new Error("cancelled-secret"));
    await Bun.sleep(0);
    expect(out.details.reason).toBe("cancelled");
    expect(logs).toHaveLength(1);
    expect(logs[0].after_wait).toBe(true);
    expect(JSON.stringify({ out, logs })).not.toContain("cancelled-secret");
  });

  test("existing credential-bound peek denies another OpenRouter key, credential removal and changes", async () => {
    const firstCredentials = { openrouter: { type: "api_key", key: "mock-first-key" } };
    const first = authRuntime(firstCredentials);
    const second = authRuntime({ openrouter: { type: "api_key", key: "mock-second-key" } });
    const noCredential = authRuntime({});
    const fetchMock = mock(async () => new Response(JSON.stringify({ data: { usage: 1.25, limit: 10, limit_remaining: 8.75 } })));
    globalThis.fetch = fetchMock as any;
    await warmProviderUsage(first, "openrouter");
    const firstCall = setup({ modelRuntime: first }).call;
    const secondCall = setup({ modelRuntime: second }).call;
    expect((await firstCall({ provider: "openrouter" })).details.snapshot.key_usage_usd).toBe(1.25);
    expect((await secondCall({ provider: "openrouter" })).details.reason).toBe("no_cached_data");
    expect((await setup({ modelRuntime: noCredential }).call({ provider: "openrouter" })).details.reason).toBe("no_cached_data");
    firstCredentials.openrouter.key = "mock-changed-key";
    expect((await firstCall({ provider: "openrouter" })).details.reason).toBe("no_cached_data");
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  test("existing account-bound Codex peek denies another stored account even with the same access token", async () => {
    const first = authRuntime({ "openai-codex": { type: "oauth", access: "mock-same-token", accountId: "mock-first-account", expires: Date.now() + 60_000 } });
    const second = authRuntime({ "openai-codex": { type: "oauth", access: "mock-same-token", accountId: "mock-second-account", expires: Date.now() + 60_000 } });
    const fetchMock = mock(async () => new Response(JSON.stringify({ plan_type: "pro", rate_limit: { primary_window: { used_percent: 10 } }, credits: { balance: 5 } })));
    globalThis.fetch = fetchMock as any;
    await warmProviderUsage(first, "openai-codex");
    expect((await setup({ modelRuntime: first }).call()).details.snapshot.primary.used_percent).toBe(10);
    expect((await setup({ modelRuntime: second }).call()).details.reason).toBe("no_cached_data");
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  test("actual warmer reuses fresh cache (refresh=true is not a forced provider fetch) and aged peek is marked stale", async () => {
    const fixtureRuntime = authRuntime({ openrouter: { type: "api_key", key: "mock-key" } });
    const fetchMock = mock(async () => new Response(JSON.stringify({ data: { usage: 0, limit: null, limit_remaining: null, limit_reset: "daily" } })));
    globalThis.fetch = fetchMock as any;
    const warmed = await warmProviderUsage(fixtureRuntime, "openrouter");
    const { call } = setup({ modelRuntime: fixtureRuntime });
    const refreshed = await call({ provider: "openrouter", refresh: true });
    expect(refreshed.details.refresh_wait).toBe("completed");
    expect(refreshed.details.snapshot.key_limit_remaining_usd).toBeNull();
    expect(refreshed.content[0].text).toContain("does not force a network fetch");
    expect(fetchMock).toHaveBeenCalledTimes(1);
    Date.now = () => Date.parse(warmed!.fetched_at) + 60_001;
    const raw = await peekProviderUsageForRuntime(fixtureRuntime, "openrouter", { allowStale: true });
    expect(raw?.stale).toBe(false); // Existing shared contract returns the original flag, not age.
    const aged = await call({ provider: "openrouter" });
    expect(aged.details.snapshot.stale).toBe(true);
    expect(raw?.stale).toBe(false);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  test("credential change during shared refresh cannot publish the previous account's response", async () => {
    const credentials = { openrouter: { type: "api_key", key: "mock-before-key" } };
    const fixtureRuntime = authRuntime(credentials);
    const response = deferred<Response>();
    const started = deferred<void>();
    const fetchMock = mock(() => { started.resolve(); return response.promise; });
    globalThis.fetch = fetchMock as any;
    const running = setup({ modelRuntime: fixtureRuntime }).call({ provider: "openrouter", refresh: true });
    await started.promise;
    credentials.openrouter.key = "mock-after-key";
    response.resolve(new Response(JSON.stringify({ data: { usage: 99, limit: 100 } })));
    const out = await running;
    expect(out.details.reason).toBe("no_data_after_refresh");
    expect(out.details.snapshot).toBeUndefined();
    expect(out.content[0].text).not.toContain("99");
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});
