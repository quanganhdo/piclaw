import { afterEach, beforeEach, describe, expect, test } from "bun:test";

import "../../helpers.js";
import { createTask, getBudgetCap, getDb, initDatabase, saveBudgetCap } from "../../../src/db.js";
import { handleAgentRoutes } from "../../../src/channels/web/http/dispatch-agent.js";

function jsonChannel() {
  return {
    json: (payload: unknown, status = 200) => new Response(JSON.stringify(payload), {
      status,
      headers: { "content-type": "application/json" },
    }),
  } as any;
}

function insertTask(overrides: Record<string, any> = {}) {
  createTask({
    id: "task-web-ui",
    chat_jid: "web:default",
    prompt: "Summarize the day",
    model: null,
    task_kind: "agent",
    command: null,
    cwd: null,
    timeout_sec: null,
    schedule_type: "once",
    schedule_value: "2026-05-05T09:00:00.000Z",
    next_run: "2026-05-05T09:00:00.000Z",
    status: "active",
    created_at: "2026-05-04T09:00:00.000Z",
    ...overrides,
  });
}

describe("scheduled task web management routes", () => {
  beforeEach(() => {
    initDatabase();
    getDb().query("DELETE FROM task_run_logs").run();
    getDb().query("DELETE FROM scheduled_tasks").run();
  });

  afterEach(() => {
    try {
      getDb().close();
    } catch (_error) {
      void _error;
    }
  });

  test("lists scheduled tasks with counts for the settings pane", async () => {
    insertTask();
    insertTask({ id: "task-paused", status: "paused", next_run: "2026-05-06T09:00:00.000Z" });

    const req = new Request("https://example.com/agent/scheduled-tasks?include_run_logs=1", { method: "GET" });
    const response = await handleAgentRoutes(jsonChannel(), req, "/agent/scheduled-tasks", new URL(req.url));
    expect(response?.status).toBe(200);
    const body = await response!.json() as any;
    expect(body.ok).toBe(true);
    expect(body.counts).toEqual({ active: 1, paused: 1, completed: 0 });
    expect(body.tasks.map((task: any) => task.id)).toContain("task-web-ui");
  });

  test("pauses and resumes non-internal scheduled tasks", async () => {
    insertTask();

    const pauseReq = new Request("https://example.com/agent/scheduled-tasks/action", {
      method: "POST",
      body: JSON.stringify({ action: "pause", id: "task-web-ui" }),
    });
    const pauseResponse = await handleAgentRoutes(jsonChannel(), pauseReq, "/agent/scheduled-tasks/action", new URL(pauseReq.url));
    expect(pauseResponse?.status).toBe(200);
    expect((await pauseResponse!.json() as any).task.status).toBe("paused");

    const resumeReq = new Request("https://example.com/agent/scheduled-tasks/action", {
      method: "POST",
      body: JSON.stringify({ action: "resume", id: "task-web-ui" }),
    });
    const resumeResponse = await handleAgentRoutes(jsonChannel(), resumeReq, "/agent/scheduled-tasks/action", new URL(resumeReq.url));
    expect(resumeResponse?.status).toBe(200);
    expect((await resumeResponse!.json() as any).task.status).toBe("active");
  });

  test("edits per-run budget only through the scheduled task surface", async () => {
    insertTask();
    const setReq = new Request("https://example.com/agent/scheduled-tasks/action", {
      method: "POST",
      body: JSON.stringify({ action: "set_budget", id: "task-web-ui", budget_usd: "0.25" }),
    });
    const setResponse = await handleAgentRoutes(jsonChannel(), setReq, "/agent/scheduled-tasks/action", new URL(setReq.url));
    expect(setResponse?.status).toBe(200);
    expect((await setResponse!.json() as any).task).toMatchObject({ budget_usd: 0.25, budget_cap_enabled: true, budget_cap_revision: 1 });
    expect(getBudgetCap("scheduled-cap:task-web-ui")).toMatchObject({ amount: 250_000, enabled: 1 });

    const staleReq = new Request("https://example.com/agent/scheduled-tasks/action", {
      method: "POST",
      body: JSON.stringify({ action: "set_budget", id: "task-web-ui", budget_usd: "0.50", confirm_revision: 99 }),
    });
    expect((await handleAgentRoutes(jsonChannel(), staleReq, "/agent/scheduled-tasks/action", new URL(staleReq.url)))?.status).toBe(409);

    const disableReq = new Request("https://example.com/agent/scheduled-tasks/action", {
      method: "POST",
      body: JSON.stringify({ action: "set_budget", id: "task-web-ui", enabled: false, confirm_revision: 1 }),
    });
    const disableResponse = await handleAgentRoutes(jsonChannel(), disableReq, "/agent/scheduled-tasks/action", new URL(disableReq.url));
    expect((await disableResponse!.json() as any).task).toMatchObject({ budget_usd: 0.25, budget_cap_enabled: false, budget_cap_revision: 2 });
  });

  test("zero requires deliberate acknowledgement and tiny positive input never becomes zero", async () => {
    insertTask();
    const channel = jsonChannel();
    const submit = (fields: Record<string, unknown>) => handleAgentRoutes(channel, new Request("http://test/agent/scheduled-tasks/action", {
      method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ action: "set_budget", id: "task-web-ui", ...fields }),
    }), "/agent/scheduled-tasks/action", new URL("http://test/agent/scheduled-tasks/action"));
    expect((await submit({ budget_usd: "0" }))?.status).toBe(409);
    expect(getDb().query("SELECT count(*) n FROM budget_caps WHERE scheduled_task_id='task-web-ui'").get()).toEqual({ n: 0 });
    expect((await submit({ budget_usd: 0.0000001 }))?.status).toBe(400);
    const acknowledged = await submit({ budget_usd: "0", confirm_zero_budget: true });
    expect(acknowledged?.status).toBe(200);
    expect((await acknowledged!.json()).task.budget_readiness).toMatchObject({ mode: "zero_task_cap", status: "blocked" });
    const disabled = await submit({ enabled: false, confirm_revision: 1 });
    expect((await disabled!.json()).task.budget_readiness).toMatchObject({ mode: "disabled_task_cap", status: "allowed" });
  });

  test("failed budget receipt projection rolls back both cap value and revision", async () => {
    insertTask();
    saveBudgetCap({ id: "scheduled-cap:task-web-ui", scope: "scheduled_run", metric: "api_usd_micros", amount: 250000, scheduledTaskId: "task-web-ui" });
    saveBudgetCap({ id: "bad-calendar", scope: "instance_daily", metric: "api_usd_micros", amount: 1000000, timezone: "UTC" });
    getDb().query("UPDATE budget_caps SET timezone='bad-zone' WHERE id='bad-calendar'").run();
    const call = () => handleAgentRoutes(jsonChannel(), new Request("http://test/agent/scheduled-tasks/action", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ action: "set_budget", id: "task-web-ui", budget_usd: "0.5", confirm_revision: 1 }) }), "/agent/scheduled-tasks/action", new URL("http://test/agent/scheduled-tasks/action"));
    await expect(call()).rejects.toThrow();
    expect(getBudgetCap("scheduled-cap:task-web-ui")).toMatchObject({ amount: 250000, revision: 1 });
    getDb().query("UPDATE budget_caps SET timezone='UTC' WHERE id='bad-calendar'").run();
    expect((await call())?.status).toBe(200);
    expect(getBudgetCap("scheduled-cap:task-web-ui")).toMatchObject({ amount: 500000, revision: 2 });
  });

  test("rejects per-run budgets for shell tasks", async () => {
    insertTask({ id: "task-shell", task_kind: "shell", command: "echo hi", prompt: "" });
    const req = new Request("https://example.com/agent/scheduled-tasks/action", {
      method: "POST", body: JSON.stringify({ action: "set_budget", id: "task-shell", budget_usd: "1" }),
    });
    expect((await handleAgentRoutes(jsonChannel(), req, "/agent/scheduled-tasks/action", new URL(req.url)))?.status).toBe(409);
  });

  test("protects internal tasks unless explicitly allowed", async () => {
    insertTask({ id: "task-internal", task_kind: "internal", prompt: "/dream" });

    const req = new Request("https://example.com/agent/scheduled-tasks/action", {
      method: "POST",
      body: JSON.stringify({ action: "delete", id: "task-internal" }),
    });
    const response = await handleAgentRoutes(jsonChannel(), req, "/agent/scheduled-tasks/action", new URL(req.url));
    expect(response?.status).toBe(403);
    const body = await response!.json() as any;
    expect(body.protected).toBe(true);
    expect(getDb().prepare("SELECT id FROM scheduled_tasks WHERE id = ?").get("task-internal")).toBeTruthy();
  });
});
