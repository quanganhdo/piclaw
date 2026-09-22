import { beforeAll, afterAll, expect, test } from "bun:test";
import { chromium, type Browser } from "playwright";
import { join } from "node:path";
const browserTest = process.env.PICLAW_RUN_OPTIONAL_BROWSER_TESTS === "1" ? test : test.skip;
let browser: Browser, server: ReturnType<typeof Bun.serve>;
beforeAll(async () => {
  if (process.env.PICLAW_RUN_OPTIONAL_BROWSER_TESTS !== "1") return;
  const built = await Bun.build({ entrypoints: [join(import.meta.dir, "fixtures/compose-idle-fixture.ts")], target: "browser" });
  if (!built.success) throw new Error(String(built.logs));
  const script = await built.outputs[0].text();
  server = Bun.serve({ hostname: "127.0.0.1", port: 0, fetch(req) {
    return new URL(req.url).pathname === "/fixture.js"
      ? new Response(script, { headers: { "content-type": "text/javascript" } })
      : new Response('<!doctype html><div id="app"></div><script type="module" src="/fixture.js"></script>', { headers: { "content-type": "text/html" } });
  } });
  browser = await chromium.launch({ headless: true });
}, 30000);
afterAll(async () => { await browser?.close(); server?.stop(true); });
for (const agents of ["provided", "omitted"]) browserTest(`compose idle effects settle with ${agents} agents`, async () => {
  const page = await browser.newPage();
  try {
    const errors: string[] = []; page.on("pageerror", e => errors.push(e.message));
    await page.route("**/*", route => new URL(route.request().url()).origin === server.url.origin ? route.continue() : route.abort());
    await page.addInitScript(() => {
      const raf = requestAnimationFrame.bind(window);
      (window as any).idleFrames = 0;
      window.requestAnimationFrame = callback => raf(time => { (window as any).idleFrames++; callback(time); });
    });
    await page.goto(`${server.url}?agents=${agents}`);
    const textarea = page.locator("textarea"); await textarea.waitFor();
    await page.waitForTimeout(350);
    const before = await page.evaluate(() => (window as any).idleFrames);
    await page.waitForTimeout(500);
    expect(await page.evaluate(() => (window as any).idleFrames) - before).toBeLessThanOrEqual(3);
    if (agents === "provided") {
      await textarea.fill("@re");
      const match = page.locator(".slash-item").filter({ hasText: "@research" });
      await match.waitFor();
      await match.click();
      expect(await textarea.inputValue()).toBe("@research ");
      await page.locator("#change-agents").click();
      await textarea.fill("@re");
      await page.locator(".slash-item").filter({ hasText: "@review" }).waitFor();
      expect(await page.locator(".slash-item").filter({ hasText: "@research" }).count()).toBe(0);
      expect(await page.locator(".slash-item").filter({ hasText: "@retired" }).count()).toBe(0);
    }
    await textarea.fill("ordinary text");
    await page.waitForTimeout(200);
    const settled = await page.evaluate(() => (window as any).idleFrames);
    await page.waitForTimeout(500);
    expect(await page.evaluate(() => (window as any).idleFrames) - settled).toBeLessThanOrEqual(3);
    await page.locator("#toggle-compose").click();
    await textarea.waitFor({ state: "detached" });
    await page.waitForTimeout(200);
    const unmounted = await page.evaluate(() => (window as any).idleFrames);
    await page.waitForTimeout(400);
    expect(await page.evaluate(() => (window as any).idleFrames) - unmounted).toBeLessThanOrEqual(3);
    await page.locator("#toggle-compose").click();
    await textarea.waitFor();
    await page.waitForTimeout(350);
    const remounted = await page.evaluate(() => (window as any).idleFrames);
    await page.waitForTimeout(400);
    expect(await page.evaluate(() => (window as any).idleFrames) - remounted).toBeLessThanOrEqual(3);
    expect(errors).toEqual([]);
  } finally { await page.close(); }
}, 15000);
