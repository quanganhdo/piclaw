import { describe, expect, test } from "bun:test";
import "../helpers.js";
import { isolateBudgetTestDatabase } from './fixture.js';
isolateBudgetTestDatabase();

import { resolveCalendarWindow } from "../../src/budget/calendar.js";
import { evaluateBudget } from "../../src/budget/evaluator.js";
import { providerSnapshotToEvidence } from "../../src/budget/provider-evidence.js";
import type { BudgetProviderEvidence } from "../../src/budget/types.js";
import {
  ensureBudgetWork,
  grantBudgetAllowance,
  initDatabase,
  saveBudgetCap,
  setBudgetWarningsOnly,
  setBudgetWorkStatus,
  storeTokenUsage,
} from "../../src/db.js";
import { getDb } from "../../src/db/connection.js";

function storeKnownUsage(workId: string, chatJid: string, eventId: string, at: string, micros: number): void {
  storeTokenUsage({
    chat_jid: chatJid,
    run_at: at,
    input_tokens: 1,
    output_tokens: 0,
    cache_read_tokens: 0,
    cache_write_tokens: 0,
    total_tokens: 1,
    cost_input: micros / 1_000_000,
    cost_output: 0,
    cost_cache_read: 0,
    cost_cache_write: 0,
    cost_total: micros / 1_000_000,
    catalogue_cost_total: micros / 1_000_000,
    work_id: workId,
    invocation_id: eventId,
    usage_event_id: eventId,
    api_equivalent_cost_microusd: micros,
    api_equivalent_cost_known: true,
    valuation_provenance: "catalogue_estimate",
    execution_kind: "interactive",
  });
}

