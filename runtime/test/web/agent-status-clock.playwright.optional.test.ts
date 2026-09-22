import { afterAll, beforeAll, expect, test } from 'bun:test';
import { join } from 'node:path';
import { build } from 'esbuild';
import { chromium, webkit, type Browser, type Page } from 'playwright';
const enabled = process.env.PICLAW_RUN_OPTIONAL_BROWSER_TESTS === '1';
const browserTest = enabled ? test : test.skip;
let server: ReturnType<typeof Bun.serve>;
const browsers: { name: string; browser: Browser }[] = [];
beforeAll(async () => {
  if (!enabled) return;
  const result = await build({ entryPoints: [join(import.meta.dir,'fixtures/agent-status-clock-fixture.tsx')], bundle:true, write:false, format:'esm', platform:'browser', target:'es2022', jsx:'automatic', jsxImportSource:'preact' });
  server = Bun.serve({ hostname:'127.0.0.1',port:0,fetch(req) {
    const url=new URL(req.url);
    if(url.pathname==='/fixture.js')return new Response(result.outputFiles[0].contents,{headers:{'Content-Type':'text/javascript'}});
    if(url.pathname.startsWith('/static/'))return new Response(Bun.file(join(import.meta.dir,'../../web',url.pathname)));
    if(url.pathname==='/')return new Response('<!doctype html><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="/static/visual/dist/app.bundle.css"><main id="app"></main><script type="module" src="/fixture.js"></script>',{headers:{'Content-Type':'text/html'}});
    return new Response(null,{status:404});
  }});
  browsers.push({name:'chromium',browser:await chromium.launch({headless:true})},{name:'webkit',browser:await webkit.launch({headless:true})});
}, 30000);
afterAll(async()=>{for(const {browser}of browsers)await browser.close();server?.stop(true);});
async function open(engine:string) {
  const page=await browsers.find(x=>x.name===engine)!.browser.newPage();
  const errors:string[]=[]; page.on('pageerror',e=>errors.push(e.message));
  page.setDefaultTimeout(3000);
  await page.clock.install({time:new Date('2030-01-01T00:00:00Z')});
  const origin=`http://127.0.0.1:${server.port}`;
  await page.route('**/*',r=>new URL(r.request().url()).origin===origin?r.continue():r.abort());
  await page.goto(origin);
  await page.waitForFunction(()=>Boolean((window as any).statusClockFixture));
  await tick(page,300);
  return {page,errors};
}
async function tick(page:Page,ms:number) { await page.clock.runFor(ms); await page.evaluate(()=>new Promise<void>(resolve=>queueMicrotask(resolve))); }
async function emit(page:Page,name:string,detail?:unknown) {await page.evaluate(({name,detail})=>(window as any).statusClockFixture.emit(name,detail),{name,detail});await tick(page,100);}
const renders=(page:Page)=>page.evaluate(()=>(window as any).statusClockFixture.counters.renders);
for(const engine of ['chromium','webkit']) {
  browserTest(`${engine} idle status panel stops rendering, including after turn end and remount`,async()=>{
    const {page,errors}=await open(engine);try{
      expect(await page.locator('.agent-status-panel').count()).toBe(0);
      const before=await renders(page); await tick(page,5100);
      const idle=(await renders(page))-before;console.log(engine,'idle-render-delta',idle);
      expect(idle).toBe(0);
      await emit(page,'agent-draft',{text:'Fixture draft'});await tick(page,2200);
      expect(await page.locator('.agent-status-card--draft .agent-status-card__timer').textContent()).toMatch(/[1-9]\d*s/);
      const running=await page.locator('.agent-status-card--draft .agent-status-card__timer').textContent();
      await tick(page,2100);expect(await page.locator('.agent-status-card--draft .agent-status-card__timer').textContent()).not.toBe(running);
      await emit(page,'agent-turn-end');await tick(page,300);
      const ended=await renders(page);await tick(page,5100);expect(await renders(page)).toBe(ended);
      await page.locator('#toggle-panel').click();await tick(page,100);await page.locator('#toggle-panel').click();await tick(page,300);
      const remounted=await renders(page);await tick(page,5100);expect(await renders(page)).toBe(remounted);
      expect(errors).toEqual([]);
    }finally{await page.close();}
  },20000);
  browserTest(`${engine} draft thought and output elapsed counters continue while visible`,async()=>{
    const {page,errors}=await open(engine);try{
      await emit(page,'agent-draft',{text:'Fixture draft'});
      await emit(page,'agent-thought',{text:'Fixture thought'});
      await emit(page,'agent-status',{type:'tool_status',tool_name:'fixture',output_preview:'Fixture output',started_at:new Date('2030-01-01T00:00:00Z').toISOString()});
      await tick(page,2200);
      for(const kind of ['draft','thought','output'])expect(await page.locator(`.agent-status-card--${kind} .agent-status-card__timer`).textContent()).toMatch(/[1-9]\d*s/);
      for(const kind of ['draft','thought','output'])await page.locator(`.agent-status-card--${kind} .agent-status-card__close`).click();
      await tick(page,300);const dismissed=await renders(page);await tick(page,2500);expect(await renders(page)).toBe(dismissed);
      await emit(page,'agent-turn-end');expect(errors).toEqual([]);
    }finally{await page.close();}
  },20000);
  browserTest(`${engine} tools retry watchdog and recovery remain functional`,async()=>{
    const {page,errors}=await open(engine);try{
      await emit(page,'agent-status',{type:'tool_call',tool_name:'fixture',title:'Fixture tool'});await tick(page,2100);
      expect(await page.locator('.agent-status-card--tools .agent-status-card__timer').textContent()).toMatch(/[1-9]\d*s/);
      const retryAt=await page.evaluate(()=>Date.now()+6000);
      await emit(page,'agent-status',{type:'tool_status',tool_name:'fixture',title:'Fixture tool',retry_at:new Date(retryAt).toISOString()});
      const first=await page.locator('.agent-tool-retry-countdown').textContent();await tick(page,2000);
      expect(await page.locator('.agent-tool-retry-countdown').textContent()).not.toBe(first);
      await emit(page,'agent-status',{type:'intent',intent_key:'compaction'});
      expect(await page.locator('.agent-status__recovery-pill').textContent()).toContain('Auto-compacting');
      await tick(page,70000);expect(await page.locator('.agent-status-panel').textContent()).toContain('Possible hung run');
      await emit(page,'agent-turn-end');await tick(page,200);expect(await page.locator('.agent-status-panel').count()).toBe(0);
      expect(errors).toEqual([]);
    }finally{await page.close();}
  },20000);
  browserTest(`${engine} output-only and extension timers keep their independent visible clocks`,async()=>{
    const {page,errors}=await open(engine);try{
      await emit(page,'agent-status',{type:'tool_status',tool_name:'fixture',output_preview:'Output only',started_at:'2030-01-01T00:00:00Z'});
      await tick(page,2200);const output=await page.locator('.agent-status-card--output .agent-status-card__timer').textContent();
      await tick(page,2100);expect(await page.locator('.agent-status-card--output .agent-status-card__timer').textContent()).not.toBe(output);
      await page.locator('.agent-status-card--output .agent-status-card__close').click();await tick(page,300);
      const hidden=await renders(page);await tick(page,2100);expect(await renders(page)).toBe(hidden);
      await emit(page,'agent-turn-end');
      await emit(page,'extension-panel',{key:'fixture-panel',content:[{type:'status_panel',panel:{title:'Fixture extension',state:'running',detail_markdown:'Synthetic progress',started_at:'2030-01-01T00:00:00Z'}}]});
      const extension=await page.locator('.agent-status-card--extension .agent-status-card__timer').textContent();
      await tick(page,2100);expect(await page.locator('.agent-status-card--extension .agent-status-card__timer').textContent()).not.toBe(extension);
      await page.locator('.agent-status-card--extension .agent-status-card__close').click();await tick(page,300);
      const dismissed=await renders(page);await tick(page,2100);expect(await renders(page)).toBe(dismissed);
      await page.locator('#toggle-panel').click();await tick(page,100);const unmounted=await renders(page);await tick(page,12000);expect(await renders(page)).toBe(unmounted);
      expect(errors).toEqual([]);
    }finally{await page.close();}
  },20000);
}
