import { afterAll, beforeAll, expect, test } from "bun:test";
import { join } from "node:path";
import { chromium, webkit, type Browser } from "playwright";
import { build } from "esbuild";
import { initDatabase, createMedia, closeDatabase } from "../../src/db.js";
import { handleMedia } from "../../src/channels/web/handlers/media.js";

const enabled = process.env.PICLAW_RUN_OPTIONAL_BROWSER_TESTS === "1";
const browserTest = enabled ? test : test.skip;
const channel = { json: (body: unknown, status = 200) => Response.json(body, { status }) };
let server: ReturnType<typeof Bun.serve>;
let browsers: { name: string; browser: Browser }[] = [];
const requests: { id: number; range: string | null; status: number; authenticated: boolean }[] = [];
let ids: number[] = [];

function wave() {
  const rate = 8000, samples = rate * 12;
  const bytes = new Uint8Array(44 + samples * 2), view = new DataView(bytes.buffer);
  const text = (offset: number, value: string) => bytes.set(new TextEncoder().encode(value), offset);
  text(0, "RIFF"); view.setUint32(4, bytes.length - 8, true); text(8, "WAVE"); text(12, "fmt ");
  view.setUint32(16, 16, true); view.setUint16(20, 1, true); view.setUint16(22, 1, true);
  view.setUint32(24, rate, true); view.setUint32(28, rate * 2, true); view.setUint16(32, 2, true); view.setUint16(34, 16, true);
  text(36, "data"); view.setUint32(40, samples * 2, true);
  for (let i = 0; i < samples; i++) view.setInt16(44 + i * 2, Math.round(1000 * Math.sin(i / rate * Math.PI * 440)), true);
  return bytes;
}

