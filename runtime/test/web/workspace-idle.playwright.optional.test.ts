import { afterAll, beforeAll, expect, test } from 'bun:test';
import { join } from 'node:path';
import { chromium, webkit, type Browser, type Page } from 'playwright';
const enabled = process.env.PICLAW_RUN_OPTIONAL_BROWSER_TESTS === '1';
const browserTest = enabled ? test : test.skip;
const baseline = process.env.PICLAW_WORKSPACE_IDLE_BASELINE === '1';
const browsers: {name:string;browser:Browser}[]=[];let server:ReturnType<typeof Bun.serve>;
beforeAll(async()=>{if(!enabled)return;const built=await Bun.build({entrypoints:[join(import.meta.dir,'fixtures/workspace-idle-fixture.ts')],target:'browser',format:'esm'});if(!built.success)throw Error(built.logs.join('\n'));const script=await built.outputs[0].text();server=Bun.serve({hostname:'127.0.0.1',port:0,fetch(req){const p=new URL(req.url).pathname;if(p==='/fixture.js')return new Response(script,{headers:{'Content-Type':'text/javascript'}});if(p==='/')return new Response('<!doctype html><div id="app"></div><script type="module" src="/fixture.js"></script>',{headers:{'Content-Type':'text/html'}});return new Response(null,{status:404});}});browsers.push({name:'chromium',browser:await chromium.launch({headless:true})},{name:'webkit',browser:await webkit.launch({headless:true})});},30000);
afterAll(async()=>{for(const {browser}of browsers)await browser.close();server?.stop(true);});
async function tick(page:Page,ms:number){await page.clock.runFor(ms);await page.evaluate(()=>new Promise<void>(r=>queueMicrotask(r)));}
for(const engine of ['chromium','webkit'])browserTest(`${engine} workspace polling follows visible lifecycle`,async()=>{
 const page=await browsers.find(x=>x.name===engine)!.browser.newPage();const errors:string[]=[];const requests:string[]=[];page.on('pageerror',e=>errors.push(e.message));
 await page.clock.install({time:new Date('2030-01-01T00:00:00Z')});const origin=`http://127.0.0.1:${server.port}`;
 await page.route('**/*',route=>{const u=new URL(route.request().url());if(u.origin!==origin)return route.abort();if(['/', '/fixture.js'].includes(u.pathname))return route.continue();requests.push(u.pathname);if(u.pathname==='/workspace/tree')return route.fulfill({json:{root:{name:'workspace',path:'.',type:'dir',children:[]},truncated:false}});if(u.pathname==='/workspace/index-status')return route.fulfill({json:{scope:'all',state:'ready',indexed_file_count:0}});if(u.pathname==='/workspace/visibility')return route.fulfill({json:{ok:true}});return route.fulfill({status:404,json:{error:'unhandled',path:u.pathname}});});
 await page.goto(origin);await tick(page,2200);requests.length=0;await tick(page,60000);
 const closed={tree:requests.filter(p=>p==='/workspace/tree').length,index:requests.filter(p=>p==='/workspace/index-status').length};
 console.log(JSON.stringify({engine,baseline,windowMs:60000,closed}));expect(closed).toEqual(baseline?{tree:0,index:1}:{tree:0,index:0});
 await page.locator('#toggle').click();await tick(page,100);expect(requests.filter(p=>p==='/workspace/tree')).toHaveLength(1);expect(requests.filter(p=>p==='/workspace/index-status')).toHaveLength(baseline?2:1);
 requests.length=0;await tick(page,60000);expect(requests.filter(p=>p==='/workspace/tree')).toHaveLength(1);expect(requests.filter(p=>p==='/workspace/index-status')).toHaveLength(1);
 await page.evaluate(()=>{Object.defineProperty(document,'visibilityState',{configurable:true,get:()=> 'hidden'});document.dispatchEvent(new Event('visibilitychange'));});requests.length=0;await tick(page,60000);expect(requests.filter(p=>p!=='/workspace/visibility')).toEqual([]);
 await page.evaluate(()=>{Object.defineProperty(document,'visibilityState',{configurable:true,get:()=> 'visible'});document.dispatchEvent(new Event('visibilitychange'));});await tick(page,100);expect(requests.filter(p=>p==='/workspace/tree')).toHaveLength(1);expect(requests.filter(p=>p==='/workspace/index-status')).toHaveLength(1);
 await page.locator('#toggle').click();requests.length=0;await tick(page,60000);expect(requests.filter(p=>p!=='/workspace/visibility')).toEqual([]);
 await page.locator('#active').click();await tick(page,100);expect(requests.filter(p=>p!=='/workspace/visibility')).toEqual([]);expect(errors).toEqual([]);await page.close();
},20000);
