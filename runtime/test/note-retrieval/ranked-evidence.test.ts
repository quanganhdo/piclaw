import {test,expect} from 'bun:test';
import {join} from 'node:path';
import {createTempWorkspace} from '../helpers.js';
async function run(direction:string,scale='0'){
 const ws=createTempWorkspace('note-ranked-probe-');
 const child=Bun.spawn([process.execPath,join(import.meta.dir,'../fixtures/note-retrieval/ranked-probe.ts'),direction,scale],{
 env:{...process.env,PICLAW_WORKSPACE:ws.workspace,PICLAW_STORE:ws.store,PICLAW_DATA:ws.data,PICLAW_DB_IN_MEMORY:'0',PICLAW_DISABLE_BACKGROUND_WORKSPACE_INDEX:'1'},stdout:'pipe',stderr:'pipe'});
 const timer=setTimeout(()=>child.kill(),120000);
 try{const[out,err,code]=await Promise.all([new Response(child.stdout).text(),new Response(child.stderr).text(),child.exited]);
 if(code!==0)throw Error(err.slice(-5000));
 const line=out.split('\n').find(l=>l.startsWith('INDEPENDENT_REPORT='));expect(line).toBeDefined();
 return JSON.parse(line!.slice('INDEPENDENT_REPORT='.length)).summary as any[];
 }finally{clearTimeout(timer);ws.cleanup();}
}
test('ranked tool returns separately gettable context and stable ordering on consulted corpus',async()=>{
 const forward=await run('forward'),reverse=await run('reverse');
 expect(forward).toHaveLength(22);
 expect(forward.every(r=>['ok','partial'].includes(r.status))).toBe(true);
 expect(forward.filter(r=>r.answerable&&r.contextCoverage)).toHaveLength(12);
 expect(forward.filter(r=>r.answerable&&r.snippetCoverage)).toHaveLength(11);
 // Source verification is not semantic abstention: keep exposure visible.
 expect(forward.filter(r=>!r.answerable&&r.hits>0)).toHaveLength(10);
 const stable=(rows:any[])=>rows.map(({elapsedMs,...row})=>row);
 expect(stable(forward)).toEqual(stable(reverse));
 const scaled=await run('forward','500');
 // FTS rank magnitudes (and their serialized length) change with corpus size;
 // compare ordered cited text/signals/coverage, not exact envelope byte count.
 const scaleStable=(rows:any[])=>rows.map(({elapsedMs,bytes,...row})=>row);
 expect(scaleStable(scaled)).toEqual(scaleStable(forward));
 expect(scaled.every(r=>r.bytes<=16384)).toBe(true);
 console.log('RANKED_EVIDENCE='+JSON.stringify(forward));
},260000);
