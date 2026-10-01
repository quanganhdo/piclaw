import '../helpers.js';
import {test,expect} from 'bun:test';
import {join,resolve} from 'node:path';
import {createTempWorkspace} from '../helpers.js';
import {chromium} from 'playwright';
const browserTest=process.env.PICLAW_RUN_OPTIONAL_BROWSER_TESTS==='1'?test:test.skip;
browserTest('Workspace indexing: preview, explicit save, errors, refresh and narrow layout',async()=>{
 const ws=createTempWorkspace('indexing-browser-');
 const web=resolve(import.meta.dir,'../../web');
 const entry=join(ws.workspace,'entry.ts');
 await Bun.write(entry,`import {html,render} from ${JSON.stringify(join(web,'src/vendor/preact-htm.js'))};import {WorkspaceIndexingSettings} from ${JSON.stringify(join(web,'src/components/settings/workspace-indexing.ts'))};render(html\`<\${WorkspaceIndexingSettings} />\`,document.getElementById('root'));`);
 const result=await Bun.build({entrypoints:[entry],target:'browser',format:'esm',bundle:true});expect(result.success).toBe(true);
 const bundle=await result.outputs[0]!.text();
 let policy={roots:['notes','.pi/skills'],ignorePatterns:[] as string[]}, saves=0,refreshes=0;
 const server=Bun.serve({hostname:'127.0.0.1',port:0,async fetch(req){
  const url=new URL(req.url);
  if(url.pathname==='/bundle.js')return new Response(bundle,{headers:{'content-type':'text/javascript'}});
  if(url.pathname==='/style.css')return new Response(Bun.file(join(web,'src/styles/app.css')),{headers:{'content-type':'text/css'}});
  if(url.pathname.startsWith('/agent/settings/workspace/indexing')){
   const data={policy,status:{state:'ready',indexed_file_count:2,last_indexed_at:'2026-09-29T00:00:00Z',last_error:null}};
   if(req.method==='GET')return Response.json({ok:true,...data});
   const draft=await req.json() as typeof policy;
   if(url.pathname.endsWith('/preview'))return Response.json({ok:true,preview:{includedFiles:1,excludedEntries:1,scannedEntries:2,elapsedMs:1,truncated:false,samples:[{path:'notes/archive/a.md',included:false,reason:'Matched ignore pattern.',rule:'notes/archive/**'}]}});
   if(url.pathname.endsWith('/save')){if(draft.roots.includes('../bad'))return Response.json({error:'Use workspace-relative paths.'},{status:400});policy=draft;saves++;return Response.json({ok:true,...data,policy});}
   refreshes++;return Response.json({ok:true,...data,queued:true},{status:202});
  }
  return new Response('<!doctype html><meta name="viewport" content="width=device-width"><link rel="stylesheet" href="/style.css"><div id="root"></div><script type="module" src="/bundle.js"></script>',{headers:{'content-type':'text/html'}});
 }});
 const browser=await chromium.launch({headless:true,...(process.env.PICLAW_TEST_CHROMIUM_PATH?{executablePath:process.env.PICLAW_TEST_CHROMIUM_PATH}:{})});
 try{
  const page=await browser.newPage({viewport:{width:390,height:844}});const errors:string[]=[];page.on('pageerror',e=>errors.push(e.message));
  await page.route('**/*',r=>new URL(r.request().url()).origin===server.url.origin?r.continue():r.abort());
  await page.goto(server.url.href);await page.getByLabel('Indexed roots',{exact:true}).waitFor();
  await page.waitForFunction(()=>document.querySelector('textarea')?.value.includes('notes'));
  expect(await page.getByRole('button',{name:'Save',exact:true}).isDisabled()).toBe(true);
  await page.getByLabel('Index ignore patterns').fill('# ignored\nnotes/archive/**');
  await page.getByRole('button',{name:'Preview',exact:true}).click();await page.getByText('Preview: 1 files included, 1 entries excluded').waitFor();expect(saves).toBe(0);
  await page.getByRole('button',{name:'Save',exact:true}).click();await page.waitForFunction(()=>!document.body.textContent?.includes('Unsaved changes'));expect(saves).toBe(1);
  await page.getByLabel('Indexed roots',{exact:true}).fill('../bad');await page.getByRole('button',{name:'Save',exact:true}).click();await page.getByRole('alert').waitFor();expect(saves).toBe(1);
  await page.getByLabel('Indexed roots',{exact:true}).fill('');await page.getByRole('button',{name:'Save',exact:true}).click();await page.waitForFunction(()=>!document.body.textContent?.includes('Unsaved changes'));expect(policy.roots).toEqual([]);
  await page.getByRole('button',{name:'Refresh now',exact:true}).click();await page.waitForFunction(()=>document.querySelector('section')?.getAttribute('aria-busy')==='false');expect(refreshes).toBe(1);
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);expect(errors).toEqual([]);
 }finally{await browser.close();server.stop(true);ws.cleanup();}
},30000);
