import { expect, test } from 'bun:test';
import { resolve } from 'node:path';
import { chromium } from 'playwright';
import { handleVaultViewerRoute } from '../../../src/channels/web/http/vault-viewer-route.js';

const UNIT_REFERENCE = 'obsidian:////workspace/vaults/learning/Learning/Staff%20Systems/Unit%2001%20-%20Product%20Contract%2C%20Boundaries%2C%20and%20State%20Ownership#Reading%20packet';
const ONE_PIXEL_PNG = Uint8Array.from(Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=',
  'base64',
));

for (const viewport of [
  { name: 'desktop', width: 1280, height: 800 },
  { name: 'mobile', width: 390, height: 844 },
]) {
  test(`learning-vault viewer renders Unit 1 wiki links and heading navigation on ${viewport.name}`, async () => {
    const markedPath = resolve(import.meta.dir, '../../../web/static/common/js/marked.min.js');
    const server = Bun.serve({
      port: 0,
      async fetch(request) {
        const url = new URL(request.url);
        if (url.pathname === '/static/common/js/marked.min.js') {
          return new Response(Bun.file(markedPath), { headers: { 'Content-Type': 'text/javascript; charset=utf-8' } });
        }
        return await handleVaultViewerRoute(request, url.pathname);
      },
    });
    const browser = await chromium.launch({ headless: true });
    try {
      const page = await browser.newPage({ viewport });
      const consoleErrors: string[] = [];
      page.on('console', (message) => { if (message.type() === 'error') consoleErrors.push(message.text()); });
      const response = await page.goto(`http://127.0.0.1:${server.port}/vault-viewer/?ref=${encodeURIComponent(UNIT_REFERENCE)}`);
      expect(response?.status()).toBe(200);

      const readingPacket = page.locator('#reading-packet');
      const back = page.locator('#back');
      const forward = page.locator('#forward');
      await readingPacket.waitFor({ state: 'visible' });
      expect(await readingPacket.evaluate((element) => Math.abs(element.getBoundingClientRect().top))).toBeLessThan(80);
      expect(await back.isDisabled()).toBe(true);
      expect(await forward.isDisabled()).toBe(true);
      const initialBrowserHistoryLength = await page.evaluate(() => history.length);
      const initialViewerUrl = page.url();

      await page.evaluate(() => window.scrollTo(0, 420));
      await page.waitForFunction(() => Math.abs(window.scrollY - 420) < 3);
      const wikiLink = page.locator('#content a', { hasText: 'What system design means here' }).first();
      expect(await wikiLink.getAttribute('href')).toContain(
        'obsidian:////workspace/vaults/learning/Learning/System%20Design%20for%20a%20Senior%20iOS%20Engineer#What%20system%20design%20means%20here',
      );
      await wikiLink.evaluate((element: HTMLAnchorElement) => element.click());
      const targetHeading = page.locator('#what-system-design-means-here');
      await targetHeading.waitFor({ state: 'visible' });
      expect(await targetHeading.evaluate((element) => Math.abs(element.getBoundingClientRect().top))).toBeLessThan(80);
      expect(await back.isDisabled()).toBe(false);
      expect(await forward.isDisabled()).toBe(true);
      expect(await page.evaluate(() => history.length)).toBe(initialBrowserHistoryLength);
      expect(page.url()).toBe(initialViewerUrl);

      await page.evaluate(() => window.scrollTo(0, 500));
      await page.waitForFunction(() => Math.abs(window.scrollY - 500) < 3);
      await back.click();
      await page.locator('h1', { hasText: 'Unit 01 - Product Contract, Boundaries, and State Ownership' }).waitFor({ state: 'visible' });
      await page.waitForFunction(() => Math.abs(window.scrollY - 420) < 3);
      expect(await back.isDisabled()).toBe(true);
      expect(await forward.isDisabled()).toBe(false);

      await forward.click();
      await targetHeading.waitFor({ state: 'visible' });
      await page.waitForFunction(() => Math.abs(window.scrollY - 500) < 3);
      await page.keyboard.press('Alt+ArrowLeft');
      await page.locator('h1', { hasText: 'Unit 01 - Product Contract, Boundaries, and State Ownership' }).waitFor({ state: 'visible' });
      await page.keyboard.press('Alt+ArrowRight');
      await targetHeading.waitFor({ state: 'visible' });
      expect(await page.locator('main').evaluate((element) => element.scrollWidth <= element.clientWidth)).toBe(true);

      await page.goto(initialViewerUrl);
      await readingPacket.waitFor({ state: 'visible' });
      expect(await back.isDisabled()).toBe(true);
      expect(await forward.isDisabled()).toBe(true);
      expect(consoleErrors).toEqual([]);
    } finally {
      await browser.close();
      server.stop(true);
    }
  }, 30_000);
}

test('learning-vault viewer routes relative resources and strips unsafe image attributes', async () => {
  const markedPath = resolve(import.meta.dir, '../../../web/static/common/js/marked.min.js');
  const requestedAssets: string[] = [];
  const server = Bun.serve({
    port: 0,
    async fetch(request) {
      const url = new URL(request.url);
      if (url.pathname === '/static/common/js/marked.min.js') {
        return new Response(Bun.file(markedPath), { headers: { 'Content-Type': 'text/javascript; charset=utf-8' } });
      }
      return await handleVaultViewerRoute(request, url.pathname, {
        fetchDocument: async () => '<img src="assets/photo.png" alt="Relative photo" onerror="alert(1)">\n\n[Handout](assets/handout.pdf)',
        fetchAsset: async (_reference, path) => {
          requestedAssets.push(path);
          return { bytes: ONE_PIXEL_PNG, mimeType: 'image/png' };
        },
      });
    },
  });
  const browser = await chromium.launch({ headless: true });
  try {
    const page = await browser.newPage();
    await page.goto(`http://127.0.0.1:${server.port}/vault-viewer/?ref=${encodeURIComponent(UNIT_REFERENCE)}`);
    const image = page.locator('img[alt="Relative photo"]');
    await image.waitFor({ state: 'visible' });
    expect(await image.getAttribute('src')).toContain('/vault-viewer/asset?ref=');
    expect(await image.getAttribute('onerror')).toBeNull();
    expect(await page.locator('a', { hasText: 'Handout' }).getAttribute('href')).toContain('/vault-viewer/asset?ref=');
    expect(requestedAssets).toContain('assets/photo.png');
  } finally {
    await browser.close();
    server.stop(true);
  }
}, 30_000);
