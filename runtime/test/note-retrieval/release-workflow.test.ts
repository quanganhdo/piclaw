import {test,expect} from 'bun:test';
import {join} from 'node:path';
import {createTempWorkspace} from '../helpers.js';
test('release workflow: same-store reopen, 516 normal notes, incremental refresh and cited context',async()=>{
 const ws=createTempWorkspace('note-release-');
 const reports:any[]=[];
 try{
  for(const phase of ['build','reopen','reopen','reopen','recover','incremental']){
   const child=Bun.spawn([process.execPath,join(import.meta.dir,'../fixtures/note-retrieval/release-probe.ts'),'forward','500',phase],{
    env:{...process.env,PICLAW_WORKSPACE:ws.workspace,PICLAW_STORE:ws.store,PICLAW_DATA:ws.data,PICLAW_DB_IN_MEMORY:'0',PICLAW_DISABLE_BACKGROUND_WORKSPACE_INDEX:'1'},stdout:'pipe',stderr:'pipe'});
   const timer=setTimeout(()=>child.kill(),120000);
   try{
    const[out,err,code]=await Promise.all([new Response(child.stdout).text(),new Response(child.stderr).text(),child.exited]);
    if(code!==0)throw Error(err.slice(-6000));
    const line=out.split('\n').find(l=>l.startsWith('RELEASE_REPORT='));expect(line).toBeDefined();
    reports.push(JSON.parse(line!.slice('RELEASE_REPORT='.length)));
   }finally{clearTimeout(timer);}
  }
  const stable=(r:any)=>r.summary.map(({elapsedMs,queryMs,bytes,...row}:any)=>row);
  for(const r of reports){
   expect(r.summary).toHaveLength(22);expect(r.summary.every((s:any)=>['ok','partial'].includes(s.status)&&s.bytes<=16384)).toBe(true);
   expect(r.summary.filter((s:any)=>s.answerable)).toHaveLength(12);
   expect(r.summary.filter((s:any)=>s.answerable&&s.contextCoverage&&s.chunkCoverage)).toHaveLength(12);
   expect(r.summary.filter((s:any)=>s.snippetCoverage)).toHaveLength(11);
   expect(r.summary.filter((s:any)=>!s.answerable&&s.hits>0)).toHaveLength(10);
   expect(r.metrics.warmQueryMs).toHaveLength(110);expect(r.metrics.warmQueryMs.every((ms:number)=>Number.isFinite(ms)&&ms>=0)).toBe(true);
   expect(r.metrics.files).toBe(516);expect(r.metrics.sourceBytes).toBeGreaterThan(3*1024*1024);
   expect(r.references).toEqual(reports[0].references);expect(stable(r)).toEqual(stable(reports[0]));
  }
  const initial=reports[0], recovered=reports.find(r=>r.phase==='recover'),incremental=reports.find(r=>r.phase==='incremental');
  for(const r of reports.filter(r=>r.phase==='reopen')){
   expect(r.metrics.publication).toBe(initial.metrics.publication);expect(r.metrics.refreshMs).toBeNull();expect(r.metrics.sourceOpens).toBeNull();
  }
  expect(recovered.metrics.publication).toBeGreaterThan(initial.metrics.publication);
  expect(incremental.metrics.publication).toBeGreaterThan(recovered.metrics.publication);
  expect(incremental.metrics.fillerRevision).not.toBe(initial.metrics.fillerRevision);
  expect(incremental.metrics.sourceOpens).toBe(2);
  expect(initial.metrics.sourceOpens).toBe(516*2);expect(recovered.metrics.sourceOpens).toBe(516*2);
  expect(recovered.interruptions.map((s:any)=>s.phase)).toEqual(['before-interruptions','staged-1','crashed-1','staged-2','crashed-2','staged-3','crashed-3']);
  console.log('INTERRUPTED_REFRESH_MEASUREMENTS='+JSON.stringify(reports.find(r=>r.phase==='recover').interruptions));
  console.log('RELEASE_MEASUREMENTS='+JSON.stringify(reports.map(r=>({phase:r.phase,metrics:r.metrics,queryMs:r.summary.map((s:any)=>s.queryMs),maxResponseBytes:Math.max(...r.summary.map((s:any)=>s.bytes)),covered:r.summary.filter((s:any)=>s.contextCoverage).length,evidenceRoles:r.summary.filter((s:any)=>!s.answerable).map(({id,evidenceRole,roleSnippet,roleChunk,hits}:any)=>({id,evidenceRole,roleSnippet,roleChunk,hits}))}))));
 }finally{ws.cleanup();}
},730000);
