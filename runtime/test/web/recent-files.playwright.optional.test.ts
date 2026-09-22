import { afterAll, beforeAll, expect, test } from 'bun:test';
import { join } from 'node:path';
import { chromium, webkit, type Browser } from 'playwright';
const enabled = process.env.PICLAW_RUN_OPTIONAL_BROWSER_TESTS === '1';
const browserTest = enabled ? test : test.skip;
let server: ReturnType<typeof Bun.serve>;
const browsers: { name: string; browser: Browser }[] = [];
beforeAll(async () => {
  if (!enabled) return;
  const built = await Bun.build({ entrypoints: [join(import.meta.dir, 'fixtures/recent-files-fixture.ts')], target: 'browser', format: 'esm' });
  if (!built.success) throw new Error(built.logs.join('\n'));
  const script = await built.outputs[0].text();
  server = Bun.serve({ hostname: '127.0.0.1', port: 0, fetch(req) {
    const url = new URL(req.url);
    if (url.pathname === '/fixture.js') return new Response(script, { headers: { 'Content-Type': 'text/javascript' } });
    if (url.pathname === '/workspace/tree') return Response.json({ root: { name: 'workspace', path: '.', type: 'dir', children: [] }, truncated: false });
    if (url.pathname === '/workspace/index-status') return Response.json({ status: 'idle' });
    if (url.pathname === '/workspace/stat') {
      const path = url.searchParams.get('path');
      if (path === 'gone.md') return Response.json({ error: 'File not found', code: 'FILE_NOT_FOUND' }, { status: 404 });
      if (path === 'denied.md') return Response.json({ error: 'File access denied' }, { status: 403 });
      if (path === 'server.md') return Response.json({ error: 'Temporary failure' }, { status: 500 });
      return Response.json({ path, size: 20, mtime: 'fixture' });
    }
    if (url.pathname.startsWith('/static/')) return new Response(Bun.file(join(import.meta.dir, '../../web', url.pathname)));
    if (url.pathname === '/') return new Response('<!doctype html><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="/static/classic/dist/app.bundle.css"><div id="app"></div><script type="module" src="/fixture.js"></script>', { headers: { 'Content-Type': 'text/html' } });
    return new Response(null, { status: 404 });
  } });
  browsers.push({ name: 'chromium', browser: await chromium.launch({ headless: true }) }, { name: 'webkit', browser: await webkit.launch({ headless: true }) });
});
afterAll(async () => { for (const { browser } of browsers) await browser.close(); server?.stop(true); });
for (const engine of ['chromium', 'webkit']) for (const surface of ['workspace', 'timeline']) for (const width of [1100, 390]) {
  browserTest(`${engine} ${surface} ${width}px recents prune only confirmed missing files`, async () => {
    const page = await browsers.find(x => x.name === engine)!.browser.newPage({ viewport: { width, height: 780 } });
    const errors: string[] = []; const probes: string[] = [];
    page.on('pageerror', error => errors.push(error.message));
    page.on('request', req => { if (new URL(req.url()).pathname === '/workspace/stat') probes.push(new URL(req.url()).searchParams.get('path')!); });
    page.setDefaultTimeout(8000);
    const origin = `http://127.0.0.1:${server.port}`;
    await page.route('**/*', route => new URL(route.request().url()).origin === origin ? route.continue() : route.abort());
    try {
      await page.goto(origin + '/?surface=' + surface);
      await page.evaluate(() => localStorage.setItem('piclaw_recent_files', JSON.stringify(['gone.md', 'keep.md', 'denied.md', 'server.md'])));
      const trigger = page.locator('[data-testid="hamburger"]');
      await trigger.click();
      expect(await page.locator('.timeline-menu-portal').evaluate(node => node.classList.contains('in-workspace'))).toBe(surface === 'workspace');
      expect(probes).toEqual([]); // no startup/menu-open sweep
      await page.locator('button[title="gone.md"]').click();
      await page.waitForFunction(() => !JSON.parse(localStorage.getItem('piclaw_recent_files')!).includes('gone.md'));
      expect(await page.evaluate(() => (window as any).opened)).toEqual([]);
      await trigger.click(); expect(await page.locator('button[title="gone.md"]').count()).toBe(0);
      await page.locator('button[title="keep.md"]').click();
      await page.waitForFunction(() => (window as any).opened.includes('keep.md'));
      for (const path of ['denied.md', 'server.md']) {
        await trigger.click(); await page.locator(`button[title="${path}"]`).click();
        await page.waitForFunction(p => (window as any).opened.includes(p), path);
        expect(await page.evaluate(p => JSON.parse(localStorage.getItem('piclaw_recent_files')!).includes(p), path)).toBe(true);
      }
      await page.reload(); await trigger.click();
      expect(await page.locator('button[title="gone.md"]').count()).toBe(0);
      expect(await page.locator('button[title="keep.md"]').count()).toBe(1);
      expect(probes).toEqual(['gone.md', 'keep.md', 'denied.md', 'server.md']);
      await trigger.click();
      await page.waitForFunction(() => document.querySelector('[data-testid="hamburger"]')?.getAttribute('aria-expanded') === 'false');
      await page.evaluate(() => localStorage.setItem('piclaw_recent_files', JSON.stringify(['gone.md'])));
      await trigger.click();
      await page.locator('button[title="gone.md"]').focus(); await page.keyboard.press('Enter');
      await page.waitForFunction(() => JSON.parse(localStorage.getItem('piclaw_recent_files')!).length === 0);
      await trigger.click();
      expect(await page.getByText('Open Recent', { exact: true }).count()).toBe(0);
      expect(probes.at(-1)).toBe('gone.md');
      expect(errors).toEqual([]);
    } finally { await page.close(); }
  }, 20_000);
}
