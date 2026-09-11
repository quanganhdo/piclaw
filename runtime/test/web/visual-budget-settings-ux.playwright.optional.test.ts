import { afterAll, beforeAll, expect, test } from "bun:test";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { chromium, type Browser, type Page } from "playwright";

const optionalBrowserTest = process.env.PICLAW_RUN_OPTIONAL_BROWSER_TESTS === "1" ? test : test.skip;
let browser: Browser | null = null;
let server: ReturnType<typeof Bun.serve> | null = null;
let baseUrl = "";

const budget = {
  ok: true, timezone: "Europe/Lisbon", enforcement: "best_effort_boundaries", pricing_notice: "API-equivalent USD is an estimate, not an invoice or subscription balance.", reservation_notice: "Budget limits v1 does not reserve spend and never selects a cheaper model automatically.",
  caps: [{ id: "visual-daily", scope: "instance_daily", metric: "api_usd_micros", amount: 5_000_000, enabled: true, timezone: "Europe/Lisbon", revision: 1, known_usage: 1_500_000, remaining: 3_500_000, unknown_events: 0, window: { ends_at: "2026-09-10T23:00:00Z" }, evidence: null }],
  work: { id: "visual-work", chat_jid: "web:default", execution_kind: "interactive", status: "paused", last_boundary: "model_call" },
  decision: { blockers: [{ capId: "visual-daily", capRevision: 1, windowId: "daily:visual" }] }, override: null, allowances: [],
  provider_capabilities: [{ provider_id: "openai-codex", dimensions: ["primary.percent_used", "credits.remaining"] }], scheduled_task_settings_section: "scheduled-tasks",
};
const tasks = { ok: true, counts: { active: 1, paused: 0, completed: 0 }, tasks: [{ id: "visual-task", chat_jid: "web:default", task_kind: "agent", status: "active", schedule_type: "cron", schedule_value: "0 9 * * *", next_run: "2026-09-10T09:00:00Z", last_run: null, last_result: null, model: null, summary: "Visual daily task", prompt: "Daily", budget_usd: 0.75, budget_cap_enabled: true, budget_cap_revision: 1, recent_run_logs: [] }] };

function json(value: unknown, status = 200) { return new Response(JSON.stringify(value), { status, headers: { "content-type": "application/json" } }); }

beforeAll(async () => {
  if (process.env.PICLAW_RUN_OPTIONAL_BROWSER_TESTS !== "1") return;
  browser = await chromium.launch({ headless: true });
  server = Bun.serve({
    port: 0,
    async fetch(req) {
      const url = new URL(req.url);
      if (url.pathname === "/") return new Response(`<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="/static/visual/dist/app.bundle.css"></head><body><div id="app"></div><script>localStorage.setItem('piclaw-active-panel','settings');localStorage.setItem('piclaw-settings-category','budget');localStorage.setItem('piclaw_wizard_dismissed','1');</script><script type="module" src="/static/visual/dist/app.bundle.js"></script></body></html>`, { headers: { "content-type": "text/html" } });
      if (url.pathname === "/agent/settings-data") return json({ providers: [], toolsets: [], themes: [], colorKeys: [] });
      if (url.pathname === "/agent/settings/budget") return json(budget);
      if (url.pathname === "/agent/settings/budget/action") return json({ ...budget, continuation_required: true });
      if (url.pathname === "/agent/scheduled-tasks") return json(tasks);
      if (url.pathname === "/agent/scheduled-tasks/action") return json({ ok: true, task: tasks.tasks[0] });
      if (url.pathname === "/agent/models") return json({ current: "fixture/model", models: ["fixture/model"], model_options: [], oobe: { provider_ready_completed_instance: true } });
      if (url.pathname === "/agent/addons/web-entries") return json({ entries: [] });
      if (url.pathname === "/agent/system-metrics") return json({});
      if (url.pathname.startsWith("/static/")) {
        try {
          const body = await readFile(join(import.meta.dir, "../../web/static", url.pathname.slice("/static/".length)));
          return new Response(body, { headers: { "content-type": url.pathname.endsWith(".css") ? "text/css" : "text/javascript" } });
        } catch { return new Response("not found", { status: 404 }); }
      }
      return json({ ok: true, chats: [], branches: [] });
    },
  });
  baseUrl = `http://127.0.0.1:${server.port}`;
});

afterAll(async () => { await browser?.close(); browser = null; server?.stop(true); server = null; });

async function openVisual(width: number, height: number): Promise<Page> {
  if (!browser) throw new Error("browser not started");
  const page = await browser.newPage({ viewport: { width, height } });
  await page.goto(baseUrl, { waitUntil: "networkidle" });
  await page.waitForSelector(".settings-panel__budget-card", { state: "visible" });
  return page;
}

optionalBrowserTest("visual Budget pane renders policy and navigates to its Scheduled Tasks source", async () => {
  const page = await openVisual(1280, 760);
  try {
    expect(await page.getByText("$3.5").isVisible()).toBe(true);
    expect(await page.getByText("Best effort at boundaries Piclaw controls.").isVisible()).toBe(true);
    expect(await page.getByText("visual-work").isVisible()).toBe(true);
    await page.getByRole("button", { name: "Open Scheduled Tasks" }).click();
    await page.waitForSelector(".settings-panel__scheduled-detail", { state: "visible" });
    expect(await page.getByText("Visual daily task").first().isVisible()).toBe(true);
    expect(await page.locator('.settings-panel__scheduled-budget input').inputValue()).toBe('0.75');
  } finally { await page.close(); }
});

optionalBrowserTest("visual phone Budget pane has no horizontal document overflow", async () => {
  const page = await openVisual(520, 720);
  try {
    const sizes = await page.evaluate(() => ({ client: document.documentElement.clientWidth, scroll: document.documentElement.scrollWidth, columns: getComputedStyle(document.querySelector('.settings-panel__budget-card dl') as HTMLElement).gridTemplateColumns }));
    expect(sizes.scroll).toBeLessThanOrEqual(sizes.client + 1);
    expect(sizes.columns.split(' ').length).toBe(1);
  } finally { await page.close(); }
});
