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
for (const [name, engine] of Object.entries({ chromium, webkit })) for (const path of ['fixture.md', 'notes.with.dot/fixture']) for (const bundle of [false, true]) {
  browserTest(`${name} ${bundle ? 'bundle' : 'source'}: conflict Save copy creates a new file beside ${path}`, async () => {
    const browser = await engine.launch();
    const page = await browser.newPage();
    const writes: {method:string;body:any}[] = [];
    let savedPath = '';
    try {
      await page.route('**/*', async route => {
        const req = route.request(), url = new URL(req.url());
        if (url.origin !== server.url.origin) return route.abort();
        if (url.pathname === '/workspace/stat') return route.fulfill({contentType:'application/json',body:JSON.stringify({mtime:'external'})});
        if (url.pathname === '/workspace/file' && ['PUT','POST'].includes(req.method())) {
          const body=req.postDataJSON(); writes.push({method:req.method(),body});
          if (req.method()==='PUT') return route.fulfill({status:404,contentType:'application/json',body:JSON.stringify({error:'File not found'})});
          savedPath=body.path==='.'?body.name:`${body.path}/${body.name}`;
          return route.fulfill({contentType:'application/json',body:JSON.stringify({path:savedPath,mtime:'copy'})});
        }
        return route.continue();
      });
      await page.goto(server.url.toString() + (bundle ? '?bundle=1' : ''));
      await page.waitForFunction(()=>!!(window as any).editorFixture);
      await page.evaluate(path=>{
        const f=(window as any).editorFixture;f.mount('text');const e=f.instance;
        e.path=path;e.currentMtime='original';e.initConflictMonitor();
        e.view.dispatch({changes:{from:0,to:e.view.state.doc.length,insert:'My unsaved copy'}});
      },path);
      await page.locator('.editor-conflict-bar').waitFor();
      await page.locator('[data-action="save-copy"]').click();
      await page.waitForFunction(()=>/Copy saved as|Save copy failed:/.test(document.body.textContent || ''));
      expect(writes).toHaveLength(1);expect(writes[0].method).toBe('POST');expect(writes[0].body.content).toBe('My unsaved copy');
      const slash=path.lastIndexOf('/'),folder=slash<0?'.':path.slice(0,slash),base=path.slice(slash+1);
      expect(writes[0].body.path).toBe(folder);
      const stem=base.includes('.')?base.slice(0,base.lastIndexOf('.')):base,extension=base.includes('.')?base.slice(base.lastIndexOf('.')):'';
      expect(writes[0].body.name.startsWith(stem+'.')).toBe(true);expect(writes[0].body.name.endsWith(extension)).toBe(true);expect(savedPath).not.toBe(path);
      const state=await page.evaluate(()=>{const e=(window as any).editorFixture.instance;return{text:e.view.state.doc.toString(),dirty:e.dirty,mtime:e.currentMtime};});
      expect(state).toEqual({text:'My unsaved copy',dirty:true,mtime:'original'});
    } finally {await browser.close();}
  },30000);
}
