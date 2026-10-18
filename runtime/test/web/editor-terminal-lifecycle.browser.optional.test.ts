import { beforeAll, afterAll, expect, test } from 'bun:test';
import { join, resolve } from 'node:path';
import { chromium, webkit } from 'playwright';
const enabled = process.env.PICLAW_RUN_OPTIONAL_BROWSER_TESTS === '1';
const browserTest = enabled ? test : test.skip;
const root = resolve(import.meta.dir, '../..');
let server: ReturnType<typeof Bun.serve>;
beforeAll(async () => {
  if (!enabled) return;
  const build = await Bun.build({ entrypoints: [join(import.meta.dir, 'fixtures/editor-terminal-lifecycle-fixture.ts')], target: 'browser', format: 'esm', external: ['#editor-vendor/codemirror'] });
  if (!build.success) throw Error(build.logs.join('\n'));
  const js = await build.outputs[0].text();
  server = Bun.serve({ hostname: '127.0.0.1', port: 0, async fetch(req) {
    const url = new URL(req.url);
    if (url.pathname === '/editor-vendor/codemirror.js') return new Response(Bun.file(join(root, 'extensions/viewers/editor/vendor/codemirror.js')), { headers: { 'content-type': 'text/javascript' } });
    if (url.pathname === '/fixture.js') return new Response(js, { headers: { 'content-type': 'text/javascript' } });
    if (url.pathname === '/') return new Response('<!doctype html><div id="app"></div><div id="editor" style="height:500px"></div><script type="importmap">{"imports":{"#editor-vendor/codemirror":"/editor-vendor/codemirror.js"}}</script><script type="module" src="/fixture.js"></script>', { headers: { 'content-type': 'text/html' } });
    return new Response(null, { status: 404 });
  } });
}, 30000);
afterAll(() => server?.stop(true));
for (const [name, engine] of Object.entries({ chromium, webkit })) {
  for (const source of ['tab', 'dock']) browserTest(`${name}: closing actual child returns terminal to ${source}`, async () => {
    const browser = await engine.launch();
    try {
      const page = await browser.newPage();
      await page.goto(server.url.toString());
      await page.waitForFunction(() => !!(window as any).lifecycle);
      const popupReady = page.waitForEvent('popup');
      await page.click('#' + source);
      const popup = await popupReady;
      await page.waitForFunction(source => {
        const f = (window as any).lifecycle;
        return source === 'tab' ? f.runtime.detachedTabs.has(f.terminal) : !!f.runtime.detachedDockPane;
      }, source);
      await popup.waitForSelector('#close');
      // Neither another same-origin window nor a stale instance may return this pane.
      await page.evaluate(() => {
        const f = (window as any).lifecycle;
        const owned = f.runtime.detachedTabs.get(f.terminal) || f.runtime.detachedDockPane;
        window.dispatchEvent(new MessageEvent('message', { origin: location.origin, source: window,
          data: { type: 'piclaw-pane-reattach-request', panePath: f.terminal, paneInstanceId: owned.paneInstanceId } }));
      });
      await popup.evaluate(() => window.opener.postMessage({ type: 'piclaw-pane-reattach-request',
        panePath: 'piclaw://terminal', paneInstanceId: 'stale-instance' }, location.origin));
      await page.evaluate(() => new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))));
      expect(await page.evaluate(source => {
        const f = (window as any).lifecycle;
        return source === 'tab' ? f.runtime.detachedTabs.has(f.terminal) : !!f.runtime.detachedDockPane;
      }, source)).toBe(true);
      const closed = popup.waitForEvent('close');
      await popup.evaluate(() => { document.querySelector<HTMLButtonElement>('#close')!.click(); });
      await closed;
      await page.bringToFront();
      await page.focus('#focus');
      await page.waitForFunction(source => {
        const f = (window as any).lifecycle;
        return source === 'tab' ? !!f.tabStore.get(f.terminal) : f.runtime.dockVisible;
      }, source, { timeout: 5000 });
      expect(await page.evaluate(() => document.activeElement?.id)).toBe('focus');
      expect(await page.evaluate(() => (window as any).childHandle.closed)).toBe(true);
      expect(await page.evaluate(() => {
        const f = (window as any).lifecycle;
        return f.tabStore.getTabs().filter((t: any) => t.id === f.terminal).length;
      })).toBe(source === 'tab' ? 1 : 0);
      expect(await page.evaluate(() => {
        const f = (window as any).lifecycle;
        return f.runtime.detachedTabs.size === 0 && !f.runtime.detachedDockPane;
      })).toBe(true);
    } finally { await browser.close(); }
  }, 15000);
  for (const race of ['dirty', 'rename', 'dispose', 'newer-refresh', 'focused']) browserTest(`${name}: stat refresh guards ${race} during file fetch`, async () => {
    const browser = await engine.launch();
    let release!: () => void;
    const held = new Promise<void>(resolve => { release = resolve; });
    try {
      const page = await browser.newPage({ viewport: { width: 390, height: 844 }, hasTouch: true });
      let requested!: () => void;
      const fetching = new Promise<void>(resolve => { requested = resolve; });
      await page.route('**/*', async route => {
        const url = new URL(route.request().url());
        if (url.origin !== server.url.origin) return route.abort();
        if (url.pathname === '/workspace/stat') return route.fulfill({ json: { mtime: '2' } });
        if (url.pathname === '/workspace/file') {
          requested();
          await held;
          return route.fulfill({ json: { mtime: '2', text: 'external' } });
        }
        return route.continue();
      });
      await page.goto(server.url.toString());
      await page.waitForFunction(() => !!(window as any).editor?.view);
      await fetching;
      await page.evaluate(race => {
        const e = (window as any).editor;
        if (race === 'dirty') e.view.dispatch({ changes: { from: 0, to: e.view.state.doc.length, insert: 'draft' } });
        if (race === 'rename') e.setPath('renamed.txt');
        if (race === 'dispose') e.dispose();
        if (race === 'newer-refresh') e.setContent('newer', '3');
        if (race === 'focused') { e.view.dispatch({ selection: { anchor: 1, head: 4 } }); e.focus(); }
      }, race);
      const response = page.waitForResponse(r => new URL(r.url()).pathname === '/workspace/file');
      release();
      await (await response).finished();
      if (race === 'dirty') await page.waitForSelector('.editor-conflict-bar');
      if (race === 'focused') await page.waitForFunction(() => (window as any).editor.getContent() === 'external');
      await page.evaluate(() => new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))));
      expect(await page.evaluate(() => (window as any).editor.getContent())).toBe(
        race === 'dispose' ? undefined : race === 'dirty' ? 'draft' : race === 'newer-refresh' ? 'newer' : race === 'focused' ? 'external' : 'original');
      if (race === 'focused') {
        expect(await page.evaluate(() => (window as any).editor.view.hasFocus)).toBe(true);
        expect(await page.evaluate(() => { const s = (window as any).editor.view.state.selection.main; return [s.anchor, s.head]; })).toEqual([1, 4]);
      }
    } finally { release(); await browser.close(); }
  }, 15000);
  for (const dirty of [false, true]) browserTest(`${name}: phone missing workspace broadcast ${dirty ? 'preserves dirty draft' : 'refreshes clean editor'}`, async () => {
    const browser = await engine.launch();
    try {
      const page = await browser.newPage({ viewport: { width: 390, height: 844 }, hasTouch: true });
      let version = '1';
      await page.route('**/*', route => {
        const url = new URL(route.request().url());
        if (url.origin !== server.url.origin) return route.abort();
        if (url.pathname === '/workspace/stat') return route.fulfill({ json: { mtime: version } });
        if (url.pathname === '/workspace/file') return route.fulfill({ json: { mtime: version, text: 'external' } });
        return route.continue();
      });
      await page.goto(server.url.toString());
      await page.waitForFunction(() => !!(window as any).editor?.view);
      if (dirty) await page.evaluate(() => { const e = (window as any).editor; e.view.dispatch({ changes: { from: 0, to: e.view.state.doc.length, insert: 'draft' } }); });
      await page.evaluate(() => (window as any).editor.view.dispatch({ selection: { anchor: 1, head: 4 } }));
      await page.focus('#focus');
      version = '2';
      if (dirty) {
        await page.waitForSelector('.editor-conflict-bar', { timeout: 6000 });
        expect(await page.evaluate(() => (window as any).editor.getContent())).toBe('draft');
      } else {
        await page.waitForFunction(() => (window as any).editor.getContent() === 'external', null, { timeout: 6000 });
        expect(await page.locator('.editor-conflict-bar').count()).toBe(0);
        await page.waitForFunction(() => (window as any).editor.view.state.selection.main.anchor === 1 && (window as any).editor.view.state.selection.main.head === 4);
      }
      expect(await page.evaluate(() => document.activeElement?.id)).toBe('focus');
    } finally { await browser.close(); }
  }, 15000);
}
