import { afterAll, beforeAll, expect, test } from 'bun:test';
import { join } from 'node:path';
import { chromium, webkit, type Browser } from 'playwright';
const browserTest = process.env.PICLAW_RUN_OPTIONAL_BROWSER_TESTS === '1' ? test : test.skip;
const browsers: { name: string; browser: Browser }[] = [];
let server: ReturnType<typeof Bun.serve>;
const makePosts = (chat: string, count: number) => Array.from({ length: count }, (_, index) => ({ id: (chat === 'a' ? 1000 : chat === 'b' ? 2000 : 3000) + index, type: index % 2 ? 'agent' : 'user', data: { content: `${chat.toUpperCase()} message ${index + 1}\n\n${'Synthetic message text. '.repeat(14)}`, timestamp: '2026-09-20T12:00:00Z', sender_name: 'Fixture' } }));
beforeAll(async () => {
  if (process.env.PICLAW_RUN_OPTIONAL_BROWSER_TESTS !== '1') return;
  const built = await Bun.build({ entrypoints: [join(import.meta.dir, 'fixtures/chat-return-scroll-fixture.ts')], target: 'browser', format: 'esm' });
  if (!built.success) throw new Error(built.logs.join('\n'));
  const bundle = await built.outputs[0].text();
  server = Bun.serve({ hostname: '127.0.0.1', port: 0, async fetch(req) {
    const url = new URL(req.url);
    if (url.pathname === '/fixture.js') return new Response(bundle, { headers: { 'Content-Type': 'text/javascript' } });
    if (url.pathname === '/timeline') {
      const chat = url.searchParams.get('chat_jid') || 'a';
      const count = Number(new URL(req.headers.get('referer') || 'http://fixture').searchParams.get('count')) || 30;
      await Bun.sleep(chat === 'c' || chat === 'd' ? 350 : 80);
      return Response.json({ posts: makePosts(chat, count), has_more: false });
    }
    if (url.pathname.startsWith('/static/')) return new Response(Bun.file(join(import.meta.dir, '../../web', url.pathname)));
    if (url.pathname === '/') return new Response(`<!doctype html><html><head><link rel="stylesheet" href="/static/classic/dist/app.bundle.css"><style>html,body,#app{height:100%;margin:0}.timeline{min-height:0;flex:1}.compose-box{flex:none}</style></head><body><main id="app"></main><script type="module" src="/fixture.js"></script></body></html>`, { headers: { 'Content-Type': 'text/html' } });
    return new Response(null, { status: 404 });
  } });
  browsers.push({ name: 'chromium', browser: await chromium.launch({ headless: true }) }, { name: 'webkit', browser: await webkit.launch({ headless: true }) });
});
afterAll(async () => { for (const { browser } of browsers) await browser.close(); server?.stop(true); });
for (const engine of ['chromium', 'webkit']) for (const count of [30, 120]) for (const width of [1100, 390]) browserTest(`${engine} ${width}px cached chat return resets bottom without resetting same-chat history (${count} posts)`, async () => {
  const page = await browsers.find(item => item.name === engine)!.browser.newPage({ viewport: { width, height: 780 } });
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  page.setDefaultTimeout(8_000);
  const origin = `http://127.0.0.1:${server.port}`;
  await page.route('**/*', route => new URL(route.request().url()).origin === origin ? route.continue() : route.abort());
  try {
    await page.goto(`${origin}/?count=${count}`);
    await page.waitForFunction(() => document.body.dataset.ready === 'a');
    await page.waitForTimeout(250);
    const timeline = page.locator('#fixture-timeline');
    await timeline.evaluate((node: HTMLElement) => { node.scrollTop = -900; });
    await page.waitForTimeout(150);
    const before = await timeline.evaluate((node: HTMLElement) => node.scrollTop);
    expect(before).toBeLessThan(-150);
    await page.locator('#refresh').click(); await page.waitForTimeout(250);
    expect(await timeline.evaluate((node: HTMLElement) => node.scrollTop)).toBeLessThan(-150);
    await timeline.evaluate(node => { (window as any).oldTimeline = node; });
    await page.locator('#switch-b').click();
    await page.waitForFunction(() => document.body.dataset.ready === 'b'); await page.waitForTimeout(250);
    expect(await timeline.evaluate(node => node !== (window as any).oldTimeline)).toBe(true);
    expect(Math.abs(await timeline.evaluate((node: HTMLElement) => node.scrollTop))).toBeLessThanOrEqual(2);
    await timeline.evaluate((node: HTMLElement) => { node.scrollTop = -900; }); await page.waitForTimeout(150);
    await page.locator('#switch-a').click();
    await page.waitForFunction(() => document.body.dataset.ready === 'a'); await page.waitForTimeout(250);
    expect(Math.abs(await timeline.evaluate((node: HTMLElement) => node.scrollTop))).toBeLessThanOrEqual(2);
    const newestId = 1000 + count - 1;
    await page.locator(`#post-${newestId}`).waitFor();
    expect(await page.locator(`#post-${newestId}`).evaluate(node => {
      const box = node.getBoundingClientRect(), root = document.querySelector('#fixture-timeline')!.getBoundingClientRect();
      return box.bottom >= root.top && box.top <= root.bottom;
    })).toBe(true);
    await page.locator('#search').click();
    await timeline.evaluate((node: HTMLElement) => { node.scrollTop = 500; }); await page.waitForTimeout(100);
    await timeline.evaluate(node => { (window as any).oldTimeline = node; });
    await page.locator('#refresh').click(); await page.waitForTimeout(250);
    expect(await timeline.evaluate(node => node === (window as any).oldTimeline)).toBe(true);
    expect(await timeline.evaluate((node: HTMLElement) => node.scrollTop)).toBeGreaterThan(150);
    await page.locator('#switch-c').click();
    await page.waitForFunction(() => document.body.dataset.ready === 'c'); await page.waitForTimeout(150);
    expect(Math.abs(await timeline.evaluate((node: HTMLElement) => node.scrollTop))).toBeLessThanOrEqual(2);
    await page.locator('#switch-d').click(); await page.waitForTimeout(100);
    await page.locator('#switch-a').click();
    await page.waitForFunction(() => document.body.dataset.ready === 'a'); await page.waitForTimeout(500);
    expect(Math.abs(await timeline.evaluate((node: HTMLElement) => node.scrollTop))).toBeLessThanOrEqual(2);
    expect(await page.locator('[id^="post-3"]').count()).toBe(0);
    expect(errors).toEqual([]);
  } finally { await page.close(); }
}, 30_000);
