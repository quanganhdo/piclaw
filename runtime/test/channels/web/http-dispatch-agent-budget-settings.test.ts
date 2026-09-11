import { beforeEach, describe, expect, test } from "bun:test";
import "../../helpers.js";
import { isolateBudgetTestDatabase } from "../../budget/fixture.js";
isolateBudgetTestDatabase();

import { handleBudgetSettingsAction, handleBudgetSettingsRead } from "../../../src/channels/web/handlers/budget-settings.js";
import { handleAgentRoutes } from "../../../src/channels/web/http/dispatch-agent.js";
import { ensureBudgetWork, getBudgetCap, getBudgetWork, getDb, initDatabase, saveBudgetCap, setBudgetWorkStatus } from "../../../src/db.js";

function channel(accountRef = "provider:secret") {
  return {
    agentPool: { resolveBudgetProviderAccountRef: async () => accountRef },
    json: (payload: unknown, status = 200) => new Response(JSON.stringify(payload), { status, headers: { "content-type": "application/json" } }),
  } as any;
}

async function route(path: string, method = "GET", body?: unknown) {
  const req = new Request(`https://example.com${path}`, { method, ...(body === undefined ? {} : { headers: { "content-type": "application/json" }, body: JSON.stringify(body) }) });
  return await handleAgentRoutes(channel(), req, new URL(req.url).pathname, new URL(req.url));
}

