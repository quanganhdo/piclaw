import { expect, test } from 'bun:test';
import { join } from 'node:path';
import { loadCorpus, percentile, scoreFileHits, summariseScores, type Query } from './fixtures/note-retrieval/scoring.js';
import './helpers.js';
const root = join(import.meta.dir, 'fixtures/note-retrieval');
const corpus = loadCorpus(root);
test('frozen synthetic corpus labels, splits and cases remain independent and complete', () => {
  expect(corpus.queries).toHaveLength(24);
  expect(corpus.queries.filter(q => q.split === 'development')).toHaveLength(12);
  expect(corpus.queries.filter(q => q.split === 'held-out')).toHaveLength(12);
  expect(corpus.queries.filter(q => !q.relevant.length)).toHaveLength(4);
  expect(new Set(corpus.queries.map(q => q.category))).toContain('duplicate-heading');
  expect(corpus.queries.find(q => q.id === 'eval-long')?.relevant[0].quote).toContain('manifest digest');
  expect(corpus.queries.find(q => q.id === 'eval-retention')?.relevant[0].quote).toContain('forty-five');
});
const query: Query = { id:'test', split:'development', category:'test', question:'test', query:'test', relevant:[{path:'notes/a.md',lineStart:1,lineEnd:2,quote:'a'}, {path:'notes/a.md',lineStart:4,lineEnd:5,quote:'b'}, {path:'notes/b.md',lineStart:1,lineEnd:2,quote:'c'}] };
test('file-level scoring credits relevant files and labels section coverage as an upper bound', () => {
  const score = scoreFileHits(query, ['notes/noise.md','notes/a.md'],5);
  expect(score.fileRecall).toBe(.5); expect(score.sectionCoverageUpperBound).toBe(2/3);
  expect(score.reciprocalRank).toBe(.5); expect(score.filePrecision).toBe(.5);
  expect(scoreFileHits(query,['notes/noise.md'],5).fileRecall).toBe(0);
  expect(scoreFileHits(query,[],5).reciprocalRank).toBe(0);
  expect(scoreFileHits(query,['notes/a.md','notes/a.md'],5).fileRecall).toBe(.5);
});
test('unanswerable lexical matches are false positives rather than recall or confidence', () => {
  const empty = { ...query, relevant: [] };
  expect(scoreFileHits(empty,['notes/a.md'],5)).toMatchObject({fileRecall:null,reciprocalRank:null,unanswerableReturnedHits:true,abstained:false});
  expect(scoreFileHits(empty,[],5)).toMatchObject({unanswerableReturnedHits:false,abstained:true});
  const summary = summariseScores([empty],[{id:'test',paths:['notes/a.md'],bytes:20}],5);
  expect(summary.unanswerableFalsePositiveRate).toBe(1);
  expect(summary.citationCorrectness).toBeNull(); expect(summary.citationSupport).toContain('unsupported');
});
test('context and percentile calculations are explicit and bounded', () => {
  expect(percentile([9,1,2,3],.5)).toBe(2); expect(percentile([9,1,2,3],.95)).toBe(9);
  expect(() => summariseScores([query],[],5)).toThrow('Missing query');
});

test('real production search baseline is provider-free and stable across independent rebuild/reopen', async () => {
  const child = Bun.spawn([process.execPath, join(import.meta.dir,'../scripts/note-retrieval-baseline.ts'),'--small','--repeat-build'], { env: {...process.env}, stdout:'pipe', stderr:'pipe' });
  const [out,err,exit] = await Promise.all([new Response(child.stdout).text(),new Response(child.stderr).text(),child.exited]);
  if(exit!==0)throw Error(err+out);
  const report = JSON.parse(out);
  expect(report.rankingStable).toBe(true); expect(report.reports).toHaveLength(4);
  expect(report.budgetSha256).toMatch(/^[0-9a-f]{64}$/);
  expect(report.budgetAssessment.completeFixtureMatrix).toBe(false);
  expect(report.budgetAssessment.allBudgetsSatisfied).toBe(false);
  expect(report.budgetAssessment.counts.pass).toBe(0);
  expect(report.rebuildChecks).toHaveLength(1);
  expect(report.rebuildChecks[0].identicalScoreTieStable).toBe(true);
  for(const run of report.reports){
    expect(run.metrics.development.fileRecall).toBeGreaterThan(0);
    expect(run.metrics.heldOut.unanswerableFalsePositiveRate).toBeGreaterThan(0);
    expect(run.results.filter((q:any)=>q.paths).every((q:any)=>q.repeatStable)).toBe(true);
    expect(run.metrics.heldOut.citationCorrectness).toBeNull();
    if(run.mode==='build') {
      expect([...run.results.find((q:any)=>q.id==='tie-checks').order].sort()).toEqual(['notes/tie-a.md','notes/tie-b.md']);
    }
    if(run.mode==='build')expect(run.results.find((q:any)=>q.id==='incremental-checks')).toMatchObject({editVisible:true,addVisible:true,deleteVisible:true,sameMetadataPreserved:true,sameMetadataEditDetected:true});
  }
},30000);
