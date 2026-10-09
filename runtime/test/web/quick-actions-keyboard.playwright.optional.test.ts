import { beforeAll, afterAll, expect, test } from 'bun:test';
import { join } from 'node:path';
import { chromium, webkit } from 'playwright';
const enabled = process.env.PICLAW_RUN_OPTIONAL_BROWSER_TESTS === '1';
const browserTest = enabled ? test : test.skip;
let server: ReturnType<typeof Bun.serve>;
beforeAll(async () => {
  if (!enabled) return;
  const build = await Bun.build({ entrypoints: [join(import.meta.dir, 'fixtures/quick-actions-keyboard-fixture.ts')], target: 'browser', format: 'esm' });
  if (!build.success) throw Error(build.logs.join('\n'));
  const js = await build.outputs[0].text();
  server = Bun.serve({ hostname: '127.0.0.1', port: 0, fetch(req) {
    const path = new URL(req.url).pathname;
    if (path === '/fixture.js') return new Response(js, { headers: { 'content-type': 'text/javascript' } });
    if (path === '/agent/settings/quick-actions') return Response.json({});
    if (path === '/agent/commands') return Response.json({ commands: [] });
    return new Response('<!doctype html><div id="root"></div><div class="timeline"><div id="post" tabindex="0">Timeline content</div></div><script type="module" src="/fixture.js"></script>', { headers: { 'content-type': 'text/html' } });
  } });
}, 30000);
afterAll(() => server?.stop(true));
for (const [name, engine] of Object.entries({ chromium, webkit })) {
  browserTest(`${name}: handled/repeated keys leave Quick actions closed; ordinary typing opens it`, async () => {
    const browser = await engine.launch();
    const page = await browser.newPage();
    try {
      await page.route('**/*', route => new URL(route.request().url()).origin === server.url.origin ? route.continue() : route.abort());
      await page.goto(server.url.toString());
      await page.waitForFunction(() => (window as any).keyboardFixtureReady);
      await page.waitForTimeout(50);
      const dispatch = async (flags: { consumed?: boolean; repeat?: boolean; isComposing?: boolean; ctrlKey?: boolean }) => {
        await page.evaluate(flags => {
          (window as any).consumeKey = !!flags.consumed;
          document.getElementById('post')!.dispatchEvent(new KeyboardEvent('keydown', { key: 'g', bubbles: true, cancelable: true, repeat: !!flags.repeat, isComposing: !!flags.isComposing, ctrlKey: !!flags.ctrlKey }));
        }, flags);
        // Allow Preact's render/effect cycle before testing the closed state.
        await page.evaluate(() => new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))));
      };
      for (const flags of [{ consumed: true }, { repeat: true }, { isComposing: true }, { ctrlKey: true }]) {
        await dispatch(flags);
        expect(await page.locator('.timeline-quick-actions').count()).toBe(0);
      }
      await dispatch({});
      await page.locator('.timeline-quick-actions').waitFor();
      expect(await page.locator('.timeline-quick-actions input').inputValue()).toBe('g');
    } finally { await browser.close(); }
  }, 30000);
}
