import { afterAll, beforeAll, expect, test } from 'bun:test';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { chromium, type Browser, type Page } from 'playwright';

const optionalBrowserTest = process.env.PICLAW_RUN_OPTIONAL_BROWSER_TESTS === '1' ? test : test.skip;
let browser: Browser | null = null;
let server: ReturnType<typeof Bun.serve> | null = null;
let baseUrl = '';
let fixtureBundle = '';
let fixtureBuildDir = '';

beforeAll(async () => {
  if (process.env.PICLAW_RUN_OPTIONAL_BROWSER_TESTS !== '1') return;
  const runtimeRoot = join(import.meta.dir, '../..');
  fixtureBuildDir = await mkdtemp(join(tmpdir(), 'piclaw-post-annotation-'));
  const build = Bun.spawn([
    'bun', 'build', 'test/web/fixtures/post-annotation-fixture.ts',
    '--target=browser', '--format=esm', '--external', '#editor-vendor/codemirror',
    '--outdir', fixtureBuildDir,
  ], {
    cwd: runtimeRoot,
    stdout: 'pipe',
    stderr: 'pipe',
  });
  const [exitCode, stderr] = await Promise.all([
    build.exited,
    new Response(build.stderr).text(),
  ]);
  if (exitCode !== 0) {
    throw new Error(stderr || 'fixture build failed');
  }
  fixtureBundle = await readFile(join(fixtureBuildDir, 'post-annotation-fixture.js'), 'utf8');
  browser = await chromium.launch({ headless: true });
  const staticRoot = join(import.meta.dir, '../../web/static/classic');
  const editorVendor = join(import.meta.dir, '../../extensions/viewers/editor/vendor/codemirror.js');
  server = Bun.serve({
    port: 0,
    async fetch(request) {
      const url = new URL(request.url);
      if (url.pathname === '/') {
        return new Response(`<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover"><link rel="stylesheet" href="/css/styles.css"><script type="importmap">{"imports":{"#editor-vendor/codemirror":"/editor-vendor/codemirror.js"}}</script><style>html,body,#annotation-fixture-root{margin:0;width:100%;height:100%;background:var(--bg-primary)}.annotation-fixture{padding:140px 24px 120px}.post{max-width:720px;margin:0 auto}</style></head><body><div id="annotation-fixture-root"></div><script type="module" src="/fixture.js"></script></body></html>`, {
          headers: { 'content-type': 'text/html; charset=utf-8' },
        });
      }
      if (url.pathname === '/fixture.js') return new Response(fixtureBundle, { headers: { 'content-type': 'text/javascript' } });
      if (url.pathname === '/editor-vendor/codemirror.js') return new Response(await readFile(editorVendor), { headers: { 'content-type': 'text/javascript' } });
      if (url.pathname === '/post/1/annotations' && request.method === 'PATCH') {
        const payload = await request.json() as { annotations?: unknown[] };
        return Response.json({ annotations: payload.annotations || [] });
      }
      try {
        const body = await readFile(join(staticRoot, url.pathname));
        return new Response(body, { headers: { 'content-type': url.pathname.endsWith('.css') ? 'text/css' : 'application/octet-stream' } });
      } catch {
        return new Response('not found', { status: 404 });
      }
    },
  });
  baseUrl = server.url.href;
});

afterAll(async () => {
  await browser?.close();
  server?.stop(true);
  if (fixtureBuildDir) await rm(fixtureBuildDir, { recursive: true, force: true });
  browser = null;
  server = null;
});

async function selectFixtureText(page: Page) {
  await page.evaluate(() => {
    const content = document.querySelector('.post-content')!;
    const walker = document.createTreeWalker(content, NodeFilter.SHOW_TEXT);
    const node = walker.nextNode() as Text;
    const range = document.createRange();
    range.setStart(node, 0);
    range.setEnd(node, 'Select this text'.length);
    const selection = window.getSelection()!;
    selection.removeAllRanges();
    selection.addRange(range);
    document.dispatchEvent(new Event('selectionchange'));
  });
  await page.waitForSelector('.post-highlight-popup', { state: 'visible' });
}

optionalBrowserTest('desktop toolbar survives selection collapse during a held click', async () => {
  if (!browser) throw new Error('browser not started');
  const page = await browser.newPage({ viewport: { width: 1024, height: 768 } });
  try {
    await page.goto(baseUrl, { waitUntil: 'load' });
    await selectFixtureText(page);
    const button = page.locator('.post-highlight-color-btn').first();
    const box = await button.boundingBox();
    expect(box).toBeTruthy();

    await page.mouse.move(box!.x + box!.width / 2, box!.y + box!.height / 2);
    await page.mouse.down();
    await page.evaluate(() => {
      window.getSelection()?.removeAllRanges();
      document.dispatchEvent(new Event('selectionchange'));
    });
    await page.waitForTimeout(700);
    expect(await page.locator('.post-highlight-popup').count()).toBe(1);
    await page.mouse.up();

    await page.waitForSelector('.post-highlight-popup', { state: 'detached' });
    expect(await page.locator('mark.post-highlight').count()).toBeGreaterThan(0);
  } finally {
    await page.close();
  }
});

optionalBrowserTest('iOS toolbar docks below native selection controls with touch-sized actions', async () => {
  if (!browser) throw new Error('browser not started');
  const context = await browser.newContext({
    viewport: { width: 390, height: 844 },
    hasTouch: true,
    isMobile: true,
    userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 Mobile/15E148',
  });
  const page = await context.newPage();
  try {
    await page.goto(baseUrl, { waitUntil: 'load' });
    await selectFixtureText(page);
    const metrics = await page.evaluate(() => {
      const selection = window.getSelection()!.getRangeAt(0).getBoundingClientRect();
      const popup = document.querySelector('.post-highlight-popup')!.getBoundingClientRect();
      const button = document.querySelector('.post-highlight-color-btn')!.getBoundingClientRect();
      return {
        popupClass: document.querySelector('.post-highlight-popup')!.className,
        selectionBottom: selection.bottom,
        popupTop: popup.top,
        popupBottom: popup.bottom,
        buttonWidth: button.width,
        buttonHeight: button.height,
        viewportHeight: innerHeight,
      };
    });

    expect(metrics.popupClass).toContain('post-highlight-popup-docked');
    expect(metrics.popupTop).toBeGreaterThan(metrics.selectionBottom + 80);
    expect(metrics.viewportHeight - metrics.popupBottom).toBeGreaterThanOrEqual(8);
    expect(metrics.buttonWidth).toBeGreaterThanOrEqual(36);
    expect(metrics.buttonHeight).toBeGreaterThanOrEqual(36);

    await page.locator('.post-highlight-color-btn').first().tap();
    await page.waitForSelector('.post-highlight-popup', { state: 'detached' });
    expect(await page.locator('mark.post-highlight').count()).toBeGreaterThan(0);
  } finally {
    await context.close();
  }
});
