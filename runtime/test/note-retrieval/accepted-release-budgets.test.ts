import '../helpers.js';
import {test,expect} from 'bun:test';
import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
const root=new URL('../fixtures/note-retrieval/',import.meta.url);
const load=(path:string)=>JSON.parse(readFileSync(new URL(path,root),'utf8'));
const accepted=load('accepted-release-budgets.json');
const p95=(values:number[])=>[...values].sort((a,b)=>a-b)[Math.ceil(values.length*.95)-1]!;

test('accepted workload-specific ceilings cover archived measurements without changing historical proposals',()=>{
 expect(accepted.status).toBe('accepted-first-release');
 expect(accepted.acceptedBy).toBe('Rui Carmo');
 expect(accepted.resource).toEqual({warmQueryP95MsMaximum:50,freshProcessFirstQueryMsMaximum:100,indexOwnedBytesPerSourceByteMaximum:3,toolResponseBytesMaximum:16384});
 const original=readFileSync(new URL(accepted.historicalProposal.path,root));
 expect(createHash('sha256').update(original).digest('hex')).toBe(accepted.historicalProposal.sha256);
 expect(JSON.parse(original.toString()).resource.warmQueryP95MsMaximum).toBe(10);
 const runs=load(accepted.evidence.releaseReport).report;
 expect(runs.map((r:any)=>r.phase)).toEqual(accepted.evidence.phases);
 for(const run of runs){
  expect(run.metrics.files).toBe(accepted.evidence.fixtureFiles);
  expect(run.metrics.sourceBytes).toBeGreaterThan(3*1024*1024);
  expect(run.metrics.warmQueryMs).toHaveLength(accepted.evidence.warmSamplesPerPhase);
  expect(run.metrics.warmQueryMs.every((n:number)=>Number.isFinite(n)&&n>=0)).toBe(true);
  expect(p95(run.metrics.warmQueryMs)).toBeLessThanOrEqual(accepted.resource.warmQueryP95MsMaximum);
  expect(run.queryMs[0]).toBeLessThanOrEqual(accepted.resource.freshProcessFirstQueryMsMaximum);
  expect(run.metrics.indexBytes/run.metrics.sourceBytes).toBeLessThanOrEqual(accepted.resource.indexOwnedBytesPerSourceByteMaximum);
  expect(run.maxResponseBytes).toBeLessThanOrEqual(accepted.resource.toolResponseBytesMaximum);
  if(run.metrics.refreshMs!==null)expect(run.metrics.refreshMs).toBeLessThanOrEqual(accepted.unchangedOtherBounds.refreshCooperativeCeilingMs);
 }
 expect(accepted.evidence.measuredProcessTreePeakBytes).toBeLessThanOrEqual(accepted.unchangedOtherBounds.historicalProposedRssBytes);
 expect(accepted.unchangedOtherBounds.historicalSmallInitialRefreshMs).toBe(JSON.parse(original.toString()).resource.smallInitialRefreshMsMaximum);
 // Retain the old failed targets: acceptance changes do not rewrite observations.
 expect(runs.some((r:any)=>p95(r.metrics.warmQueryMs)>10)).toBe(true);
 expect(runs.some((r:any)=>r.metrics.indexBytes/r.metrics.sourceBytes>2)).toBe(true);
 expect(runs.some((r:any)=>r.maxResponseBytes>4096)).toBe(true);
});

test('first-release acceptance preserves holdout outcomes and does not certify defective absence labels',()=>{
 const data=load(accepted.evidence.holdoutReport).report;
 const rows=(role:string)=>data.results.filter((r:any)=>r.expectedRole===role);
 expect(rows('supported')).toHaveLength(12);
 expect(rows('supported').filter((r:any)=>r.deliveredEvidence)).toHaveLength(11);
 expect(rows('supported').filter((r:any)=>r.getEvidence)).toHaveLength(12);
 for(const role of ['contradicted','unrecorded']){
  expect(rows(role)).toHaveLength(4);expect(rows(role).every((r:any)=>r.deliveredEvidence&&r.getEvidence)).toBe(true);
 }
 expect(rows('absent')).toHaveLength(4);
 expect(data.results.reduce((n:number,r:any)=>n+r.references,0)).toBe(137);
 expect(accepted.limitations.join('\n')).toContain('Q23/Q24');
 expect(accepted.limitations.join('\n')).toContain('separate authorisation');
 expect(accepted.safety.allowedCitationFailures).toBe(0);
 expect(accepted.safety.allowedAdmissionFailures).toBe(0);
 expect(Object.values(accepted.deferred).every(Number.isSafeInteger)).toBe(true);
});
