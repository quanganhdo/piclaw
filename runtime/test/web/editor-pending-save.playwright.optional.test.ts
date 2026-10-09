import { beforeAll, afterAll, expect, test } from 'bun:test';
import { join, resolve } from 'node:path';
import { chromium, webkit } from 'playwright';
const enabled = process.env.PICLAW_RUN_OPTIONAL_BROWSER_TESTS === '1';
const browserTest = enabled ? test : test.skip;
const root = resolve(import.meta.dir, '../..');
let server: ReturnType<typeof Bun.serve>;
beforeAll(async () => {
  if (!enabled) return;
  const build = await Bun.build({ entrypoints: [join(import.meta.dir, 'fixtures/editor-theme-fixture.ts')], target: 'browser', format: 'esm', external: ['#editor-vendor/codemirror', '/static/classic/dist/editor.bundle.js'] });
  if (!build.success) throw Error(build.logs.join('\n'));
  const js = await build.outputs[0].text();
  server = Bun.serve({ hostname: '127.0.0.1', port: 0, async fetch(req) {
    const url = new URL(req.url);
    if (url.pathname === '/editor-vendor/codemirror.js') return new Response(Bun.file(join(root, 'extensions/viewers/editor/vendor/codemirror.js')), { headers: { 'content-type': 'text/javascript' } });
    if (url.pathname === '/fixture.js') return new Response(js, { headers: { 'content-type': 'text/javascript' } });
    if (url.pathname.startsWith('/static/')) {
      const file = resolve(root, 'web', url.pathname.slice(1));
      if (file.startsWith(root + '/web/static/') && await Bun.file(file).exists()) return new Response(Bun.file(file));
    }
    if (url.pathname === '/') return new Response('<!doctype html><div id="editor" style="height:600px"></div><script type="importmap">{"imports":{"#editor-vendor/codemirror":"/editor-vendor/codemirror.js"}}</script><script type="module" src="/fixture.js"></script>', { headers: { 'content-type': 'text/html' } });
    if (url.pathname === '/workspace/stat') return Response.json({ mtime: 'fixture' });
    return new Response(null, { status: 404 });
  } });
}, 30000);
afterAll(() => server?.stop(true));
for (const [name, engine] of Object.entries({ chromium, webkit })) for (const mode of ['text', 'diff']) for (const bundle of [false, true]) {
  browserTest(`${name} ${mode} ${bundle ? 'bundle' : 'source'}: pending save preserves later edits and saves them next`, async () => {
    const browser = await engine.launch();
    const page = await browser.newPage();
    let release!: () => void;
    let received!: () => void;
    const arrived = new Promise<void>(r => received = r);
    const held = new Promise<void>(r => release = r);
    const writes: string[] = [];
    try {
      await page.route('**/*', async route => {
        const req = route.request(), url = new URL(req.url());
        if (url.origin !== server.url.origin) return route.abort();
        if (url.pathname === '/workspace/file' && req.method() === 'PUT') {
          writes.push(req.postDataJSON().content);
          if (writes.length === 1) { received(); await held; }
          return route.fulfill({ contentType: 'application/json', body: JSON.stringify({ mtime: 'saved-' + writes.length }) });
        }
        return route.continue();
      });
      await page.goto(server.url.toString() + (bundle ? '?bundle=1' : ''));
      await page.waitForFunction(() => !!(window as any).editorFixture);
      await page.evaluate(mode => {
        const f = (window as any).editorFixture; f.mount(mode);
        const e = f.instance;
        e.view.dispatch({ changes: { from: 0, to: e.view.state.doc.length, insert: 'first' } });
        (window as any).pendingSave = e.handleSave();
      }, mode);
      await arrived;
      await page.evaluate(() => { const e = (window as any).editorFixture.instance; e.view.dispatch({ changes: { from: e.view.state.doc.length, insert: ' second' } }); });
      release();
      await page.evaluate(() => (window as any).pendingSave);
      const state = await page.evaluate(() => { const e = (window as any).editorFixture.instance; return { text: e.view.state.doc.toString(), baseline: e.initialContent, dirty: e.dirty, saving: e.saving, baselineText: e.baselineView?.state.doc.toString() }; });
      expect(writes).toEqual(['first']);
      expect(state.text).toBe('first second'); expect(state.baseline).toBe('first'); expect(state.dirty).toBe(true); expect(state.saving).toBe(false);
      if (mode === 'diff') expect(state.baselineText).toBe('first');
      await page.evaluate(() => (window as any).editorFixture.instance.handleSave());
      expect(writes).toEqual(['first', 'first second']);
      expect(await page.evaluate(() => (window as any).editorFixture.instance.dirty)).toBe(false);
    } finally { release?.(); await browser.close(); }
  }, 30000);
}
