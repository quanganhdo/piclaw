import {test,expect} from 'bun:test';
import {join} from 'node:path';
import {createTempWorkspace} from '../helpers.js';
test('final frozen role-aware holdout: source/citation integrity without claiming answer accuracy',async()=>{
 const ws=createTempWorkspace('note-final-holdout-');
 const child=Bun.spawn([process.execPath,join(import.meta.dir,'../fixtures/note-retrieval/final-holdout-worker.ts')],{
  env:{...process.env,PICLAW_WORKSPACE:ws.workspace,PICLAW_STORE:ws.store,PICLAW_DATA:ws.data,PICLAW_DB_IN_MEMORY:'0',PICLAW_DISABLE_BACKGROUND_WORKSPACE_INDEX:'1'},stdout:'pipe',stderr:'pipe'});
 const timer=setTimeout(()=>child.kill(),90000);
 try{
  const[out,err,code]=await Promise.all([new Response(child.stdout).text(),new Response(child.stderr).text(),child.exited]);
  if(code!==0)throw Error(err.slice(-6000));
  const line=out.split('\n').find(l=>l.startsWith('FINAL_HOLDOUT_REPORT='));expect(line).toBeDefined();
  const report=JSON.parse(line!.slice('FINAL_HOLDOUT_REPORT='.length));expect(report.results).toHaveLength(24);
  expect(report.results.every((r:any)=>r.bytes<=16384&&['ok','partial'].includes(r.status))).toBe(true);
  // Preserve first-run observations as regression checks, not unseen evaluation.
  const byRole=(role:string)=>report.results.filter((r:any)=>r.expectedRole===role);
  expect(byRole('supported')).toHaveLength(12);
  expect(byRole('supported').filter((r:any)=>r.deliveredEvidence)).toHaveLength(11);
  expect(byRole('supported').every((r:any)=>r.getEvidence)).toBe(true);
  for(const role of ['contradicted','unrecorded']){
   expect(byRole(role)).toHaveLength(4);
   expect(byRole(role).every((r:any)=>r.deliveredEvidence&&r.getEvidence)).toBe(true);
  }
  expect(byRole('absent')).toHaveLength(4);
  expect(byRole('absent').every((r:any)=>!r.deliveredEvidence&&!r.getEvidence&&r.hitCount>0)).toBe(true);
  console.log('FINAL_HOLDOUT_EVIDENCE='+JSON.stringify(report));
 }finally{clearTimeout(timer);ws.cleanup();}
},100000);