describe("budget policy", () => {
  test("leaves uncapped work allowed even when pricing is unavailable", () => {
    initDatabase();
    ensureBudgetWork({ id: "policy:uncapped", chatJid: "web:uncapped", executionKind: "interactive" });
    storeTokenUsage({
      chat_jid: "web:uncapped", run_at: "2026-09-07T12:00:00.000Z", input_tokens: 10, output_tokens: 1,
      cache_read_tokens: 0, cache_write_tokens: 0, total_tokens: 11,
      cost_input: 0, cost_output: 0, cost_cache_read: 0, cost_cache_write: 0, cost_total: 0,
      work_id: "policy:uncapped", usage_event_id: "uncapped:unknown", api_equivalent_cost_known: false,
      valuation_provenance: "unavailable", execution_kind: "interactive",
    });
    expect(evaluateBudget({ workId: "policy:uncapped", now: new Date("2026-09-07T12:01:00Z") })).toMatchObject({ action: "allow", applicableCapIds: [] });
  });

  test("uses persisted local calendar boundaries across DST", () => {
    const spring = resolveCalendarWindow("daily", "Europe/Lisbon", new Date("2026-03-29T12:00:00Z"));
    const autumn = resolveCalendarWindow("daily", "Europe/Lisbon", new Date("2026-10-25T12:00:00Z"));
    expect(new Date(spring.endsAt).getTime() - new Date(spring.startsAt).getTime()).toBe(23 * 3_600_000);
    expect(new Date(autumn.endsAt).getTime() - new Date(autumn.startsAt).getTime()).toBe(25 * 3_600_000);
    expect(spring.id).toBe("daily:Europe/Lisbon:2026-03-29");
  });

  test("validates cap units and rejects unsupported per-task provider attribution", () => {
    initDatabase();
    expect(() => saveBudgetCap({ scope: "task", metric: "provider_percent_used_micros", amount: 50_000_000, workId: "x" }))
      .toThrow("unsupported for task");
    expect(() => saveBudgetCap({ scope: "provider_window", metric: "provider_percent_used_micros", amount: 50_000_000, providerId: "openrouter", quotaDimension: "primary.percent_used", accountRef: "acct" }))
      .toThrow("does not support quota dimension");
    expect(() => saveBudgetCap({ scope: "instance_daily", metric: "api_usd_micros", amount: -1, timezone: "UTC" }))
      .toThrow("non-negative integer");
  });

  test("includes current-window legacy spend on first cap activation without rewriting it", () => {
    initDatabase();
    const db = getDb();
    storeTokenUsage({
      chat_jid: "web:legacy-window", run_at: "2026-09-08T09:00:00Z", input_tokens: 10, output_tokens: 0,
      cache_read_tokens: 0, cache_write_tokens: 0, total_tokens: 10,
      cost_input: 0.75, cost_output: 0, cost_cache_read: 0, cost_cache_write: 0, cost_total: 0.75,
      catalogue_cost_total: 0.75,
    });
    const before = db.prepare("SELECT * FROM token_usage WHERE chat_jid='web:legacy-window'").get() as Record<string, unknown>;
    ensureBudgetWork({ id: "policy:legacy-window", chatJid: "web:legacy-window", executionKind: "interactive" });
    saveBudgetCap({ id: "cap:legacy-window", scope: "instance_daily", metric: "api_usd_micros", amount: 500_000, timezone: "UTC" }, db, new Date("2026-09-08T10:00:00Z"));
    const decision = evaluateBudget({ workId: "policy:legacy-window", now: new Date("2026-09-08T10:00:00Z") }, db);
    expect(decision.blockers[0]).toMatchObject({ capId: "cap:legacy-window", reason: "exhausted", knownUsage: 750_000, remaining: -250_000 });
    expect(db.prepare("SELECT * FROM token_usage WHERE chat_jid='web:legacy-window'").get()).toEqual(before);
  });

  test("returns every independent blocker and does not demand unrelated provider evidence", () => {
    initDatabase();
    const now = new Date("2026-09-09T12:00:00Z");
    ensureBudgetWork({ id: "policy:multiple", chatJid: "web:multiple", executionKind: "interactive" });
    storeKnownUsage("policy:multiple", "web:multiple", "multi:1", now.toISOString(), 120);
    saveBudgetCap({ id: "cap:task", scope: "task", metric: "api_usd_micros", amount: 100, workId: "policy:multiple" }, getDb(), now);
    saveBudgetCap({ id: "cap:day", scope: "instance_daily", metric: "api_usd_micros", amount: 110, timezone: "UTC" }, getDb(), now);
    const decision = evaluateBudget({ workId: "policy:multiple", now });
    expect(decision.action).toBe("pause");
    expect(decision.blockers.map((item) => item.capId).sort()).toEqual(["cap:day", "cap:task"]);
  });

  test("retains concurrent overshoot and blocks at the next boundary without reservations", () => {
    initDatabase();
    const now = new Date("2026-09-09T13:00:00Z");
    ensureBudgetWork({ id: "policy:concurrent", chatJid: "web:concurrent", executionKind: "interactive" });
    saveBudgetCap({ id: "cap:concurrent", scope: "task", metric: "api_usd_micros", amount: 100, workId: "policy:concurrent" }, getDb(), now);
    expect(evaluateBudget({ workId: "policy:concurrent", now }).action).toBe("allow");
    expect(evaluateBudget({ workId: "policy:concurrent", now }).action).toBe("allow");
    storeKnownUsage("policy:concurrent", "web:concurrent", "concurrent:one", now.toISOString(), 80);
    storeKnownUsage("policy:concurrent", "web:concurrent", "concurrent:two", now.toISOString(), 80);
    const after = evaluateBudget({ workId: "policy:concurrent", now });
    expect(after.blockers[0]).toMatchObject({ knownUsage: 160, remaining: -60, reason: "exhausted" });
    expect(getDb().prepare("SELECT COUNT(*) AS count FROM budget_usage_events WHERE work_id=?").get("policy:concurrent"))
      .toEqual({ count: 2 });
  });

  test("numeric allowances are work/window bounded and cannot hide unknown pricing", () => {
    initDatabase();
    const now = new Date("2026-09-12T12:00:00Z");
    ensureBudgetWork({ id: "policy:allowance", chatJid: "web:allowance", executionKind: "interactive" });
    storeKnownUsage("policy:allowance", "web:allowance", "allowance:1", now.toISOString(), 120);
    const cap = saveBudgetCap({ id: "cap:allowance", scope: "task", metric: "api_usd_micros", amount: 100, workId: "policy:allowance" }, getDb(), now);
    const blocked = evaluateBudget({ workId: "policy:allowance", now });
    grantBudgetAllowance({
      workId: "policy:allowance", capId: cap.id, capRevision: cap.revision,
      windowId: blocked.blockers[0]!.windowId, amount: 50, expiresAt: "2026-09-12T13:00:00Z", now: now.toISOString(),
    });
    expect(evaluateBudget({ workId: "policy:allowance", now }).action).toBe("allow");

    storeTokenUsage({
      chat_jid: "web:allowance", run_at: now.toISOString(), input_tokens: 1, output_tokens: 0,
      cache_read_tokens: 0, cache_write_tokens: 0, total_tokens: 1,
      cost_input: 0, cost_output: 0, cost_cache_read: 0, cost_cache_write: 0, cost_total: 0,
      work_id: "policy:allowance", usage_event_id: "allowance:unknown", api_equivalent_cost_known: false,
      valuation_provenance: "unavailable", execution_kind: "interactive",
    });
    expect(evaluateBudget({ workId: "policy:allowance", now }).blockers[0]?.reason).toBe("unknown_pricing");
  });

  test("warnings-only is scoped to owning work and descendants and closes with the work", () => {
    initDatabase();
    const now = new Date("2026-09-10T12:00:00Z");
    ensureBudgetWork({ id: "policy:override", chatJid: "web:override", executionKind: "interactive" });
    ensureBudgetWork({ id: "policy:override-child", chatJid: "web:override", executionKind: "delegate", parentWorkId: "policy:override" });
    ensureBudgetWork({ id: "policy:unrelated", chatJid: "web:unrelated", executionKind: "interactive" });
    saveBudgetCap({ id: "cap:shared-zero", scope: "instance_daily", metric: "api_usd_micros", amount: 0, timezone: "UTC" }, getDb(), now);
    setBudgetWarningsOnly({ workId: "policy:override", chatJid: "web:override", expiresAt: "2026-09-10T13:00:00Z", now: now.toISOString() });
    expect(evaluateBudget({ workId: "policy:override-child", now }).action).toBe("warn");
    expect(evaluateBudget({ workId: "policy:unrelated", now }).action).toBe("pause");
    setBudgetWorkStatus("policy:override", "completed", { now: now.toISOString() });
    expect(evaluateBudget({ workId: "policy:override-child", now }).action).toBe("pause");
  });

  test("scheduled runs have fresh run spend while sharing instance spend", () => {
    initDatabase();
    const now = new Date("2026-09-11T12:00:00Z");
    ensureBudgetWork({ id: "scheduled:one", chatJid: "web:default", executionKind: "scheduled", scheduledTaskId: "task-1" });
    ensureBudgetWork({ id: "scheduled:two", chatJid: "web:default", executionKind: "scheduled", scheduledTaskId: "task-1" });
    storeKnownUsage("scheduled:one", "web:default", "scheduled:usage:one", now.toISOString(), 90);
    saveBudgetCap({ id: "cap:scheduled", scope: "scheduled_run", metric: "api_usd_micros", amount: 100, scheduledTaskId: "task-1" }, getDb(), now);
    saveBudgetCap({ id: "cap:scheduled-shared", scope: "instance_daily", metric: "api_usd_micros", amount: 80, timezone: "UTC" }, getDb(), now);
    const second = evaluateBudget({ workId: "scheduled:two", now });
    expect(second.action).toBe("stop");
    expect(second.blockers.map((item) => item.capId)).toEqual(["cap:scheduled-shared"]);
  });

  test("evaluates quota-only caps without pricing and rejects stale, mismatched or expired evidence", () => {
    initDatabase();
    const now = new Date("2026-09-07T12:00:00Z");
    ensureBudgetWork({ id: "policy:quota", chatJid: "web:quota", executionKind: "interactive" });
    const cap = saveBudgetCap({
      id: "cap:quota", scope: "provider_window", metric: "provider_percent_used_micros", amount: 80_000_000,
      providerId: "openai-codex", quotaDimension: "primary.percent_used", accountRef: "account:one",
    }, getDb(), now);
    const base: BudgetProviderEvidence = {
      capId: cap.id, providerId: "openai-codex", accountRef: "account:one", quotaDimension: "primary.percent_used",
      windowId: "codex:5h:1", fetchedAt: now.toISOString(), resetsAt: "2026-09-07T13:00:00Z",
      stale: false, availability: "available", valueMicros: 50_000_000, source: "fake",
    };
    expect(evaluateBudget({ workId: "policy:quota", now, providerEvidence: [base] }).action).toBe("allow");
    expect(evaluateBudget({ workId: "policy:quota", now, providerEvidence: [{ ...base, stale: true }] }).blockers[0]?.reason).toBe("stale_provider_evidence");
    expect(evaluateBudget({ workId: "policy:quota", now, providerEvidence: [{ ...base, accountRef: "account:two" }] }).blockers[0]?.reason).toBe("provider_account_mismatch");
    expect(evaluateBudget({ workId: "policy:quota", now, providerEvidence: [{ ...base, resetsAt: "2026-09-07T11:59:00Z" }] }).blockers[0]?.reason).toBe("provider_window_expired");
  });

  test("applies provider caps only to calls routed through that provider", () => {
    initDatabase();
    const now = new Date("2026-09-07T12:00:00Z");
    ensureBudgetWork({ id: "policy:provider-route", chatJid: "web:provider-route", executionKind: "interactive" });
    saveBudgetCap({
      id: "cap:codex-route", scope: "provider_window", metric: "provider_percent_used_micros", amount: 80_000_000,
      providerId: "openai-codex", quotaDimension: "primary.percent_used", accountRef: "codex:account",
    }, getDb(), now);
    expect(evaluateBudget({ workId: "policy:provider-route", providerId: "openrouter", now }).action).toBe("allow");
    expect(evaluateBudget({ workId: "policy:provider-route", providerId: "openai-codex", now }).blockers[0]?.reason)
      .toBe("missing_provider_evidence");
  });

  test("normalises provider snapshots using native windows and freshness", () => {
    initDatabase();
    const now = new Date("2026-09-07T12:00:00Z");
    const cap = saveBudgetCap({
      id: "cap:snapshot", scope: "provider_window", metric: "provider_percent_used_micros", amount: 80_000_000,
      providerId: "zai", quotaDimension: "secondary.percent_used", accountRef: "zai:account",
    }, getDb(), now);
    const evidence = providerSnapshotToEvidence({ cap, accountRef: "zai:account", now, snapshot: {
      provider: "zai", source: "fake-zai", availability: "available", stale: false, refresh_failure: null,
      plan: null, fetched_at: "2026-09-07T11:59:30Z", primary: null,
      secondary: { label: "tools", used_percent: 75, remaining_percent: 25, window_minutes: null, resets_at: "2026-09-08T00:00:00Z", reset_description: null },
      credits_remaining: null, credits_unlimited: false, key_usage_usd: null, key_limit_usd: null,
      key_limit_remaining_usd: null, key_limit_configured: null, key_limit_unlimited: false, key_limit_reset: null,
      key_usage_daily_usd: null, key_usage_weekly_usd: null, key_usage_monthly_usd: null, is_free_tier: null,
      include_byok_in_limit: null, hint_short: "",
    } });
    expect(evidence).toMatchObject({ valueMicros: 75_000_000, stale: false, windowId: "zai:secondary.percent_used:2026-09-08T00:00:00Z" });
  });
});
