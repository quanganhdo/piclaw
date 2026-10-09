import { afterAll, beforeAll, expect, test } from 'bun:test';
import { join } from 'node:path';
import { chromium, webkit } from 'playwright';
const enabled = process.env.PICLAW_RUN_OPTIONAL_BROWSER_TESTS === '1' && process.env.PICLAW_E2E_DISPOSABLE === '1', browserTest = enabled ? test : test.skip;
let server: ReturnType<typeof Bun.serve>;
beforeAll(async () => {
  if (!enabled) return;
  const built = await Bun.build({ entrypoints: [join(import.meta.dir, 'fixtures/thought-preview-race-fixture.ts')], target: 'browser' });
  if (!built.success) throw Error(String(built.logs));
  const script = await built.outputs[0].text();
  server = Bun.serve({ hostname: '127.0.0.1', port: 0, fetch(req) { return new URL(req.url).pathname === '/fixture.js' ? new Response(script, { headers: { 'content-type': 'text/javascript' } }) : new Response('<button id="expand">Expand thoughts</button><button id="live">Live update</button><button id="release">Release old response</button><pre id="thought">initial</pre><script type="module" src="/fixture.js"></script>', { headers: { 'content-type': 'text/html' } }); } });
});
afterAll(() => server?.stop(true));
for (const [name, engine] of Object.entries({ chromium, webkit })) browserTest(`${name}: delayed expansion does not visibly restore previous thoughts`, async () => {
  const browser = await engine.launch(), page = await browser.newPage();
  try {
    await page.route('**/*', route => new URL(route.request().url()).origin === server.url.origin ? route.continue() : route.abort());
    await page.goto(server.url.href);
    await page.locator('#expand').click();
    await page.locator('#live').click();
    expect(await page.locator('#thought').textContent()).toBe('new live thought');
    await page.locator('#release').click();
    await page.waitForFunction(() => document.body.dataset.settled === 'true');
    expect(await page.locator('#thought').textContent()).toBe('new live thought');
  } finally { await browser.close(); }
}, 15000);
