import { afterAll, beforeAll, expect, test } from "bun:test";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { chromium, type Browser, type Page } from "playwright";

const optionalBrowserTest = process.env.PICLAW_RUN_OPTIONAL_BROWSER_TESTS === "1" ? test : test.skip;
let browser: Browser | null = null;
let server: ReturnType<typeof Bun.serve> | null = null;
let baseUrl = "";

beforeAll(async () => {
  if (process.env.PICLAW_RUN_OPTIONAL_BROWSER_TESTS !== "1") return;
  browser = await chromium.launch({ headless: true });
  server = Bun.serve({
    port: 0,
    async fetch(req) {
      const url = new URL(req.url);
      if (url.pathname === "/") return new Response(`<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="/static/classic/dist/app.bundle.css"></head><body><div id="settings-widget-fixture-root"></div><script type="module" src="/static/classic/dist/settings-widget-fixture.bundle.js"></script></body></html>`, { headers: { "content-type": "text/html" } });
      if (!url.pathname.startsWith("/static/") || url.pathname.includes("..")) return new Response("not found", { status: 404 });
      try {
        const body = await readFile(join(import.meta.dir, "../../web/static", url.pathname.slice("/static/".length)));
        return new Response(body, { headers: { "content-type": url.pathname.endsWith(".css") ? "text/css" : "text/javascript" } });
      } catch { return new Response("not found", { status: 404 }); }
    },
  });
  baseUrl = `http://127.0.0.1:${server.port}`;
});

afterAll(async () => { await browser?.close(); browser = null; server?.stop(true); server = null; });

async function openBudget(width: number, height: number): Promise<Page> {
  if (!browser) throw new Error("browser not started");
  const page = await browser.newPage({ viewport: { width, height } });
  await page.goto(`${baseUrl}/?section=budget&width=${Math.min(width - 40, 1120)}&height=${Math.min(height - 40, 720)}`, { waitUntil: "networkidle" });
  await page.waitForSelector(".settings-budget-cap-card", { state: "visible" });
  return page;
}

optionalBrowserTest("classic Budget pane renders redacted policy, provider evidence and paused work", async () => {
  const page = await openBudget(1200, 780);
  try {
    expect(await page.locator(".settings-budget-cap-card").count()).toBe(2);
    expect(await page.getByText("$6.75").isVisible()).toBe(true);
    expect(await page.getByText("Best effort at boundaries Piclaw controls.").isVisible()).toBe(true);
    expect(await page.getByText(/Fresh/).isVisible()).toBe(true);
    expect(await page.getByText("fixture-work").isVisible()).toBe(true);
    expect(await page.getByRole("button", { name: "Grant and resume" }).isVisible()).toBe(true);
    expect(await page.locator("body").innerText()).not.toContain("account_ref");
  } finally { await page.close(); }
});

optionalBrowserTest("classic Budget create/edit flow confirms changes and restores focus", async () => {
  const page = await openBudget(1200, 780);
  try {
    const create = page.getByRole("button", { name: "Create cap" });
    await create.click();
    await page.waitForFunction(() => document.activeElement?.textContent?.trim() === 'Create budget cap');
    expect(await page.getByRole("heading", { name: "Create budget cap" }).evaluate((node) => node === document.activeElement)).toBe(true);
    await page.getByLabel("Amount").fill("12.5");
    await page.getByRole("button", { name: "Create cap", exact: true }).last().click();
    await page.waitForFunction(() => document.activeElement?.textContent?.trim() === 'Create cap');
    expect(await create.evaluate((node) => node === document.activeElement)).toBe(true);

    page.once("dialog", dialog => dialog.accept());
    await page.getByRole("button", { name: "Edit" }).first().click();
    await page.getByLabel("Amount").fill("15");
    await page.getByRole("button", { name: "Confirm update" }).click();
    await page.waitForFunction(() => document.activeElement?.textContent?.trim() === 'Create cap');
    expect(await create.evaluate((node) => node === document.activeElement)).toBe(true);
  } finally { await page.close(); }
});

optionalBrowserTest("classic Budget links to the single Scheduled Tasks budget editor", async () => {
  const page = await openBudget(1200, 780);
  try {
    await page.getByRole("button", { name: "Open Scheduled Tasks" }).click();
    await page.waitForSelector('.settings-task-row', { state: 'visible' });
    expect(await page.getByRole('heading', { name: 'Daily fixture summary' }).isVisible()).toBe(true);
    expect(await page.getByText("Per-run API-equivalent USD").isVisible()).toBe(true);
    expect(await page.locator('.settings-task-budget-row input').inputValue()).toBe('0.5');
  } finally { await page.close(); }
});

optionalBrowserTest("phone Budget layout avoids horizontal overflow and remains keyboard operable", async () => {
  const page = await openBudget(520, 720);
  try {
    const metrics = await page.evaluate(() => ({ width: document.documentElement.clientWidth, scrollWidth: document.documentElement.scrollWidth, columns: getComputedStyle(document.querySelector(".settings-budget-cap-card dl") as HTMLElement).gridTemplateColumns }));
    expect(metrics.scrollWidth).toBeLessThanOrEqual(metrics.width + 1);
    expect(metrics.columns.split(" ").length).toBe(1);
    await page.keyboard.press("Tab");
    const focused = await page.evaluate(() => document.activeElement?.tagName);
    expect(["BUTTON", "SELECT", "INPUT"]).toContain(focused);
  } finally { await page.close(); }
});
