import { expect, test } from 'bun:test';
import { join } from 'node:path';
import { assessRetrievalBudgets } from '../scripts/note-retrieval-budget.js';

const budgets = await Bun.file(join(import.meta.dir,'fixtures/note-retrieval/budgets.json')).json();
function report() {
  return { schema:1, rebuildChecks:[0,500].map(scale=>({scale,identicalScoreTieStable:true})), reports:
    [0,500].flatMap(scale=>[0,1].flatMap(repetition=>['build','reopen'].map(mode=>({
      scale,repetition,mode,
      metrics:Object.fromEntries(['development','heldOut'].map(split=>[split,{fileRecall:1,mrr:1,filePrecision:0.8,unanswerableFalsePositiveRate:0.5,citationCorrectness:null,citationSupport:'unsupported: no citations'}])),
      results:[...Array.from({length:24},(_,i)=>({id:'q'+i,paths:['notes/a.md'],bytes:100,estimatedTokensAt4Bytes:25})),{id:'incremental-checks',sameMetadataEditDetected:true}],
      latency:{warmP95Ms:1,firstQueryMs:2},timings:{initialRefreshMs:100,noChangeRefreshMs:50,editRefreshMs:60,addRefreshMs:70,deleteRefreshMs:80},
      index:{sourceBytes:scale?10000:1000,indexOwnedBytes:scale?12000:8000},memory:{rssBytes:50_000_000},
    })))) };
}
const check=(assessment:ReturnType<typeof assessRetrievalBudgets>,id:string)=>assessment.checks.find(row=>row.id===id)!;
test('current limitations stay fail/unsupported, never all-green or budget acceptance',()=>{
  const result=assessRetrievalBudgets(report(),budgets);
  expect(result.completeFixtureMatrix).toBe(true);
  expect(result.allBudgetsSatisfied).toBe(false);
  expect(result.counts).toEqual({pass:15,fail:1,unsupported:1,insufficient_evidence:0});
  expect(check(result,'futureUnanswerableFalsePositiveRateMaximum')).toMatchObject({observed:0.5,threshold:0.25,status:'fail'});
  expect(check(result,'futureCitationCorrectnessMinimum').status).toBe('unsupported');
  expect(result.budgetStatus).toBe(budgets.status);
  expect(result.acceptance).toContain('not inferred');
});
test('threshold equality passes and one over/under fails using worst observation',()=>{
  const input=report();
  input.reports[0].latency.warmP95Ms=budgets.resource.warmQueryP95MsMaximum;
  input.reports[0].metrics.development.fileRecall=budgets.quality.fileRecallAt5MinimumPerSplit;
  expect(check(assessRetrievalBudgets(input,budgets),'warmQueryP95MsMaximum').status).toBe('pass');
  input.reports[0].latency.warmP95Ms+=0.001;
  input.reports[0].metrics.heldOut.fileRecall=0.999;
  const result=assessRetrievalBudgets(input,budgets);
  expect(check(result,'warmQueryP95MsMaximum').status).toBe('fail');
  expect(check(result,'fileRecallAt5MinimumPerSplit').status).toBe('fail');
});
test('missing, duplicate, small-only, null, malformed and non-finite evidence cannot pass',()=>{
  for(const alter of [
    (r:any)=>{r.reports.pop();},
    (r:any)=>{r.reports[7]=r.reports[0];},
    (r:any)=>{r.reports=r.reports.filter((x:any)=>x.scale===0);},
  ]) {
    const input=report();alter(input);const result=assessRetrievalBudgets(input,budgets);
    expect(result.completeFixtureMatrix).toBe(false);expect(result.allBudgetsSatisfied).toBe(false);
    expect(result.counts.pass).toBe(0);
  }
  const input:any=report();input.reports[0].latency.warmP95Ms=null;input.reports[1].metrics.development.fileRecall=NaN;
  input.reports[4].index.indexOwnedBytes=null;
  const result=assessRetrievalBudgets(input,budgets);
  for(const id of ['warmQueryP95MsMaximum','fileRecallAt5MinimumPerSplit','indexOwnedBytesPerSourceByteMaximum'])expect(check(result,id).status).toBe('insufficient_evidence');
  expect(()=>assessRetrievalBudgets({schema:2},budgets)).toThrow('schema');
  expect(()=>assessRetrievalBudgets(report(),{...budgets,resource:{...budgets.resource,warmQueryP95MsMaximum:NaN}})).toThrow('Invalid numeric');
});
test('unknown citations and incomplete query/tie data are insufficient, not unsupported or pass',()=>{
  const input:any=report();delete input.reports[0].metrics.development.citationCorrectness;
  input.reports[0].results.pop();input.rebuildChecks.pop();input.reports[2].results=input.reports[2].results.slice(1);
  const result=assessRetrievalBudgets(input,budgets);
  for(const id of ['futureCitationCorrectnessMinimum','futureSameMetadataEditDetected','futureIdenticalScoreRebuildOrderStable','toolResponseBytesMaximum'])expect(check(result,id).status).toBe('insufficient_evidence');
});
test('resource and correctness failures are reported independently without stopping the assessment',()=>{
  const input:any=report();
  input.reports[0].results[0].bytes=4097;
  input.reports[0].results[0].estimatedTokensAt4Bytes=1025;
  input.reports[0].memory.rssBytes=budgets.resource.runtimeRssBytesMaximum+1;
  input.reports[0].results.at(-1).sameMetadataEditDetected=false;
  input.reports[4].index.indexOwnedBytes=20001;
  input.reports[4].timings.editRefreshMs=30001;
  input.rebuildChecks[1].identicalScoreTieStable=false;
  const result=assessRetrievalBudgets(input,budgets);
  for(const id of ['toolResponseBytesMaximum','estimatedTokensAt4BytesMaximum','runtimeRssBytesMaximum','futureSameMetadataEditDetected','indexOwnedBytesPerSourceByteMaximum','largeIncrementalRefreshMsMaximum','futureIdenticalScoreRebuildOrderStable'])expect(check(result,id).status).toBe('fail');
  expect(check(result,'fileRecallAt5MinimumPerSplit').status).toBe('pass');
});
test('valid improvements can pass the numeric targets without changing approval status',()=>{
  const input=report();for(const run of input.reports)for(const value of Object.values(run.metrics)){value.unanswerableFalsePositiveRate=0;(value as any).citationCorrectness=1;}
  const result=assessRetrievalBudgets(input,budgets);
  expect(result.allBudgetsSatisfied).toBe(true);expect(result.counts.pass).toBe(17);
  expect(result.budgetStatus).toBe(budgets.status);
});
