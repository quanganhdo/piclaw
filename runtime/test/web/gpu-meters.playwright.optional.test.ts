import {afterAll,beforeAll,expect,test} from 'bun:test';
import {join,resolve} from 'node:path';
import {build} from 'esbuild';
import {chromium,webkit} from 'playwright';
const enabled=process.env.PICLAW_RUN_OPTIONAL_BROWSER_TESTS==='1'&&process.env.PICLAW_E2E_DISPOSABLE==='1',run=enabled?test:test.skip,root=resolve(import.meta.dir,'../..');let server:ReturnType<typeof Bun.serve>;let bundle='';
let fixture:any={};const base={cpu_percent:24,ram_percent:46,cpu_series:[20,24],ram_series:[40,46],swap_percent:null,swap_total_bytes:0};
const intel=()=>({id:'intel0',name:'Intel Iris Xe',provider:'intel-drm-fdinfo',driver:'i915',status:'ok',sample_time_ms:Date.now(),busy_percent:0,memory:{resident_bytes:1024,total_bytes:4096},history:[{busy_percent:0,resident_bytes:1024}],coverage:{clients:1}});
beforeAll(async()=>{if(!enabled)return;bundle=(await build({stdin:{contents:`import{h,render}from'./web/src/vendor/preact-htm.js';import{h as vh,render as vr}from'preact';import{SystemMetersHud}from'./web/src/components/system-meters-hud.ts';import{SystemStats}from'./web/static/visual/frontend/src/components/SystemStats.tsx';localStorage.setItem('piclaw_system_meters_enabled','true');render(h(SystemMetersHud,{}),document.getElementById('root'));window.renderStats=stats=>vr(vh(SystemStats,{stats,isStale:false}),document.getElementById('visual-strip'));`,resolveDir:root,loader:'tsx'},bundle:true,format:'esm',platform:'browser',jsx:'automatic',jsxImportSource:'preact',write:false})).outputFiles[0].text;server=Bun.serve({hostname:'127.0.0.1',port:0,fetch(req){const u=new URL(req.url);if(u.pathname==='/agent/system-metrics')return Response.json({...base,...fixture,gpus:(fixture.gpus??[]).map((row:any)=>({...row,sample_time_ms:Date.now()}))});if(u.pathname==='/pane.js')return new Response(bundle,{headers:{'content-type':'text/javascript'}});if(u.pathname.startsWith('/css/'))return new Response(Bun.file(join(root,`web/static/${u.pathname.split('/')[2]}/css/shell.css`)),{headers:{'content-type':'text/css'}});if(u.pathname==='/agent/ui-state')return Response.json({});return new Response(`<meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="/css/${u.searchParams.get('skin')??'classic'}/shell.css"><link rel="stylesheet" href="/css/classic/shell.css"><style>:root{--bg-primary:#161616;--text-primary:#eee;--text-secondary:#aaa;--border-color:#444;--accent-color:#79afff}body{background:#161616;font:14px system-ui}</style><div id="root"></div><div id="visual-strip"></div><script type="module" src="/pane.js"></script>`,{headers:{'content-type':'text/html'}});}});},30000);
afterAll(()=>server?.stop(true));
for(const[name,engine]of Object.entries({chromium,webkit}))for(const skin of ['classic','visual'])run(`${skin}/${name}: disabled lines hidden and GPU details remain neutral and accessible`,async()=>{
 const browser=await engine.launch({headless:true}),page=await browser.newPage({viewport:{width:1024,height:768},hasTouch:true}),errors:string[]=[];page.setDefaultTimeout(5000);page.on('pageerror',e=>errors.push(e.message));await page.addInitScript(() => {
 const original = window.fetch.bind(window);
 (window as any).holdGpuReply = false;
 window.fetch = async (...args: Parameters<typeof fetch>) => {
  const response = await original(...args);
  if (String(args[0]).includes('/agent/system-metrics') && (window as any).holdGpuReply) {
   (window as any).gpuReplyHeld = true;
   return new Promise<Response>(resolve => { (window as any).releaseGpuReply = () => resolve(response); });
  }
  return response;
 };
});await page.route('**/*',r=>new URL(r.request().url()).origin===server.url.origin?r.continue():r.abort());
 try{fixture={gpus:[{...intel(),disabled:true}],vram_percent:null,swap_percent:null,swap_total_bytes:4096};await page.goto(`${server.url}?skin=${skin}`);await page.locator('.system-meters-row.cpu').waitFor();expect(await page.locator('.intel-gpu,.intel-gmem,.system-meters-row.swap').count()).toBe(0);
 await page.evaluate(()=>(window as any).renderStats({cpu_percent:0,ram_percent:10,swap_percent:null,buffer_cache_bytes:0,vram_percent:null,gpu_provider:'nvml',process_memory:{rss_bytes:0}}));expect(await page.locator('#visual-strip [title="Swap usage"],#visual-strip [title="GPU memory usage"],#visual-strip [title="Buffer/cache"],#visual-strip [title="Process RSS"]').count()).toBe(0);await page.evaluate(()=>(window as any).renderStats({cpu_percent:0,ram_percent:10,swap_percent:0,buffer_cache_bytes:10,vram_percent:0,gpu_provider:'nvml',process_memory:{rss_bytes:10}}));expect(await page.locator('#visual-strip [title="Swap usage"]').count()).toBe(2);
 fixture={gpus:[{...intel(),busy_percent:null,memory:{resident_bytes:null},status:'unavailable'}]};await page.reload();await page.locator('.system-meters-row.cpu').waitFor();expect(await page.locator('.intel-gpu,.intel-gmem').count()).toBe(0);
 fixture={gpus:[{...intel(),memory:{resident_bytes:null}}]};await page.reload();const activity=page.locator('.system-meters-row.intel-gpu');await activity.waitFor();expect(await activity.innerText()).toContain('0%');expect(await page.locator('.intel-gmem').count()).toBe(0);await activity.click();await page.getByRole('dialog').waitFor();expect(await page.getByRole('dialog').innerText()).not.toContain('Engines');expect(await page.getByRole('dialog').innerText()).toContain('Activity');await page.keyboard.press('Escape');expect(await activity.evaluate(el=>el===document.activeElement)).toBe(true);
 fixture={gpus:[],gpu_provider:'nvml',vram_percent:50,vram_series:[25,50],vram_total_bytes:4096,vram_used_bytes:2048};await page.reload();const vram=page.getByRole('button',{name:/VRAM 50%.*GPU details/});await vram.waitFor();expect(await page.locator('.intel-gpu').count()).toBe(0);await vram.press('Enter');await page.getByRole('dialog').waitFor();expect(await page.getByRole('dialog').innerText()).toContain('Device memory');expect(await page.getByRole('dialog').innerText()).not.toContain('Intel');expect(await page.getByRole('dialog').innerText()).not.toContain('Observed client');await page.getByRole('button',{name:'Close',exact:true}).click();expect(await vram.evaluate(el=>el===document.activeElement)).toBe(true);
 fixture={gpus:[intel()]};await page.reload();const changing=page.locator('.system-meters-row.intel-gpu');await changing.waitFor();await changing.click();await page.getByRole('dialog').waitFor();fixture={gpus:[{...intel(),busy_percent:null}]};await page.waitForFunction(()=>document.querySelector('.system-meters-row.intel-gpu')?.textContent?.includes('—'));expect(await page.getByRole('dialog').count()).toBe(1);expect(await changing.count()).toBe(1);expect(await page.locator('.system-meters-row.intel-gmem').count()).toBe(1);
 fixture={gpus:[],gpu_provider:'nvml',vram_percent:50,vram_series:[25,50],vram_total_bytes:4096,vram_used_bytes:2048};await page.reload();await page.setViewportSize({width:390,height:844});const compact=page.locator('.system-meters-compact-gpu.intel-gmem');await compact.waitFor();expect((await page.locator('.system-meters-compact-summary').innerText()).match(/VRAM/g)?.length).toBe(1);await compact.tap();await page.getByRole('dialog').waitFor();const box=await page.getByRole('dialog').boundingBox();expect(box!.x).toBeGreaterThanOrEqual(0);expect(box!.x+box!.width).toBeLessThanOrEqual(391);
 fixture={gpus:[],vram_percent:null};await page.waitForFunction(()=>document.querySelector('.system-meters-compact-gpu.intel-gmem')?.textContent?.includes('—'));expect(await page.getByRole('dialog').count()).toBe(1);expect(await compact.count()).toBe(1);fixture={gpus:[{id:'replacement',provider:'nvml',disabled:true}],vram_percent:null};await page.getByRole('dialog').waitFor({state:'detached',timeout:8000});expect(await page.locator('.intel-gpu,.intel-gmem').count()).toBe(0);expect(errors).toEqual([]);
 }finally{await browser.close();}
},20000);
for(const[name,engine]of Object.entries({chromium,webkit}))for(const skin of ['classic','visual'])run(`${skin}/${name}: disabling rejects a pending successful GPU reply`,async()=>{
 const browser=await engine.launch({headless:true}),page=await browser.newPage({viewport:{width:1024,height:768}});
 await page.addInitScript(()=>{
  const original=window.fetch.bind(window);
  (window as any).holdGpuReply=false;
  window.fetch=async(...args:Parameters<typeof fetch>)=>{
   const response=await original(...args);
   if(String(args[0]).includes('/agent/system-metrics')&&(window as any).holdGpuReply){
    (window as any).gpuReplyHeld=true;
    return new Promise<Response>(resolve=>{(window as any).releaseGpuReply=()=>resolve(response);});
   }
   return response;
  };
 });
 await page.route('**/*',r=>new URL(r.request().url()).origin===server.url.origin?r.continue():r.abort());
 try{
  fixture={gpus:[intel()]};await page.goto(`${server.url}?skin=${skin}`);await page.locator('.system-meters-row.intel-gpu').waitFor();
  await page.evaluate(()=>{(window as any).holdGpuReply=true;});
  await page.waitForFunction(()=>(window as any).gpuReplyHeld===true,{}, {timeout:8000});
  fixture={gpus:[{...intel(),busy_percent:null,memory:{resident_bytes:null},status:'unavailable'}]};
  await page.evaluate(()=>{window.dispatchEvent(new CustomEvent('piclaw-meters-change',{detail:{enabled:false}}));(window as any).releaseGpuReply();(window as any).holdGpuReply=false;});
  await page.waitForTimeout(100);
  await page.evaluate(()=>window.dispatchEvent(new CustomEvent('piclaw-meters-change',{detail:{enabled:true}})));
  await page.locator('.system-meters-row.cpu').waitFor();await page.waitForTimeout(100);
  expect(await page.locator('.intel-gpu,.intel-gmem').count()).toBe(0);
 }finally{await browser.close();}
},20000);
