import { afterAll, beforeAll, expect, test } from 'bun:test';
import { chromium, type Browser } from 'playwright';
import { join } from 'node:path';
import { buildWidgetSrcDoc, getGeneratedWidgetIframeSandbox } from '../../web/src/ui/generated-widget.js';

const browserTest = process.env.PICLAW_RUN_OPTIONAL_BROWSER_TESTS === '1' ? test : test.skip;
let browser: Browser;
let server: ReturnType<typeof Bun.serve>;
const requests: string[] = [];
// () -> i32, exported as answer; returns 42. No external runtime dependency.
const wasm = Uint8Array.from([0,97,115,109,1,0,0,0,1,5,1,96,0,1,127,3,2,1,0,7,10,1,6,97,110,115,119,101,114,0,0,10,6,1,4,0,65,42,11]);
beforeAll(async () => {
  if (process.env.PICLAW_RUN_OPTIONAL_BROWSER_TESTS !== '1') return;
  const bundle = await Bun.build({ entrypoints: [join(import.meta.dir, 'fixtures/generated-widget-runtime-fixture.ts')], target: 'browser', bundle: true, jsx: { runtime: 'automatic', importSource: 'preact' } });
  if (!bundle.success) throw new Error(bundle.logs.join('\n'));
  server = Bun.serve({ hostname: '127.0.0.1', port: 0, fetch(req) {
    const path = new URL(req.url).pathname; requests.push(path);
    if (path === '/fixture.css') return new Response('#styled { color: rgb(17, 34, 51); }', { headers: { 'Content-Type': 'text/css' } });
    if (path === '/fixture.js') return new Response(bundle.outputs[0], { headers: { 'Content-Type': 'text/javascript' } });
    if (path === '/fixture.wasm') return new Response(wasm, { headers: { 'Content-Type': 'application/wasm' } });
    if (path === '/child') return new Response('<p>Same-origin child</p>', { headers: { 'Content-Type': 'text/html' } });
    return new Response('<!doctype html><div id="app"></div><script type="module" src="/fixture.js"></script>', { headers: { 'Content-Type': 'text/html' } });
  } });
  browser = await chromium.launch({ headless: true });
}, 30000);
afterAll(async () => { await browser?.close(); server?.stop(true); });

for (const mode of ['classic', 'visual']) {
  browserTest(`${mode} actual widget pane loads same-origin WASM and child frames without JS eval`, async () => {
    const page = await browser.newPage();
    try {
      const errors: string[] = []; page.on('pageerror', error => errors.push(error.message));
      await page.goto(`${server.url}?mode=${mode}`);
      await page.waitForTimeout(100);
      expect(errors).toEqual([]);
      await page.locator('iframe').waitFor();
      const frame = page.frames().find(f => f.parentFrame() === page.mainFrame())!;
      await frame.waitForFunction(() => (window as any).result?.ready);
      expect(await frame.evaluate(() => (window as any).result)).toEqual({ answer: 42, crossOrigin: 'blocked', eval: 'blocked', ready: true });
      await frame.frameLocator('iframe').first().getByText('Same-origin child').waitFor();
      await frame.waitForFunction(() => ['connect-src', 'frame-src', 'script-src'].every(d => (window as any).violations.includes(d)));
      expect(await frame.evaluate(() => (window as any).violations)).toEqual(expect.arrayContaining(['connect-src', 'frame-src', 'script-src']));
      expect(requests).toContain('/fixture.wasm');
      expect(await frame.locator('#styled').evaluate(el=>getComputedStyle(el).color)).toBe('rgb(17, 34, 51)');
      expect(requests).toContain('/child');
    } finally { await page.close(); }
  }, 15000);
}

for (const mode of ["classic","visual"]) browserTest(mode + " static preview prevents script execution and network access", async () => {
 const page=await browser.newPage();
 try {
  const requested:string[]=[];page.on("request",request=>requested.push(new URL(request.url()).pathname));
  await page.goto(server.url.href + "?mode="+mode+"&static=1");
  await page.locator("iframe").waitFor();
  const frame=page.frames().find(f=>f.parentFrame()===page.mainFrame())!;
  await frame.locator("#styled").waitFor();
  expect(await frame.evaluate(()=>Boolean((window as any).result))).toBe(false);
  expect(await page.locator("iframe").getAttribute("sandbox")).toBe("allow-downloads");
  expect(await frame.locator("#styled").evaluate(el=>getComputedStyle(el).color)).toBe("rgb(17, 34, 51)");
  expect(requested).not.toContain("/fixture.wasm");expect(requested).not.toContain("/child");
 }finally{await page.close();}
},15000);
