import { describe, expect, test } from "bun:test";
import "../helpers.js";
import { isolateBudgetTestDatabase } from './fixture.js';
isolateBudgetTestDatabase();

import { admitBudgetBoundary } from "../../src/budget/admission.js";
import { withBudgetWorkContext } from "../../src/budget/context.js";
import { getBudgetStatus } from "../../src/budget/status.js";
import {
  ensureBudgetWork,
  getBudgetWork,
  initDatabase,
  saveBudgetCap,
  setBudgetWarningsOnly,
  setBudgetWorkStatus,
} from "../../src/db.js";
import { getDb } from "../../src/db/connection.js";
import { createBudgetLimitsExtension } from "../../src/extensions/budget-limits.js";

const runtime = { getAuth: async () => undefined } as any;

describe("budget admission and status", () => {
  test("reports no configured limits without mutating accounting", () => {
    initDatabase();
    const before = (getDb().prepare("SELECT COUNT(*) AS count FROM budget_usage_events").get() as { count: number }).count;
    expect(getBudgetStatus("web:no-limits")).toMatchObject({ message: "No limits configured.", decision: null, caps: [] });
    const after = (getDb().prepare("SELECT COUNT(*) AS count FROM budget_usage_events").get() as { count: number }).count;
    expect(after).toBe(before);
  });

  test("pauses before a model boundary and persists resumable state without an LLM call", async () => {
    initDatabase();
    ensureBudgetWork({ id: "admission:interactive", chatJid: "web:admission", executionKind: "interactive" });
    saveBudgetCap({ id: "cap:admission-zero", scope: "task", metric: "api_usd_micros", amount: 0, workId: "admission:interactive" });
    const result = await admitBudgetBoundary({
      workId: "admission:interactive",
      boundary: "preprompt_compaction",
      prompt: "perform one side effect",
      modelRuntime: runtime,
      now: new Date("2026-09-13T12:00:00Z"),
    });
    expect(result.decision.action).toBe("pause");
    expect(result.message).toContain("before another paid model call");
    expect(getBudgetWork("admission:interactive")).toMatchObject({ status: "paused", last_boundary: "preprompt_compaction" });
    const row = getDb().prepare("SELECT continuation_json,decision FROM budget_decisions WHERE work_id=?").get("admission:interactive") as { continuation_json: string; decision: string };
    expect(row.decision).toBe("pause");
    expect(JSON.parse(row.continuation_json)).toEqual({ prompt: "perform one side effect" });
  });

  test("stops background work and creates a deterministic pending notification identity", async () => {
    initDatabase();
    ensureBudgetWork({ id: "admission:scheduled", chatJid: "web:default", executionKind: "scheduled", scheduledTaskId: "task:budget" });
    saveBudgetCap({ id: "cap:scheduled-zero", scope: "scheduled_run", metric: "api_usd_micros", amount: 0, scheduledTaskId: "task:budget" });
    const result = await admitBudgetBoundary({
      workId: "admission:scheduled", boundary: "model_call", prompt: "background", modelRuntime: runtime,
      now: new Date("2026-09-13T12:00:00Z"),
    });
    expect(result.decision.action).toBe("stop");
    expect(getBudgetWork("admission:scheduled")?.status).toBe("stopped");
    expect(getDb().prepare("SELECT notification_key,notification_status FROM budget_decisions WHERE work_id=?").get("admission:scheduled"))
      .toEqual({ notification_key: "budget-stop:admission:scheduled:model_call", notification_status: "pending" });
  });

  test("read-only status omits provider account references and cannot change permissions", () => {
    initDatabase();
    ensureBudgetWork({ id: "status:work", chatJid: "web:status", executionKind: "interactive" });
    saveBudgetCap({
      id: "cap:status-provider", scope: "provider_window", metric: "provider_percent_used_micros", amount: 50_000_000,
      providerId: "zai", quotaDimension: "primary.percent_used", accountRef: "zai:sha256:secret-fingerprint",
    });
    const status = getBudgetStatus("web:status", "status:work");
    expect(JSON.stringify(status)).not.toContain("secret-fingerprint");
    expect((getDb().prepare("SELECT COUNT(*) AS count FROM budget_allowances").get() as { count: number }).count).toBe(0);
    expect((getDb().prepare("SELECT COUNT(*) AS count FROM budget_overrides").get() as { count: number }).count).toBe(0);
  });

  test("extension leaves the stable prompt prefix untouched and blocks a post-usage tool boundary", () => {
    initDatabase();
    ensureBudgetWork({ id: "tool-boundary:work", chatJid: "web:tool-boundary", executionKind: "interactive" });
    saveBudgetCap({ id: "cap:tool-boundary", scope: "task", metric: "api_usd_micros", amount: 0, workId: "tool-boundary:work" });
    const handlers = new Map<string, (event: any) => unknown>();
    const tools: any[] = [];
    const commands: any[] = [];
    const pi = {
      registerTool: (tool: any) => tools.push(tool),
      registerCommand: (name: string, command: any) => commands.push({ name, command }),
      on: (name: string, handler: (event: any) => unknown) => handlers.set(name, handler),
      sendMessage: () => undefined,
    } as any;
    createBudgetLimitsExtension({ chatJid: "web:tool-boundary", modelRuntime: runtime })(pi);
    expect(handlers.has("before_agent_start")).toBe(false);
    expect(tools.map((tool) => tool.name)).toEqual(["budget_status"]);
    expect(commands.map((entry) => entry.name)).toEqual(["budget"]);
    const blocked = withBudgetWorkContext({ workId: "tool-boundary:work", chatJid: "web:tool-boundary", kind: "interactive" }, () =>
      handlers.get("tool_call")?.({ toolName: "bash", toolCallId: "call-1" }));
    expect(blocked).toMatchObject({ block: true, terminate: true });
    expect(getBudgetWork("tool-boundary:work")?.status).toBe("paused");
  });

  test("warnings-only survives persisted reads but is revoked on work completion", () => {
    initDatabase();
    ensureBudgetWork({ id: "status:override", chatJid: "web:status-override", executionKind: "interactive" });
    setBudgetWarningsOnly({
      workId: "status:override", chatJid: "web:status-override", expiresAt: "2026-12-01T00:00:00Z", now: "2026-09-13T00:00:00Z",
    });
    expect(getDb().prepare("SELECT mode FROM budget_overrides WHERE work_id=? AND revoked_at IS NULL").get("status:override"))
      .toEqual({ mode: "warnings_only" });
    setBudgetWorkStatus("status:override", "completed", { now: "2026-09-13T01:00:00Z" });
    expect(getDb().prepare("SELECT mode FROM budget_overrides WHERE work_id=? AND revoked_at IS NULL").get("status:override"))
      .toBeNull();
  });
});
