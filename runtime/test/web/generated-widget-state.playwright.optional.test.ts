import { afterAll, beforeAll, expect, test } from 'bun:test';
import { chromium, webkit, type Browser, type Frame, type Page } from 'playwright';
import { join } from 'node:path';
import { buildWidgetSrcDoc as buildCandidateSrcDoc, getGeneratedWidgetHostWindowName, getGeneratedWidgetInitPayload, getGeneratedWidgetHostPayload } from '../../web/src/ui/generated-widget.js';

const enabled = process.env.PICLAW_RUN_OPTIONAL_BROWSER_TESTS === '1';
const browserTest = enabled ? test : test.skip;
const browsers: { name: string; browser: Browser }[] = [];
let server: ReturnType<typeof Bun.serve>;
const baseline = process.env.PICLAW_WIDGET_POLLING_BASELINE === '1';
const buildWidgetSrcDoc = enabled && baseline
  ? (await import(join(import.meta.dir, '../../../.artifacts/widget-state/baseline-widget.ts'))).buildWidgetSrcDoc
  : buildCandidateSrcDoc;
const widget = { title: 'Fixture widget', widgetId: 'fixture-widget', toolCallId: 'fixture-tool', turnId: 'fixture-turn', source: 'live', status: 'streaming', runtimeState: { count: 0 }, artifact: { kind: 'html', html: '<p>Fixture content</p>' } };
const instrumentation = `<script>
window.fixtureCounts = { interval: 0, parses: 0, raf: 0, events: [] };
const interval = window.setInterval.bind(window);
window.setInterval = (fn, delay) => interval(() => { window.fixtureCounts.interval++; fn(); }, delay);
const parse = JSON.parse;
JSON.parse = (...args) => { window.fixtureCounts.parses++; return parse(...args); };
const raf = window.requestAnimationFrame.bind(window);
window.requestAnimationFrame = fn => raf(time => { window.fixtureCounts.raf++; fn(time); });
addEventListener('piclaw:widget-message', e => window.fixtureCounts.events.push(e.detail));
</script>`;
const srcdoc = () => buildWidgetSrcDoc(widget).replace('<head>', '<head>' + instrumentation);

beforeAll(async () => {
  if (!enabled) return;
  const bundle = await Bun.build({ entrypoints: [join(import.meta.dir, 'fixtures/generated-widget-state-fixture.ts')], bundle: true, target: 'browser' });
  if (!bundle.success) throw new Error('Widget fixture bundle failed: ' + bundle.logs.join('\n'));
  server = Bun.serve({ hostname: '127.0.0.1', port: 0, fetch(req) {
    const path = new URL(req.url).pathname;
    if (path === '/pane.js') return new Response(bundle.outputs[0], { headers: { 'content-type': 'text/javascript' } });
    if (path === '/pane') return new Response('<!doctype html><title>Disposable widget pane</title><div id="app"></div><script type="module" src="/pane.js"></script>', { headers: { 'content-type': 'text/html' } });
    if (path !== '/') return new Response(null, { status: 404 });
    return new Response('<!doctype html><title>Disposable widget host</title><main></main>', { headers: { 'content-type': 'text/html' } });
  } });
  browsers.push({ name: 'chromium', browser: await chromium.launch({ headless: true }) }, { name: 'webkit', browser: await webkit.launch({ headless: true }) });
}, 30000);
afterAll(async () => { for (const { browser } of browsers) await browser.close(); server?.stop(true); });

