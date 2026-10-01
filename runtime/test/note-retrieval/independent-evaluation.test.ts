import { test, expect } from 'bun:test';
import { join } from 'node:path';
import { readFileSync } from 'node:fs';
import { createTempWorkspace } from '../helpers.js';

async function run(direction:'forward'|'reverse') {
  const ws=createTempWorkspace(`note-independent-${direction}-`);
  const child=Bun.spawn([process.execPath,join(import.meta.dir,'../fixtures/note-retrieval/independent-worker.ts'),direction],{
    env:{...process.env,PICLAW_WORKSPACE:ws.workspace,PICLAW_STORE:ws.store,PICLAW_DATA:ws.data,PICLAW_DB_IN_MEMORY:'0',PICLAW_DISABLE_BACKGROUND_WORKSPACE_INDEX:'1'},
    stdout:'pipe',stderr:'pipe',
  });
  const timer=setTimeout(()=>child.kill(),60_000);
  try {
    const [out,err,code]=await Promise.all([new Response(child.stdout).text(),new Response(child.stderr).text(),child.exited]);
    if(code!==0)throw Error(`${code}: ${err.slice(-4000)} ${out.slice(-2000)}`);
    const line=out.split('\n').find(s=>s.startsWith('INDEPENDENT_REPORT='));expect(line).toBeDefined();
    return JSON.parse(line!.slice('INDEPENDENT_REPORT='.length));
  } finally {clearTimeout(timer);ws.cleanup();}
}

test('current default retrieval on frozen corpus: fresh rebuilds preserve measurements', async () => {
  const forward=await run('forward'),repeat=await run('forward'),reverse=await run('reverse');
  for(const report of [forward,repeat,reverse]) {
    expect(report.summary).toHaveLength(22);
    expect(report.summary.every((row:any)=>['ok','partial'].includes(row.status)&&row.reasons.every((reason:string)=>reason==='validation_budget')&&row.bytes<=16384)).toBe(true);
    expect(report.summary.every((row:any)=>row.variant==='default')).toBe(true);
  }
  const payload=(report:any)=>JSON.stringify(report.summary.map(({elapsedMs,...row}:any)=>row));
  expect(payload(forward)).toEqual(payload(repeat));
  expect(payload(forward)).toEqual(payload(reverse));
  console.log('INDEPENDENT_EVALUATION='+JSON.stringify(forward));
},210_000);

test('archived evaluation retains both rejected-mode and strict observations without changing labels', () => {
  const root=join(import.meta.dir,'../fixtures/note-retrieval/independent-v3');
  const archive=JSON.parse(readFileSync(join(root,'historical-result.json'),'utf8'));
  const labels=JSON.parse(readFileSync(join(root,'evaluation.json'),'utf8'));
  const policy=JSON.parse(readFileSync(join(root,'policy.json'),'utf8'));
  expect(archive.report.policy).toEqual(policy);
  expect(archive.report.summary).toHaveLength(44);
  for(const variant of ['strict','candidate']) {
    const rows=archive.report.summary.filter((row:any)=>row.variant===variant);
    expect(rows.map((row:any)=>row.id)).toEqual(labels.queries.map((q:any)=>q.id));
    expect(rows.map((row:any)=>row.query)).toEqual(labels.queries.map((q:any)=>q.query));
    expect(rows.every((row:any,i:number)=>row.answerable===(labels.queries[i].relevant.length>0))).toBe(true);
    expect(rows.filter((row:any)=>row.answerable)).toHaveLength(12);
    expect(rows.filter((row:any)=>row.snippetCoverage)).toHaveLength(variant==='strict'?2:11);
    expect(rows.filter((row:any)=>!row.answerable&&row.hits>0)).toHaveLength(variant==='strict'?4:10);
    expect(rows.reduce((n:number,row:any)=>n+row.conflictingHits,0)).toBe(variant==='strict'?0:5);
    expect(Math.max(...rows.map((row:any)=>row.bytes))).toBe(variant==='strict'?1552:3528);
  }
});
