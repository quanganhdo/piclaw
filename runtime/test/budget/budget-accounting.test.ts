import { describe, expect, test } from "bun:test";
import "../helpers.js";
import { isolateBudgetTestDatabase } from './fixture.js';
isolateBudgetTestDatabase();

import { withBudgetWorkContext } from "../../src/budget/context.js";
import { valueApiEquivalentCost } from "../../src/budget/valuation.js";
import { recordMessageUsage, recordSessionEventUsage } from "../../src/agent-pool/usage.js";
import { ensureBudgetWork, getBudgetWork, initDatabase } from "../../src/db.js";
import { getDb } from "../../src/db/connection.js";

describe("budget accounting foundation", () => {
  test("initialises additive budget tables with no configured caps", () => {
    initDatabase();
    const db = getDb();
    const tables = db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name LIKE 'budget_%' ORDER BY name").all() as Array<{ name: string }>;
    expect(tables.map((row) => row.name)).toEqual([
      "budget_allowances",
      "budget_cap_windows",
      "budget_caps",
      "budget_decisions",
      "budget_overrides",
      "budget_provider_evidence",
      "budget_usage_events",
      "budget_work",
    ]);
    expect((db.prepare("SELECT COUNT(*) AS count FROM budget_caps").get() as { count: number }).count).toBe(0);
  });

  test("attributes one immutable usage event to a durable work id and ignores replay", () => {
    initDatabase();
    const db = getDb();
    const workId = "work:budget-accounting-replay";
    ensureBudgetWork({ id: workId, chatJid: "web:budget-accounting", executionKind: "interactive" });

    const message = {
      id: "provider-message-42",
      role: "assistant",
      timestamp: "2026-09-07T12:00:00Z",
      model: "priced-model",
      provider: "test-provider",
      usage: {
        input: 100,
        output: 20,
        cacheRead: 10,
        cacheWrite: 0,
        totalTokens: 130,
        cost: { input: 0.001, output: 0.002, cacheRead: 0.0001, cacheWrite: 0, total: 0.0031 },
      },
    };
    withBudgetWorkContext({ workId, chatJid: "web:budget-accounting", kind: "interactive" }, () => {
      recordMessageUsage("web:budget-accounting", message);
      recordMessageUsage("web:budget-accounting", message);
    });

    const tokenRows = db.prepare("SELECT * FROM token_usage WHERE work_id=?").all(workId) as Array<Record<string, unknown>>;
    const events = db.prepare("SELECT * FROM budget_usage_events WHERE work_id=?").all(workId) as Array<Record<string, unknown>>;
    expect(tokenRows).toHaveLength(1);
    expect(events).toHaveLength(1);
    expect(tokenRows[0]?.invocation_id).toBe("provider-message-42");
    expect(tokenRows[0]?.usage_event_id).toBe("usage:assistant:event:provider-message-42");
    expect(tokenRows[0]?.api_equivalent_cost_microusd).toBe(3100);
    expect(tokenRows[0]?.api_equivalent_cost_known).toBe(1);
    expect(events[0]?.valuation_provenance).toBe("catalogue_estimate");
  });

  test("deduplicates compaction and branch-summary callbacks by durable entry id", () => {
    initDatabase();
    const db = getDb();
    const workId = "work:budget-accounting-summaries";
    ensureBudgetWork({ id: workId, chatJid: "web:budget-summaries", executionKind: "interactive" });
    const compaction = {
      type: "session_compact",
      compactionEntry: { id: "compact-1", timestamp: 123, usage: { input: 5, output: 2, cost: { total: 0.001 } } },
    };
    const summary = {
      type: "session_tree",
      summaryEntry: { id: "summary-1", type: "branch_summary", timestamp: 124, usage: { input: 4, output: 1, cost: { total: 0.0005 } } },
    };
    withBudgetWorkContext({ workId, chatJid: "web:budget-summaries", kind: "interactive" }, () => {
      recordSessionEventUsage("web:budget-summaries", compaction);
      recordSessionEventUsage("web:budget-summaries", compaction);
      recordSessionEventUsage("web:budget-summaries", summary);
      recordSessionEventUsage("web:budget-summaries", summary);
    });
    const rows = db.prepare("SELECT usage_source FROM token_usage WHERE work_id=? ORDER BY usage_source").all(workId) as Array<{ usage_source: string }>;
    expect(rows.map((row) => row.usage_source)).toEqual(["branch_summary", "compaction"]);
  });

  test("deduplicates one invocation reported by child and parent chats", () => {
    initDatabase();
    const db = getDb();
    ensureBudgetWork({ id: "work:parent-report", chatJid: "web:parent", executionKind: "interactive" });
    ensureBudgetWork({
      id: "work:child-report",
      chatJid: "web:parent:child",
      executionKind: "delegate",
      parentWorkId: "work:parent-report",
    });
    const usage = {
      invocationId: "provider-invocation-99",
      input: 100,
      output: 10,
      cacheRead: 0,
      cacheWrite: 0,
      totalTokens: 110,
      cost: { input: 0.001, output: 0.001, cacheRead: 0, cacheWrite: 0, total: 0.002 },
    };

    withBudgetWorkContext({ workId: "work:child-report", chatJid: "web:parent:child", kind: "delegate", parentWorkId: "work:parent-report" }, () => {
      recordMessageUsage("web:parent:child", { id: "child-message", role: "assistant", usage });
    });
    withBudgetWorkContext({ workId: "work:parent-report", chatJid: "web:parent", kind: "interactive" }, () => {
      recordMessageUsage("web:parent", { id: "parent-replay", role: "assistant", usage });
    });

    expect(db.prepare("SELECT COUNT(*) AS count FROM token_usage WHERE usage_event_id=?")
      .get("usage:invocation:provider-invocation-99")).toEqual({ count: 1 });
    expect(db.prepare("SELECT work_id,chat_jid FROM budget_usage_events WHERE usage_event_id=?")
      .get("usage:invocation:provider-invocation-99")).toEqual({
      work_id: "work:child-report",
      chat_jid: "web:parent:child",
    });
  });

  test("rejects reuse of a work id with different ownership", () => {
    initDatabase();
    ensureBudgetWork({ id: "work:identity-conflict", chatJid: "web:first", executionKind: "interactive" });
    expect(() => ensureBudgetWork({ id: "work:identity-conflict", chatJid: "web:second", executionKind: "interactive" }))
      .toThrow("Budget work identity conflict");
    expect(getBudgetWork("work:identity-conflict")?.chat_jid).toBe("web:first");
  });

  test("distinguishes unknown zero from documented free valuation", () => {
    const tokens = { input: 10, output: 2, cacheRead: 0, cacheWrite: 0 };
    expect(valueApiEquivalentCost({ tokens, costs: { input: 0, output: 0, total: 0 } })).toMatchObject({
      known: false,
      amountMicros: null,
      provenance: "unavailable",
    });
    expect(valueApiEquivalentCost({ tokens, costs: { input: 0, output: 0, total: 0 }, documentedFree: true })).toMatchObject({
      known: true,
      amountMicros: 0,
      provenance: "documented_free",
    });
  });

  test("values categories independently, excludes reasoning, and labels cache fallback", () => {
    expect(valueApiEquivalentCost({
      tokens: { input: 10, output: 0, cacheRead: 0, cacheWrite: 5, reasoning: 99 },
      costs: { input: 0.001, output: null, cacheRead: null, cacheWrite: null, total: 999 },
      cacheWriteInputFallback: 0.0005,
    })).toMatchObject({
      known: true,
      amountMicros: 1500,
      knownSubtotalMicros: 1500,
      fallbackCategories: ["cacheWrite"],
      unknownCategories: [],
    });
    expect(valueApiEquivalentCost({
      tokens: { input: 10, output: 2, cacheRead: 0, cacheWrite: 0 },
      costs: { input: 0.001, output: null },
    })).toMatchObject({
      known: false,
      amountMicros: null,
      knownSubtotalMicros: 1000,
      unknownCategories: ["output"],
    });
  });
});
