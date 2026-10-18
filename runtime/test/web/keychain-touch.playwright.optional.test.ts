import {beforeAll,afterAll,expect,test} from 'bun:test';
import {build} from 'esbuild';
import {join,resolve} from 'node:path';
import {chromium,webkit} from 'playwright';
const run=process.env.PICLAW_RUN_OPTIONAL_BROWSER_TESTS==='1'?test:test.skip;
let server:ReturnType<typeof Bun.serve>;
beforeAll(async()=>{
 if(process.env.PICLAW_RUN_OPTIONAL_BROWSER_TESTS!=='1')return;
 const result=await build({entryPoints:[join(import.meta.dir,'fixtures/keychain-touch-fixture.ts')],bundle:true,write:false,format:'esm',platform:'browser',external:['#editor-vendor/codemirror']});
 const staticRoot=resolve(import.meta.dir,'../../web/static');
 server=Bun.serve({hostname:'127.0.0.1',port:0,fetch(req){const p=new URL(req.url).pathname;
  if(p==='/fixture.js')return new Response(result.outputFiles![0].text,{headers:{'content-type':'text/javascript'}});
  if(p.startsWith('/static/')){const file=resolve(staticRoot,p.slice(8));if(!file.startsWith(staticRoot+'/'))return new Response('',{status:404});return new Response(Bun.file(file));}
  return new Response('<!doctype html><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="/static/classic/css/styles.css"><div id="root"></div><script type="importmap">{"imports":{"#editor-vendor/codemirror":"/static/classic/vendor/codemirror.js"}}</script><script type="module" src="/fixture.js"></script>',{headers:{'content-type':'text/html'}});
 }});
});
afterAll(()=>server?.stop(true));
for(const[name,engine]of Object.entries({chromium,webkit}))for(const width of [320,390,820,1280])run(`${name}/${width}: real keychain dialog touch and keyboard confirmation`,async()=>{
 const browser=await engine.launch({headless:true});try{
  const page=await browser.newPage({viewport:{width,height:844},hasTouch:true});await page.goto(server.url.href);
  const remove=page.locator('.settings-keychain-delete-btn');await remove.waitFor();
  const hittable=async(locator:any)=>locator.evaluate((el:HTMLElement)=>{const r=el.getBoundingClientRect();return el.contains(document.elementFromPoint(r.x+r.width/2,r.y+r.height/2));});
  expect(await hittable(remove)).toBe(true);await remove.tap({timeout:3000});
  const yes=page.locator('.settings-keychain-confirm button').first(),no=page.locator('.settings-keychain-confirm button').last();await no.waitFor();
  expect(await hittable(yes)).toBe(true);expect(await hittable(no)).toBe(true);await page.waitForFunction(()=>document.activeElement===document.querySelector(".settings-keychain-confirm button"));
  expect(await page.evaluate(()=>(window as any).keychainTouches.deletes)).toBe(0);await no.click();await remove.waitFor();await page.waitForFunction(()=>document.activeElement===document.querySelector(".settings-keychain-delete-btn"));
  await remove.press('Enter');await no.waitFor();await page.waitForFunction(()=>document.activeElement===document.querySelector(".settings-keychain-confirm button"));await page.keyboard.press('Tab');expect(await no.evaluate(el=>document.activeElement===el)).toBe(true);
  await yes.tap();await page.waitForFunction(()=>(window as any).keychainTouches.deletes===1);expect(await remove.count()).toBe(0);
  await page.waitForFunction(()=>document.activeElement?.classList.contains('settings-keychain-add-btn'));
 }finally{await browser.close();}
},15000);