async function tick(page: Page, ms = 40) { await page.clock.runFor(ms); await page.evaluate(() => new Promise<void>(resolve => queueMicrotask(resolve))); }
async function open(engine: string, opaque = false) {
  const page = await browsers.find(b => b.name === engine)!.browser.newPage();
  const errors: string[] = [];
  page.on('pageerror', e => errors.push(e.message));
  page.setDefaultTimeout(4000);
  await page.clock.install({ time: new Date('2030-01-01T00:00:00Z') });
  await page.route('**/*', r => new URL(r.request().url()).origin === server.url.origin ? r.continue() : r.abort());
  await page.goto(server.url.toString());
  await mount(page, opaque);
  const frame = page.frames().find(f => f !== page.mainFrame())!;
  await frame.waitForFunction(() => Boolean((window as any).piclawWidget?.hostState));
  return { page, frame, errors };
}
async function mount(page: Page, opaque = false) {
  await page.evaluate(({ html, name, opaque }) => {
    const iframe = document.createElement('iframe');
    iframe.name = name;
    iframe.sandbox.value = opaque ? 'allow-scripts' : 'allow-scripts allow-same-origin';
    iframe.srcdoc = html;
    document.querySelector('main')!.append(iframe);
  }, { html: srcdoc(), name: getGeneratedWidgetHostWindowName(widget), opaque });
  const frame = page.frames().find(f => f !== page.mainFrame())!;
  await frame.waitForFunction(() => Boolean((window as any).piclawWidget));
  await tick(page, 300);
}
const counts = (frame: Frame) => frame.evaluate(() => ({ ...(window as any).fixtureCounts }));
const state = (frame: Frame) => frame.evaluate(() => (window as any).piclawWidget.hostState);
async function nameUpdate(page: Page, count: number) {
  await page.evaluate(name => { document.querySelector('iframe')!.name = name; }, getGeneratedWidgetHostWindowName({ ...widget, runtimeState: { count } }));
  await tick(page, 300);
}
async function message(page: Page, type: string, payload: unknown, widgetId = widget.widgetId) {
  await page.evaluate(data => document.querySelector('iframe')!.contentWindow!.postMessage(data, '*'), { __piclawGeneratedWidgetHost: true, type, widgetId, toolCallId: widget.toolCallId, turnId: widget.turnId, payload });
  // Flush the real postMessage task before advancing the frame's scheduled RAF.
  await page.waitForTimeout(20);
  await tick(page);
}
for (const engine of ['chromium', 'webkit']) {
  browserTest(`${engine} settled widget callback measurement with the real browser clock`, async () => {
    const page = await browsers.find(b => b.name === engine)!.browser.newPage();
    const errors: string[] = []; page.on('pageerror', e => errors.push(e.message));
    try {
      await page.route('**/*', r => new URL(r.request().url()).origin === server.url.origin ? r.continue() : r.abort());
      await page.goto(server.url.toString());
      await page.evaluate(({ html, name }) => {
        const frame = document.createElement('iframe'); frame.name = name;
        frame.sandbox.value = 'allow-scripts allow-same-origin'; frame.srcdoc = html; document.querySelector('main')!.append(frame);
      }, { html: srcdoc(), name: getGeneratedWidgetHostWindowName(widget) });
      const frame = page.frames().find(f => f !== page.mainFrame())!;
      await frame.waitForFunction(() => Boolean((window as any).piclawWidget?.hostState));
      await page.waitForTimeout(1000);
      const before = await counts(frame); const started = performance.now();
      await page.waitForTimeout(10000);
      const elapsed = performance.now() - started; const after = await counts(frame);
      console.log(JSON.stringify({ engine, baseline, clock: 'real', elapsedMs: elapsed, interval: after.interval - before.interval, parses: after.parses - before.parses, raf: after.raf - before.raf }));
      if (baseline) expect(after.interval - before.interval).toBeGreaterThan(0);
      else expect(after.interval - before.interval).toBe(0);
      expect(after.parses - before.parses).toBe(0); expect(after.raf - before.raf).toBe(0);
      expect(errors).toEqual([]);
    } finally { await page.close(); }
  }, 20000);
  browserTest(`${engine} mounted FloatingWidgetPane keeps updates, actions, replacement and reopen functional`, async () => {
    const page = await browsers.find(b => b.name === engine)!.browser.newPage();
    const errors: string[] = []; page.on('pageerror', e => errors.push(e.message));
    try {
      await page.route('**/*', r => new URL(r.request().url()).origin === server.url.origin ? r.continue() : r.abort());
      await page.goto(new URL('pane', server.url).toString());
      await page.locator('iframe').waitFor();
      let frame = page.frames().find(f => f !== page.mainFrame())!;
      await frame.waitForFunction(() => (window as any).piclawWidget?.hostState?.runtimeState?.count === 0);
      await page.locator('#update').click();
      await frame.waitForFunction(() => (window as any).piclawWidget?.hostState?.runtimeState?.count === 1);
      expect((await state(frame)).runtimeState).toEqual({ count: 1 });
      await frame.evaluate(() => { (window as any).piclawWidget.ready({ reason: 'fixture' }); (window as any).piclawWidget.submit({ text: 'Synthetic submission' }); (window as any).piclawWidget.requestRefresh({ reason: 'fixture' }); });
      await page.waitForFunction(() => (window as any).widgetPaneFixture.received.some(e => e.kind === 'widget.request_refresh'));
      const received = await page.evaluate(() => (window as any).widgetPaneFixture.received);
      expect(received.some(e => e.kind === 'widget.ready' && e.payload.reason === 'fixture')).toBe(true);
      expect(received.some(e => e.kind === 'widget.submit' && e.payload.text === 'Synthetic submission')).toBe(true);
      await page.locator('#replace').click();
      await page.frameLocator('iframe').locator('p').filter({ hasText: 'Replacement content' }).waitFor();
      frame = page.frames().find(f => f !== page.mainFrame())!;
      await frame.waitForFunction(() => (window as any).piclawWidget?.hostState?.runtimeState?.count === 1);
      await page.locator('.floating-widget-close').click();
      expect(await page.locator('iframe').count()).toBe(0);
      await page.locator('#open').click();
      await page.frameLocator('iframe').locator('p').filter({ hasText: 'Replacement content' }).waitFor();
      frame = page.frames().find(f => f !== page.mainFrame())!;
      await frame.waitForFunction(() => (window as any).piclawWidget?.hostState?.runtimeState?.count === 1);
      await page.locator('#update').click();
      await frame.waitForFunction(() => (window as any).piclawWidget?.hostState?.runtimeState?.count === 2);
      expect((await state(frame)).runtimeState).toEqual({ count: 2 });
      expect(errors).toEqual([]);
    } finally { await page.close(); }
  }, 20000);
  browserTest(`${engine} widget name-only delivery has no settled polling or repeated parsing`, async () => {
    const { page, frame, errors } = await open(engine);
    try {
      expect(await state(frame)).toEqual(getGeneratedWidgetHostPayload(widget));
      const before = await counts(frame); await tick(page, 60000); const after = await counts(frame);
      console.log(JSON.stringify({ engine, baseline, windowMs: 60000, interval: after.interval - before.interval, parses: after.parses - before.parses, raf: after.raf - before.raf }));
      expect(after.interval - before.interval).toBe(baseline ? 240 : 0);
      expect(after.parses - before.parses).toBe(0);
      expect(after.events.length).toBe(before.events.length);
      await nameUpdate(page, 1);
      expect((await state(frame)).runtimeState).toEqual({ count: baseline ? 0 : 1 });
      const changed = await counts(frame);
      await nameUpdate(page, 1);
      expect((await counts(frame)).events.length).toBe(changed.events.length);
      expect((await counts(frame)).parses).toBe(changed.parses);
      await page.evaluate(() => { document.querySelector('iframe')!.name = '__PICLAW_WIDGET_HOST__:{malformed'; });
      await tick(page, 300); expect((await state(frame)).runtimeState).toEqual({ count: baseline ? 0 : 1 });
      await nameUpdate(page, 2); expect((await state(frame)).runtimeState).toEqual({ count: baseline ? 0 : 2 });
      expect(errors).toEqual([]);
    } finally { await page.close(); }
  }, 20000);
  browserTest(`${engine} widget messages retain init merging, filtering, and frame coalescing`, async () => {
    const { page, frame, errors } = await open(engine);
    try {
      await message(page, 'widget.update', getGeneratedWidgetHostPayload({ ...widget, runtimeState: { count: 3 } }));
      await message(page, 'widget.init', getGeneratedWidgetInitPayload(widget));
      expect((await state(frame)).runtimeState).toEqual({ count: 3 });
      const before = (await counts(frame)).events.length;
      await message(page, 'widget.update', { bad: true }, 'other-widget');
      expect((await counts(frame)).events.length).toBe(before);
      const payload = getGeneratedWidgetHostPayload({ ...widget, runtimeState: { count: 4 } });
      await message(page, 'widget.update', payload);
      const delivered = (await counts(frame)).events.length;
      await message(page, 'widget.update', payload);
      expect((await counts(frame)).events.length).toBe(delivered);
      const beforeBurst = (await counts(frame)).events.length;
      await frame.evaluate(() => {
        for (const count of [5, 6]) window.dispatchEvent(new MessageEvent('message', { data: { __piclawGeneratedWidgetHost: true, widgetId: 'fixture-widget', type: 'widget.update', payload: { runtimeState: { count } } } }));
      });
      await tick(page);
      expect((await state(frame)).runtimeState).toEqual({ count: 6 });
      expect((await counts(frame)).events.length - beforeBurst).toBe(1);
      await message(page, 'widget.complete', { ...payload, status: 'final' });
      expect((await state(frame)).status).toBe('final');
      await message(page, 'widget.error', { ...payload, error: 'Fixture failure' });
      expect((await state(frame)).error).toBe('Fixture failure');
      expect(errors).toEqual([]);
    } finally { await page.close(); }
  }, 20000);
  browserTest(`${engine} widget opaque-frame fallback and page lifecycle retain state delivery`, async () => {
    const { page, frame, errors } = await open(engine, true);
    try {
      expect(await frame.evaluate(() => window.origin)).toBe('null');
      const before = await counts(frame); await tick(page, 1000);
      expect((await counts(frame)).interval - before.interval).toBe(4);
      await frame.evaluate(name => { window.name = name; }, getGeneratedWidgetHostWindowName({ ...widget, runtimeState: { count: 7 } }));
      await tick(page, 300); expect((await state(frame)).runtimeState).toEqual({ count: 7 });
      await frame.evaluate(() => window.dispatchEvent(new PageTransitionEvent('pagehide', { persisted: true })));
      const paused = await counts(frame); await tick(page, 1000);
      expect((await counts(frame)).interval - paused.interval).toBe(baseline ? 4 : 0);
      await frame.evaluate(() => { window.dispatchEvent(new PageTransitionEvent('pageshow', { persisted: true })); window.dispatchEvent(new PageTransitionEvent('pageshow', { persisted: true })); });
      await tick(page, 300); const resumed = await counts(frame); await tick(page, 1000);
      expect((await counts(frame)).interval - resumed.interval).toBe(4);
      await frame.evaluate(name => { window.name = name; }, getGeneratedWidgetHostWindowName({ ...widget, runtimeState: { count: 8 } }));
      await tick(page, 300); expect((await state(frame)).runtimeState).toEqual({ count: 8 });
      expect(errors).toEqual([]);
    } finally { await page.close(); }
  }, 20000);
  browserTest(`${engine} widget pagehide cancels queued delivery and pageshow observes the latest name`, async () => {
    const { page, frame, errors } = await open(engine);
    try {
      await frame.evaluate(() => {
        window.dispatchEvent(new MessageEvent('message', { data: { __piclawGeneratedWidgetHost: true, widgetId: 'fixture-widget', type: 'widget.update', payload: { cancelled: true } } }));
        window.dispatchEvent(new PageTransitionEvent('pagehide', { persisted: true }));
      });
      const before = (await counts(frame)).events.length;
      await nameUpdate(page, 12);
      expect((await counts(frame)).events.length - before).toBe(baseline ? 1 : 0);
      await frame.evaluate(() => {
        window.dispatchEvent(new PageTransitionEvent('pageshow', { persisted: true }));
        window.dispatchEvent(new PageTransitionEvent('pageshow', { persisted: true }));
      });
      await tick(page, 300);
      if (!baseline) expect((await state(frame)).runtimeState).toEqual({ count: 12 });
      const resumed = await counts(frame); await nameUpdate(page, 13);
      if (!baseline) expect((await counts(frame)).events.length - resumed.events.length).toBe(1);
      expect(errors).toEqual([]);
    } finally { await page.close(); }
  }, 20000);
  browserTest(`${engine} widget removal and reopen uses a fresh bridge`, async () => {
    const { page, frame, errors } = await open(engine);
    try {
      await nameUpdate(page, 9);
      await page.evaluate(() => document.querySelector('iframe')!.remove());
      expect(frame.isDetached()).toBe(true);
      await tick(page, 1000); await mount(page);
      const next = page.frames().find(f => f !== page.mainFrame())!;
      expect((await state(next)).runtimeState).toEqual({ count: 0 });
      const before = await counts(next); await tick(page, 1000);
      expect((await counts(next)).interval - before.interval).toBe(baseline ? 4 : 0);
      await nameUpdate(page, 10); expect((await state(next)).runtimeState).toEqual({ count: baseline ? 0 : 10 });
      expect(errors).toEqual([]);
    } finally { await page.close(); }
  }, 20000);
}
