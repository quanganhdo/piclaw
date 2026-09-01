import { afterAll, beforeAll, expect, test } from 'bun:test';
import { existsSync } from 'node:fs';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { chromium, type Browser, type FrameLocator } from 'playwright';
import { handleQmdViewerRoute } from '../../../src/channels/web/http/qmd-viewer-route.js';
import { handleVaultViewerRoute } from '../../../src/channels/web/http/vault-viewer-route.js';

const UNIT_REFERENCE = 'obsidian:////workspace/vaults/learning/Learning/Staff%20Systems/Unit%2001%20-%20Product%20Contract%2C%20Boundaries%2C%20and%20State%20Ownership#Reading%20packet';
const QMD_REFERENCE = 'qmd://books/designing-data-intensive-applications-kleppmann-martin/chapters/008-summary.md:59:66';

let browser: Browser;
let bundleDirectory = '';
let bundleFile = '';

async function waitForFrameScroll(frame: FrameLocator, expected: number): Promise<number> {
  let actual = -1;
  for (let attempt = 0; attempt < 50; attempt += 1) {
    actual = await frame.locator('body').evaluate(() => window.scrollY);
    if (Math.abs(actual - expected) <= 3) return actual;
    await Bun.sleep(20);
  }
  return actual;
}

beforeAll(async () => {
  bundleDirectory = await mkdtemp(join(tmpdir(), 'document-viewer-pane-'));
  const entry = join(bundleDirectory, 'entry.ts');
  const paneModule = resolve(import.meta.dir, '../../../web/src/panes/document-viewer-pane.ts');
  await writeFile(entry, `
    import { DocumentViewerInstance } from ${JSON.stringify(paneModule)};
    const pane = document.getElementById('pane');
    new DocumentViewerInstance(pane, { path: ${JSON.stringify(UNIT_REFERENCE)}, mode: 'view' });
  `);
  const result = await Bun.build({
    entrypoints: [entry],
    outdir: bundleDirectory,
    target: 'browser',
    format: 'esm',
    plugins: [{
      name: 'typescript-js-specifiers',
      setup(build) {
        build.onResolve({ filter: /^\.{1,2}\/.*\.js$/ }, (args) => {
          const candidate = resolve(dirname(args.importer), args.path.replace(/\.js$/, '.ts'));
          return existsSync(candidate) ? { path: candidate } : undefined;
        });
      },
    }],
  });
  if (!result.success) throw new Error(result.logs.map(String).join('\n'));
  bundleFile = result.outputs[0]?.path || join(bundleDirectory, 'entry.js');
  browser = await chromium.launch({ headless: true });
});

afterAll(async () => {
  await browser?.close();
  if (bundleDirectory) await rm(bundleDirectory, { recursive: true, force: true });
});

for (const viewport of [
  { name: 'desktop', width: 1280, height: 800 },
  { name: 'mobile', width: 390, height: 844 },
]) {
  test(`document pane history crosses Vault and QMD on ${viewport.name}`, async () => {
    const markedPath = resolve(import.meta.dir, '../../../web/static/common/js/marked.min.js');
    const vaultMarkdown = [
      '# Unit 01 - Product Contract, Boundaries, and State Ownership',
      '## Reading packet',
      `[Designing Data-Intensive Applications](${QMD_REFERENCE})`,
      ...Array.from({ length: 100 }, (_, index) => `Vault paragraph ${index + 1}: bounded test content for scroll restoration.`),
    ].join('\n\n');
    const qmdMarkdown = ['# Thinking About Data Systems', ...Array.from({ length: 100 }, (_, index) => `Paragraph ${index + 1}: bounded test content for QMD scroll restoration.`)].join('\n\n');
    const server = Bun.serve({
      port: 0,
      async fetch(request) {
        const url = new URL(request.url);
        if (url.pathname === '/') {
          return new Response('<!doctype html><meta charset="utf-8"><style>html,body,#pane{width:100%;height:100%;margin:0}body{overflow:hidden}</style><div id="pane"></div><script type="module" src="/entry.js"></script>', { headers: { 'Content-Type': 'text/html; charset=utf-8' } });
        }
        if (url.pathname === '/entry.js') return new Response(Bun.file(bundleFile), { headers: { 'Content-Type': 'text/javascript; charset=utf-8' } });
        if (url.pathname === '/static/common/js/marked.min.js') return new Response(Bun.file(markedPath), { headers: { 'Content-Type': 'text/javascript; charset=utf-8' } });
        if (url.pathname.startsWith('/vault-viewer')) {
          return await handleVaultViewerRoute(request, url.pathname, { fetchDocument: async () => vaultMarkdown });
        }
        if (url.pathname.startsWith('/qmd-viewer')) {
          return await handleQmdViewerRoute(request, url.pathname, { fetchDocument: async () => qmdMarkdown });
        }
        return new Response('Not Found', { status: 404 });
      },
    });

    const page = await browser.newPage({ viewport });
    try {
      await page.goto(`http://127.0.0.1:${server.port}/`);
      const frame = page.frameLocator('#pane iframe');
      await frame.locator('#reading-packet').waitFor({ state: 'visible' });
      const back = page.locator('[data-document-history="back"]');
      const forward = page.locator('[data-document-history="forward"]');
      expect(await back.isDisabled()).toBe(true);
      expect(await forward.isDisabled()).toBe(true);
      const initialUrl = page.url();
      const initialBrowserHistory = await page.evaluate(() => history.length);

      await frame.locator('body').evaluate(() => window.scrollTo(0, 420));
      await frame.locator('body').evaluate(() => new Promise<void>((done) => requestAnimationFrame(() => done())));
      const qmdLink = frame.locator('a', { hasText: 'Designing Data-Intensive Applications' });
      expect(await qmdLink.getAttribute('href')).toBe(QMD_REFERENCE);
      await qmdLink.evaluate((element: HTMLAnchorElement) => element.click());
      await frame.locator('h1', { hasText: 'Thinking About Data Systems' }).waitFor({ state: 'visible' });
      expect(await back.isDisabled()).toBe(false);
      expect(await forward.isDisabled()).toBe(true);
      expect(page.url()).toBe(initialUrl);
      expect(await page.evaluate(() => history.length)).toBe(initialBrowserHistory);

      await frame.locator('body').evaluate(() => window.scrollTo(0, 500));
      await frame.locator('body').evaluate(() => new Promise<void>((done) => requestAnimationFrame(() => done())));
      await back.click();
      await frame.locator('h1', { hasText: 'Unit 01 - Product Contract, Boundaries, and State Ownership' }).waitFor({ state: 'visible' });
      expect(Math.abs((await waitForFrameScroll(frame, 420)) - 420)).toBeLessThanOrEqual(3);
      expect(await forward.isDisabled()).toBe(false);

      await forward.click();
      await frame.locator('h1', { hasText: 'Thinking About Data Systems' }).waitFor({ state: 'visible' });
      expect(Math.abs((await waitForFrameScroll(frame, 500)) - 500)).toBeLessThanOrEqual(3);
      await frame.locator('body').evaluate(() => document.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowLeft', altKey: true, bubbles: true })));
      await frame.locator('h1', { hasText: 'Unit 01 - Product Contract, Boundaries, and State Ownership' }).waitFor({ state: 'visible' });

      await page.reload();
      await frame.locator('#reading-packet').waitFor({ state: 'visible' });
      expect(await back.isDisabled()).toBe(true);
      expect(await forward.isDisabled()).toBe(true);
    } finally {
      await page.close();
      server.stop(true);
    }
  }, 60_000);
}
