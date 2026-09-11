import { beforeEach, describe, expect, test } from "bun:test";
import "../helpers.js";
import { isolateBudgetTestDatabase } from "./fixture.js";
isolateBudgetTestDatabase();

import { getBudgetSettingsState } from "../../src/budget/settings.js";
import {
  ensureBudgetWork,
  getDb,
  initDatabase,
  saveBudgetCap,
  storeTokenUsage,
} from "../../src/db.js";

function knownUsage(workId: string, chatJid: string, at: string, micros: number) {
  storeTokenUsage({
    chat_jid: chatJid, run_at: at, input_tokens: 1, output_tokens: 0, cache_read_tokens: 0, cache_write_tokens: 0,
    total_tokens: 1, cost_input: micros / 1_000_000, cost_output: 0, cost_cache_read: 0, cost_cache_write: 0,
    cost_total: micros / 1_000_000, catalogue_cost_total: micros / 1_000_000, work_id: workId,
    invocation_id: `invocation:${micros}`, usage_event_id: `usage:${micros}`, api_equivalent_cost_microusd: micros,
    api_equivalent_cost_known: true, valuation_provenance: "catalogue_estimate", execution_kind: "interactive",
  });
}

describe("budget settings projection", () => {
  beforeEach(() => initDatabase());

  test("projects uncapped state without provider calls or mutations", () => {
    const state = getBudgetSettingsState("web:uncapped", getDb(), new Date("2026-09-09T12:00:00Z"));
    expect(state).toMatchObject({ message: "No limits configured.", caps: [], work: null, decision: null, enforcement: "best_effort_boundaries" });
    expect(JSON.stringify(state)).not.toContain("account_ref");
  });

  test("projects daily spend, persisted window and remaining value", () => {
    const now = new Date("2026-09-09T12:00:00Z");
    ensureBudgetWork({ id: "settings:daily", chatJid: "web:daily", executionKind: "interactive" });
    knownUsage("settings:daily", "web:daily", now.toISOString(), 250_000);
    saveBudgetCap({ id: "cap:daily", scope: "instance_daily", metric: "api_usd_micros", amount: 1_000_000, timezone: "UTC" }, getDb(), now);
    const state = getBudgetSettingsState("web:daily", getDb(), now) as any;
    expect(state.caps[0]).toMatchObject({ id: "cap:daily", known_usage: 250_000, remaining: 750_000, unknown_events: 0 });
    expect(state.caps[0].window).toMatchObject({ id: "daily:UTC:2026-09-09", starts_at: "2026-09-09T00:00:00.000Z", ends_at: "2026-09-10T00:00:00.000Z" });
  });

  test("persists immutable cap revision history across updates and disablement", () => {
    const now = new Date("2026-09-09T12:00:00Z");
    saveBudgetCap({ id: "cap:history", scope: "instance_daily", metric: "api_usd_micros", amount: 1_000_000, timezone: "UTC" }, getDb(), now);
    saveBudgetCap({ id: "cap:history", scope: "instance_daily", metric: "api_usd_micros", amount: 2_000_000, timezone: "UTC", enabled: false }, getDb(), new Date("2026-09-09T12:01:00Z"));
    expect(getDb().prepare("SELECT revision,amount,enabled FROM budget_cap_revisions WHERE cap_id=? ORDER BY revision").all("cap:history"))
      .toEqual([{ revision: 1, amount: 1_000_000, enabled: 1 }, { revision: 2, amount: 2_000_000, enabled: 0 }]);
    expect(() => getDb().prepare("DELETE FROM budget_cap_revisions WHERE cap_id=?").run("cap:history")).toThrow("immutable");
  });

  test("reads disabled calendar caps without creating a new window", () => {
    const now = new Date("2026-09-09T12:00:00Z");
    saveBudgetCap({ id: "cap:disabled", scope: "instance_daily", metric: "api_usd_micros", amount: 1_000_000, timezone: "UTC", enabled: false }, getDb(), now);
    const before = (getDb().prepare("SELECT COUNT(*) AS count FROM budget_cap_windows WHERE cap_id=?").get("cap:disabled") as any).count;
    const state = getBudgetSettingsState("web:disabled", getDb(), now) as any;
    expect(state.caps[0]).toMatchObject({ enabled: false, known_usage: null, remaining: null, window: null });
    expect((getDb().prepare("SELECT COUNT(*) AS count FROM budget_cap_windows WHERE cap_id=?").get("cap:disabled") as any).count).toBe(before);
  });

  test("redacts provider account references while reporting stale evidence", () => {
    const now = new Date("2026-09-09T12:00:00Z");
    ensureBudgetWork({ id: "settings:provider", chatJid: "web:provider", executionKind: "interactive" });
    saveBudgetCap({ id: "cap:provider", scope: "provider_window", metric: "provider_percent_used_micros", amount: 80_000_000, providerId: "zai", quotaDimension: "primary.percent_used", accountRef: "zai:secret-fingerprint" }, getDb(), now);
    const insertEvidence = getDb().prepare(`INSERT INTO budget_provider_evidence (evidence_id,provider_id,account_ref,quota_dimension,unit,used_micros,remaining_micros,limit_micros,window_id,resets_at,fetched_at,stale,availability,source)
      VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)`);
    insertEvidence.run("evidence:stale", "zai", "zai:secret-fingerprint", "primary.percent_used", "percent_micros", 60_000_000, null, null, "zai:window", "2026-09-09T13:00:00Z", "2026-09-09T11:00:00Z", 0, "available", "test");
    insertEvidence.run("evidence:foreign", "zai", "zai:foreign-account", "primary.percent_used", "percent_micros", 99_000_000, null, null, "zai:foreign", "2026-09-09T13:00:00Z", "2026-09-09T11:59:59Z", 0, "available", "test");
    const state = getBudgetSettingsState("web:provider", getDb(), now) as any;
    expect(state.caps[0].evidence).toMatchObject({ stale: true, availability: "available", value_micros: 60_000_000 });
    expect(JSON.stringify(state)).not.toContain("secret-fingerprint");
    expect(JSON.stringify(state)).not.toContain("foreign-account");
  });
});
