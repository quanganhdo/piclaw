import { expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
const root=resolve(import.meta.dir,'../../..');
const report=JSON.parse(readFileSync(resolve(root,'docs/development/receipts/remaining-performance-audit.json'),'utf8'));
const text=readFileSync(resolve(root,'docs/development/remaining-performance-audit.md'),'utf8');
test('audit preserves rejected prototypes and incomplete acceptance',()=>{
 expect(report.productionRuntimeChanged).toBe(false);
 expect(report.rejectedFts.runtimeQueryChanged).toBe(false);
 expect(report.rejectedFts.schemaChanged).toBe(false);
 expect(report.rejectedFts.targetFirst).toContain('rejected');
 expect(report.rejectedFts.adaptive64).toContain('rejected');
 expect(report.limits).toMatchObject({productionDatabase:false,providerSpend:false,realCredentials:false,restart:false,deployment:false,noAutomaticGcAcceptance:true});
 expect(report.remaining.length).toBeGreaterThan(3);
 expect(text).toContain('does not complete performance acceptance');
 expect(text).toContain('different workloads');
 expect(text).toContain('counting stubs');
});
test('measured scopes and outliers remain separately recorded',()=>{
 expect(report.initial.runs).toBe(23);
 expect(report.initial.classes).toEqual({comparablePlainAndInstrumented:18,wholeChildCpu:3,finalHeapSnapshots:2});
 expect(report.notes.sourceOpens).toBe(200);
 expect(report.notes.separateFinalSmoke).toBe(true);
 expect(report.scheduler.initialOutlier.eventMaxMs).toBeGreaterThan(400);
 expect(report.scheduler.attributedLogInsertMs.calls).toBe(20);
 expect(report.scheduler.timerLatenessMs.some((n:number)=>n>40)).toBe(true);
 expect(report.writerReads.absoluteLatencyBound).toBe(false);
 expect(report.writerReads.runs).toHaveLength(3);
 for(const run of report.writerReads.runs){expect(run.reads).toBe(20);expect(run.revokedDenied).toBe(true);}
});
