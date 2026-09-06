import { beforeAll, afterAll, expect, test } from "bun:test";
import { chromium, type Browser } from "playwright";
import { join } from "node:path";

const browserTest = process.env.PICLAW_RUN_OPTIONAL_BROWSER_TESTS === "1" ? test : test.skip;
let browser: Browser, server: ReturnType<typeof Bun.serve>, base: string;
beforeAll(async () => {
  if (process.env.PICLAW_RUN_OPTIONAL_BROWSER_TESTS !== "1") return;
  browser = await chromium.launch({ headless: true });
  server = Bun.serve({ hostname: "127.0.0.1", port: 0, async fetch(req) {
    const path = new URL(req.url).pathname;
    if (path === "/login") return new Response(Bun.file(join(import.meta.dir, "../../web/static/login.html")), { headers: { "Content-Type": "text/html" } });
    if (["/static/common/dist/login.bundle.js", "/static/common/dist/login.bundle.css"].includes(path)) return new Response(Bun.file(join(import.meta.dir, "../../web/static", path.slice("/static/".length))));
    return new Response("Not found", { status: 404 });
  } });
  base = `http://127.0.0.1:${server.port}`;
});
afterAll(async () => { await browser?.close(); server?.stop(true); });

browserTest("family code login shows username, sends normalised account, survives network failure, and fits mobile", async () => {
  const page = await browser.newPage({ viewport: { width: 375, height: 720 } });
  try {
    await page.route("**/auth/options", route => route.fulfill({ json: { mode: "family-shared", auth_enabled: true, totp: true, passkey: false, username_required: true } }));
    const posted: unknown[] = [];
    await page.route("**/auth/verify", async route => { posted.push(route.request().postDataJSON()); await route.abort(); });
    await page.goto(base + "/login"); await page.locator("#username").waitFor({ state: "visible" });
    expect(await page.locator("#passkey-button").isVisible()).toBe(false);
    await page.locator("#username").fill("Alice"); await page.locator("#code").fill("123456"); await page.locator("#verify-button").click();
    await page.waitForFunction(() => document.getElementById("error")?.textContent?.includes("Could not reach"));
    expect(posted).toEqual([{ username: "alice", code: "123456" }]);
    expect(await page.locator("#verify-button").isEnabled()).toBe(true);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  } finally { await page.close(); }
}, 20000);

browserTest("single-user code login omits username and passkey-only hides the TOTP form", async () => {
  const page = await browser.newPage();
  try {
    let totp = true;
    await page.route("**/auth/options", route => route.fulfill({ json: { mode: "single-user", auth_enabled: true, totp, passkey: !totp, username_required: false } }));
    const payloads: unknown[] = [];
    await page.route("**/auth/verify", route => { payloads.push(route.request().postDataJSON()); return route.fulfill({ status: 401, json: { error: "Invalid code" } }); });
    await page.goto(base + "/login"); await page.locator("#code").waitFor({ state: "visible" });
    expect(await page.locator("#username").isVisible()).toBe(false);
    await page.locator("#code").fill("123456"); await page.locator("#verify-button").click();
    await page.waitForFunction(() => document.getElementById("error")?.textContent === "Invalid code");
    expect(payloads).toEqual([{ code: "123456" }]);
    totp = false; await page.reload(); await page.locator("#passkey-button").waitFor({ state: "visible" });
    expect(await page.locator("#login-form").isVisible()).toBe(false);
    expect(await page.locator("#login-description").textContent()).toContain("registered for this site");
  } finally { await page.close(); }
}, 20000);

browserTest("failed policy load never exposes a credential form; explicit retry can recover", async () => {
  const page = await browser.newPage();
  try {
    let valid = false;
    await page.route("**/auth/options", route => route.fulfill(valid ? { json: { mode: "single-user", auth_enabled: true, totp: true, passkey: false, username_required: false } } : { status: 503, json: { error: "unavailable" } }));
    await page.goto(base + "/login"); await page.locator("#retry-options").waitFor({ state: "visible" });
    expect(await page.locator("#login-form").isVisible()).toBe(false); expect(await page.locator("#passkey-button").isVisible()).toBe(false);
    valid = true; await page.locator("#retry-options").click(); await page.locator("#code").waitFor({ state: "visible" });
    expect(await page.locator("#verify-button").isEnabled()).toBe(true);
  } finally { await page.close(); }
}, 20000);

browserTest("explicit passkey action aborts conditional mediation and code submission cancels passkey work", async () => {
  const page = await browser.newPage();
  try {
    await page.addInitScript(() => {
      const calls: string[] = [];
      (window as any).__credentialCalls = calls;
      class Credential { static async isConditionalMediationAvailable() { return true; } }
      Object.defineProperty(window, "PublicKeyCredential", { value: Credential });
      Object.defineProperty(navigator, "credentials", { value: { get: (options: any) => {
        calls.push(options.mediation);
        return new Promise((_resolve, reject) => options.signal.addEventListener("abort", () => { calls.push(`abort:${options.mediation}`); reject(new DOMException("Aborted", "AbortError")); }, { once: true }));
      } } });
    });
    await page.route("**/auth/options", route => route.fulfill({ json: { mode: "single-user", auth_enabled: true, totp: true, passkey: true, username_required: false } }));
    await page.route("**/auth/webauthn/login/start", route => route.fulfill({ json: { token: "challenge-token", options: { challenge: "YWJj" } } }));
    await page.route("**/auth/verify", route => route.fulfill({ status: 401, json: { error: "Invalid code" } }));
    await page.goto(base + "/login");
    await page.waitForFunction(() => (window as any).__credentialCalls.includes("conditional"));
    await page.locator("#passkey-button").evaluate((button: HTMLButtonElement) => { button.click(); button.click(); });
    await page.waitForFunction(() => (window as any).__credentialCalls.includes("required"));
    expect(await page.evaluate(() => (window as any).__credentialCalls)).toEqual(["conditional", "abort:conditional", "required"]);
    await page.locator("#code").fill("123456"); await page.locator("#verify-button").click();
    await page.waitForFunction(() => document.getElementById("error")?.textContent === "Invalid code");
    expect(await page.evaluate(() => (window as any).__credentialCalls)).toContain("abort:required");
  } finally { await page.close(); }
}, 20000);