describe("budget settings routes", () => {
  beforeEach(() => initDatabase());

  test("denies reads and mutations outside single-user mode before parsing", async () => {
    const url = new URL("https://example.com/agent/settings/budget");
    expect(handleBudgetSettingsRead(channel(), url, { accessMode: "family-shared" }).status).toBe(403);
    const req = new Request("https://example.com/agent/settings/budget/action", { method: "POST", body: "not-json" });
    expect((await handleBudgetSettingsAction(channel(), req, { accessMode: "family-shared" })).status).toBe(403);
  });

  test("reads redacted uncapped status", async () => {
    const response = await route("/agent/settings/budget?chat_jid=web:test");
    expect(response?.status).toBe(200);
    const payload = await response!.json() as any;
    expect(payload).toMatchObject({ ok: true, message: "No limits configured.", caps: [] });
    expect(JSON.stringify(payload)).not.toContain("account_ref");
  });

  test("creates and revises caps only with the current explicit revision", async () => {
    let response = await route("/agent/settings/budget/action?chat_jid=web:test", "POST", {
      action: "save_cap", scope: "instance_daily", metric: "api_usd_micros", amount: "1.25", timezone: "UTC",
    });
    expect(response?.status).toBe(200);
    const created = (await response!.json() as any).caps[0];
    expect(created).toMatchObject({ amount: 1_250_000, revision: 1, enabled: true });

    response = await route("/agent/settings/budget/action?chat_jid=web:test", "POST", {
      action: "save_cap", id: created.id, scope: "instance_daily", metric: "api_usd_micros", amount: "2", timezone: "UTC", confirm_revision: 99,
    });
    expect(response?.status).toBe(409);
    expect(getBudgetCap(created.id)?.revision).toBe(1);

    response = await route("/agent/settings/budget/action?chat_jid=web:test", "POST", {
      action: "save_cap", id: created.id, scope: "instance_daily", metric: "api_usd_micros", amount: "2", timezone: "UTC", confirm_revision: 1,
    });
    expect(response?.status).toBe(200);
    expect(getBudgetCap(created.id)).toMatchObject({ amount: 2_000_000, revision: 2 });
  });

  test("derives provider account binding server-side and never returns it", async () => {
    const req = new Request("https://example.com/agent/settings/budget/action?chat_jid=web:test", {
      method: "POST", body: JSON.stringify({ action: "save_cap", scope: "provider_window", metric: "provider_percent_used_micros", amount: "80", provider_id: "zai", quota_dimension: "primary.percent_used" }),
    });
    const response = await handleAgentRoutes(channel("zai:secret-account"), req, "/agent/settings/budget/action", new URL(req.url));
    expect(response?.status).toBe(200);
    const payload = await response!.json() as any;
    expect(JSON.stringify(payload)).not.toContain("secret-account");
    expect(getBudgetCap(payload.caps[0].id)?.account_ref).toBe("zai:secret-account");
  });

  test("disables a cap while retaining its window and revision history", async () => {
    saveBudgetCap({ id: "cap:disable", scope: "instance_daily", metric: "api_usd_micros", amount: 1_000_000, timezone: "UTC" }, getDb(), new Date("2026-09-09T12:00:00Z"));
    const before = (getDb().prepare("SELECT COUNT(*) AS count FROM budget_cap_windows WHERE cap_id=?").get("cap:disable") as any).count;
    const response = await route("/agent/settings/budget/action", "POST", { action: "set_cap_enabled", id: "cap:disable", enabled: false, confirm_revision: 1 });
    expect(response?.status).toBe(200);
    expect(getBudgetCap("cap:disable")).toMatchObject({ enabled: 0, revision: 2 });
    expect((getDb().prepare("SELECT COUNT(*) AS count FROM budget_cap_windows WHERE cap_id=?").get("cap:disable") as any).count).toBe(before);
  });

  test("grants bounded allowance and warnings-only with continuation guidance", async () => {
    ensureBudgetWork({ id: "work:blocked", chatJid: "web:test", executionKind: "interactive" });
    const cap = saveBudgetCap({ id: "cap:blocker", scope: "task", metric: "api_usd_micros", amount: 0, workId: "work:blocked" });
    setBudgetWorkStatus("work:blocked", "paused");
    getDb().prepare(`INSERT INTO budget_decisions (id,work_id,boundary,decision,blockers_json,continuation_json,notification_key,notification_status,created_at)
      VALUES (?,?,?,?,?,?,?,?,?)`).run("decision:blocker", "work:blocked", "model_call", "pause", JSON.stringify([{ capId: cap.id, capRevision: cap.revision, windowId: "work:work:blocked:r1" }]), null, null, null, new Date().toISOString());

    let response = await route("/agent/settings/budget/action?chat_jid=web:test", "POST", { action: "grant_allowance", work_id: "work:blocked", cap_id: "cap:blocker", amount: "0.5" });
    expect(response?.status).toBe(200);
    expect((await response!.json() as any).continuation_required).toBe(true);
    expect(getBudgetWork("work:blocked")?.status).toBe("active");
    expect((getDb().prepare("SELECT amount,expires_at FROM budget_allowances WHERE work_id=?").get("work:blocked") as any).amount).toBe(500_000);

    response = await route("/agent/settings/budget/action?chat_jid=web:test", "POST", { action: "warnings_only", work_id: "work:blocked", expires_at: new Date(Date.now() + 25 * 3_600_000).toISOString() });
    expect(response?.status).toBe(400);
    response = await route("/agent/settings/budget/action?chat_jid=web:test", "POST", { action: "warnings_only", work_id: "work:blocked" });
    expect(response?.status).toBe(200);
    expect((await response!.json() as any).continuation_required).toBe(true);
    expect(getDb().prepare("SELECT mode FROM budget_overrides WHERE work_id=?").get("work:blocked")).toEqual({ mode: "warnings_only" });
  });

  test("resumes and cancels only the current chat work", async () => {
    ensureBudgetWork({ id: "work:paused", chatJid: "web:test", executionKind: "interactive" });
    setBudgetWorkStatus("work:paused", "paused");
    let response = await route("/agent/settings/budget/action?chat_jid=web:test", "POST", { action: "resume_work", work_id: "work:paused" });
    expect(response?.status).toBe(200);
    expect((await response!.json() as any).continuation_required).toBe(true);
    expect(getBudgetWork("work:paused")?.status).toBe("active");

    response = await route("/agent/settings/budget/action?chat_jid=web:other", "POST", { action: "cancel_work", work_id: "work:paused" });
    expect(response?.status).toBe(409);
    expect(getBudgetWork("work:paused")?.status).toBe("active");
  });

  test("rejects duplicate selectors and browser-supplied account references", async () => {
    expect((await route("/agent/settings/budget?chat_jid=a&chat_jid=b"))?.status).toBe(400);
    const response = await route("/agent/settings/budget/action", "POST", { action: "save_cap", scope: "provider_window", metric: "provider_percent_used_micros", amount: "80", provider_id: "zai", quota_dimension: "primary.percent_used", account_ref: "attacker" });
    expect(response?.status).toBe(400);
  });
});