beforeAll(async () => {
  if (!enabled) return;
  initDatabase();
  ids = [createMedia("voice.wav", "audio/wav", wave(), null, null), createMedia("broken.mp3", "audio/mpeg", new TextEncoder().encode("broken audio"), null, null), createMedia("picture.png", "image/png", new Uint8Array(Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+j8v8AAAAASUVORK5CYII=", "base64")), null, null)];
  const bundle = await build({ entryPoints: [join(import.meta.dir, "fixtures/audio-preview-fixture.ts")], bundle: true, write: false, format: "esm", platform: "browser", target: "es2022", jsx: "automatic", jsxImportSource: "preact" });
  server = Bun.serve({ hostname: "127.0.0.1", port: 0, fetch(req) {
    const url = new URL(req.url);
    if (url.pathname === "/fixture.js") return new Response(bundle.outputFiles[0].contents, { headers: { "Content-Type": "text/javascript" } });
    if (url.pathname.startsWith("/media/")) {
      const authenticated = req.headers.get("cookie")?.includes("fixture_audio=allowed") === true;
      if (!authenticated) return new Response(null, { status: 401 });
      const logical = Number(url.pathname.split("/")[2]);
      if (![1, 2, 3].includes(logical)) return new Response(null, { status: 404 });
      if (url.pathname.endsWith("/info")) return Response.json({ filename: logical === 1 ? "voice.wav" : logical === 2 ? "broken.mp3" : "picture.png", content_type: logical === 1 ? "audio/wav" : logical === 2 ? "audio/mpeg" : "image/png" });
      const result = handleMedia(channel, ids[logical - 1], false, req);
      requests.push({ id: logical, range: req.headers.get("range"), status: result.status, authenticated });
      return result;
    }
    if (url.pathname.startsWith("/static/")) {
      const file = Bun.file(join(import.meta.dir, "../../web", url.pathname));
      return new Response(file);
    }
    if (url.pathname === "/") {
      const css = url.searchParams.get("skin") === "visual" ? "/static/visual/css/styles.css" : "/static/classic/dist/app.bundle.css";
      return new Response(`<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="${css}"></head><body><main id="app"></main><script type="module" src="/fixture.js"></script></body></html>`, { headers: { "Content-Type": "text/html" } });
    }
    return new Response(null, { status: 404 });
  } });
  browsers = [{ name: "chromium", browser: await chromium.launch({ headless: true }) }, { name: "webkit", browser: await webkit.launch({ headless: true }) }];
});
afterAll(async () => { for (const { browser } of browsers) await browser.close(); server?.stop(true); if (enabled) closeDatabase(); });

for (const engine of ["chromium", "webkit"]) for (const skin of ["classic", "visual"]) for (const width of [1200, 390]) for (const surface of skin === "visual" ? ["user", "assistant", "id-only", "mime-only"] : ["user"]) {
  browserTest(`${engine} ${skin} ${surface} ${width}px audio playback, seek, error, keyboard and teardown`, async () => {
    const browser = browsers.find(item => item.name === engine)!.browser;
    const context = await browser.newContext({ viewport: { width, height: 780 }, colorScheme: width === 390 ? "light" : "dark" });
    try {
      const origin = `http://127.0.0.1:${server.port}`;
      await context.addCookies([{ name: "fixture_audio", value: "allowed", url: origin }]);
      const page = await context.newPage(), errors: string[] = [];
      page.setDefaultTimeout(8_000);
      const requestStart = requests.length;
      page.on("pageerror", error => errors.push(error.message));
      await page.route("**/*", route => new URL(route.request().url()).origin === origin ? route.continue() : route.abort());
      await page.goto(`${origin}/?skin=${skin}&surface=${surface}`);
      const filename = surface === "assistant" || surface === "mime-only" ? "voice.bin" : "voice.wav";
      const preview = page.getByRole("button", { name: `Preview ${filename}`, exact: true });
      if (surface === "mime-only") await page.locator('button[aria-label="Preview voice.bin"][aria-haspopup="dialog"]').waitFor();
      await preview.focus(); await page.keyboard.press("Enter");
      const audio = page.locator("audio"); await audio.waitFor();
      await page.waitForFunction(() => { const a = document.querySelector("audio")!; return a.readyState >= 1 && a.duration >= 11.9; });
      expect(await audio.getAttribute("aria-label")).toBe(filename);
      expect(await audio.getAttribute("preload")).toBe("metadata");
      expect(await audio.evaluate((node: HTMLAudioElement) => node.paused && !node.autoplay)).toBe(true);
      expect(await page.evaluate(() => { const box = document.querySelector('[role="dialog"]')!.getBoundingClientRect(); return box.left >= -1 && box.right <= innerWidth + 1; })).toBe(true);
      await audio.evaluate(async (node: HTMLAudioElement) => { node.muted = true; await node.play(); });
      await page.waitForFunction(() => document.querySelector("audio")!.currentTime > 0.05);
      await audio.evaluate((node: HTMLAudioElement) => { node.pause(); node.currentTime = 6; });
      await page.waitForFunction(() => Math.abs(document.querySelector("audio")!.currentTime - 6) < 0.25);
      const download = page.getByRole("link", { name: "Download", exact: true });
      expect(await download.getAttribute("href")).toBe("/media/1");
      expect(await download.getAttribute("download")).toBe(filename);
      await audio.evaluate(async (node: HTMLAudioElement) => { (window as any).retiredAudio = node; await node.play(); });
      await page.keyboard.press("Escape"); await audio.waitFor({ state: "detached" });
      await page.waitForFunction(() => (window as any).retiredAudio.paused && !(window as any).retiredAudio.getAttribute("src"));
      expect(await preview.evaluate(node => document.activeElement === node)).toBe(true);
      await preview.click(); await audio.waitFor();
      const close = page.getByRole("button", { name: /^(Close|Close preview)$/ });
      await close.focus();
      for (let step = 0; step < 8; step++) {
        await page.keyboard.press("Tab");
        expect(await page.evaluate(() => Boolean(document.activeElement?.closest('[role="dialog"]')))).toBe(true);
      }
      await page.getByRole("button", { name: /^(Close|Close preview)$/ }).click(); await audio.waitFor({ state: "detached" });
      await page.getByRole("button", { name: "Preview broken.mp3", exact: true }).click();
      await page.getByRole("alert").waitFor();
      expect(await page.getByRole("alert").textContent()).toContain("Download");
      expect(await page.getByRole("link", { name: "Download", exact: true }).getAttribute("href")).toBe("/media/2");
      await page.keyboard.press("Escape");
      expect(requests.slice(requestStart).some(request => request.range && request.status === 206 && request.authenticated)).toBe(true);
      expect(errors).toEqual([]);
    } finally { await context.close(); }
  }, 35_000);
}


browserTest("Visual refuses unsafe metadata and handles failed or aborted metadata fetches", async () => {
  const browser = browsers.find(item => item.name === "chromium")!.browser;
  const context = await browser.newContext();
  try {
    const origin = `http://127.0.0.1:${server.port}`;
    await context.addCookies([{ name: "fixture_audio", value: "allowed", url: origin }]);
    const page = await context.newPage();
    page.setDefaultTimeout(8_000);
    for (const mode of ["unsafe", "forbidden"]) {
      await page.route("**/media/1/info", route => route.fulfill({ status: mode === "forbidden" ? 403 : 200, contentType: "application/json", body: JSON.stringify({ filename: "fake.wav", content_type: "text/html" }) }));
      await page.goto(origin + "/?skin=visual");
      await page.getByRole("button", { name: "Preview voice.wav", exact: true }).click();
      await page.getByRole("alert").waitFor();
      expect(await page.locator("audio").count()).toBe(0);
      expect(await page.getByRole("link", { name: "Download", exact: true }).getAttribute("href")).toBe("/media/1");
      await page.keyboard.press("Escape");
      await page.unroute("**/media/1/info");
    }
    let release: () => void = () => {};
    const gate = new Promise<void>(resolve => { release = resolve; });
    const pending: Promise<void>[] = [];
    await page.route("**/media/1/info", async route => {
      const work = (async () => { await gate; await route.fulfill({ contentType: "application/json", body: JSON.stringify({ filename: "voice.wav", content_type: "audio/wav" }) }); })();
      pending.push(work); await work;
    });
    await page.goto(origin + "/?skin=visual");
    await page.getByRole("button", { name: "Preview voice.wav", exact: true }).click();
    await page.getByRole("status").waitFor();
    await page.waitForFunction(() => Boolean(document.activeElement?.closest('[role="dialog"]')));
    await page.keyboard.press("Escape");
    await page.getByRole("dialog").waitFor({ state: "detached" });
    release(); await Promise.all(pending);
    expect(await page.getByRole("dialog").count()).toBe(0); expect(await page.locator("audio").count()).toBe(0);
  } finally { await context.close(); }
}, 20_000);


for (const engine of ["chromium", "webkit"]) for (const surface of ["image-first", "audio-first"]) {
  browserTest(`${engine} Visual mixed ${surface} keeps image and correct audio ID`, async () => {
    const browser = browsers.find(item => item.name === engine)!.browser;
    const context = await browser.newContext({ viewport: { width: 390, height: 780 } });
    try {
      const origin = `http://127.0.0.1:${server.port}`;
      await context.addCookies([{ name: "fixture_audio", value: "allowed", url: origin }]);
      const page = await context.newPage(); page.setDefaultTimeout(8_000);
      const requestStart = requests.length;
      await page.goto(`${origin}/?skin=visual&surface=${surface}`);
      const image = page.getByRole("img", { name: "picture.png", exact: true });
      await image.waitFor(); expect(await image.getAttribute("src")).toBe("/media/3");
      await page.waitForFunction(() => (document.querySelector('img[alt="picture.png"]') as HTMLImageElement).naturalWidth > 0);
      await page.getByRole("button", { name: "Preview voice.wav", exact: true }).click();
      const audio = page.locator("audio"); await audio.waitFor();
      expect(await audio.getAttribute("src")).toBe("/media/1");
      await page.waitForFunction(() => document.querySelector("audio")!.duration >= 11.9);
      await audio.evaluate(async (node: HTMLAudioElement) => { node.muted = true; await node.play(); });
      await page.waitForFunction(() => document.querySelector("audio")!.currentTime > 0.05);
      await audio.evaluate((node: HTMLAudioElement) => { node.pause(); node.currentTime = 6; });
      await page.waitForFunction(() => Math.abs(document.querySelector("audio")!.currentTime - 6) < 0.25);
      expect(requests.slice(requestStart).some(request => request.id === 1 && request.range && request.status === 206)).toBe(true);
      expect(requests.slice(requestStart).some(request => request.id === 3 && request.range)).toBe(false);
      await page.keyboard.press("Escape"); await audio.waitFor({ state: "detached" });
      expect(await image.count()).toBe(1);
    } finally { await context.close(); }
  }, 20_000);
}
