import { expect, test } from 'bun:test';
import { resolve } from 'node:path';
import { chromium } from 'playwright';
import { handleQmdViewerRoute } from '../../../src/channels/web/http/qmd-viewer-route.js';

const ONE_PIXEL_PNG = Uint8Array.from(Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=',
  'base64',
));

test('QMD viewer rewrites and renders relative EPUB images through its asset route', async () => {
  let requestedAssetPath = '';
  const markedPath = resolve(import.meta.dir, '../../../web/static/common/js/marked.min.js');
  const server = Bun.serve({
    port: 0,
    async fetch(request) {
      const url = new URL(request.url);
      if (url.pathname === '/static/common/js/marked.min.js') {
        return new Response(Bun.file(markedPath), { headers: { 'Content-Type': 'text/javascript; charset=utf-8' } });
      }
      return await handleQmdViewerRoute(request, url.pathname, {
        fetchDocument: async () => '<img src="../assets/photo.png" alt="Relative photo" onerror="alert(1)">',
        fetchAsset: async (_reference, path) => {
          requestedAssetPath = path;
          return { bytes: ONE_PIXEL_PNG, mimeType: 'image/png' };
        },
      });
    },
  });
  const browser = await chromium.launch({ headless: true });
  try {
    const page = await browser.newPage();
    const consoleErrors: string[] = [];
    page.on('console', (message) => { if (message.type() === 'error') consoleErrors.push(message.text()); });
    const ref = 'qmd://books/book/chapters/chapter.md:41:40';
    const response = await page.goto(`http://127.0.0.1:${server.port}/qmd-viewer/?ref=${encodeURIComponent(ref)}`);
    expect(response?.status()).toBe(200);
    const image = page.locator('#content img[alt="Relative photo"]');
    await image.waitFor({ state: 'visible' });
    await image.evaluate(async (element: HTMLImageElement) => {
      if (!element.complete) await new Promise<void>((resolve) => element.addEventListener('load', () => resolve(), { once: true }));
      await element.decode();
    });
    expect(await image.evaluate((element: HTMLImageElement) => element.naturalWidth)).toBe(1);
    expect(requestedAssetPath).toBe('../assets/photo.png');
    expect(await image.getAttribute('src')).toContain('/qmd-viewer/asset?ref=');
    expect(await image.getAttribute('onerror')).toBeNull();
    expect(consoleErrors).toEqual([]);
  } finally {
    await browser.close();
    server.stop(true);
  }
}, 30_000);
