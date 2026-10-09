/** Public history allocation/retention observations. No forced GC during measured work. */
import assert from 'node:assert/strict';
import {mkdirSync,writeFileSync,statSync} from 'node:fs';import{join}from'node:path';
import {performance,monitorEventLoopDelay} from 'node:perf_hooks';
import {heapStats} from 'bun:jsc';
import {SessionManager} from '@earendil-works/pi-coding-agent';
import {assertPathWithinTestFilesystemIsolation} from '../../scripts/test-filesystem-isolation.js';
const root=process.env.PICLAW_WORKSPACE!;assertPathWithinTestFilesystemIsolation(root,process.env,{allowRoot:false});
const size=Number(process.argv[2]??2000);assert([2000,5000].includes(size));
const file=join(root,'synthetic-retention.jsonl');mkdirSync(root,{recursive:true});
const lines=[JSON.stringify({type:'session',version:3,id:'55555555-5555-4555-8555-555555555555',timestamp:'2026-01-01T00:00:00Z',cwd:root})];
for(let n=0;n<size;n++)lines.push(JSON.stringify({type:'message',id:'retention-'+n,parentId:n?'retention-'+(n-1):null,timestamp:'2026-01-01T00:00:00Z',message:{role:'user',content:'Synthetic history '+n+' '+('z'.repeat(2048)),timestamp:n}}));
writeFileSync(file,lines.join('\n')+'\n');lines.length=0;
let collected=0;const registry=new FinalizationRegistry(()=>{collected++});const retained:SessionManager[]=[];
const loop=monitorEventLoopDelay({resolution:1});loop.enable();await Bun.sleep(10);loop.reset();const memoryBefore=process.memoryUsage(),cpu=process.cpuUsage(),start=performance.now(),observations=[];
try{
 for(let batch=0;batch<12;batch++){
  const at=performance.now();for(let n=0;n<5;n++){const session=SessionManager.open(file);assert.equal(session.getEntries().length,size);const context=session.buildSessionContext();assert.equal(context.messages.length,size);registry.register(session,'synthetic');if(batch<2)retained.push(session);}
  await Bun.sleep(5);observations.push({batch,workMs:performance.now()-at,collected,retainedManagers:retained.length,memory:process.memoryUsage()});
 }
 // Retained controls stay usable throughout; finalizers concern managers whose
 // strong references were dropped. No WeakRef dereference keeps them alive.
 for(const s of retained)assert.equal(s.buildSessionContext().messages.length,size);
 await Bun.sleep(100);loop.disable();const measured={memoryBefore,wallMs:performance.now()-start,cpu:process.cpuUsage(cpu),naturalFinalizedManagers:collected,registeredManagers:60,stronglyRetainedControls:retained.length,eventLoop:{samples:loop.count,resolutionMs:1,maxMs:loop.max/1e6,meanMs:loop.mean/1e6},observations};
 const beforeForced=process.memoryUsage();retained.length=0;
 // Separate diagnostic only, outside natural measured window.
 const gcStart=performance.now();Bun.gc(true);await Bun.sleep(20);const forcedDiagnostic={wallMs:performance.now()-gcStart,memoryBefore:beforeForced,memoryAfter:process.memoryUsage(),collectedAfterExplicitGc:collected,heapAfterExplicitGc:{heapSize:heapStats().heapSize,objectCount:heapStats().objectCount}};
 console.log(JSON.stringify({runtime:Bun.version,entries:size,fixtureBytes:statSync(file).size,measured,forcedDiagnostic,scope:'Owned synthetic public SessionManager open/context workload. No explicit GC in measured loop; natural finalizers and memory samples establish reclamation observations only. Finalization timing is nondeterministic, event-loop stalls cannot be uniquely attributed to GC; in-report measured CPU excludes setup and forced diagnostics; an external whole-child CPU profile includes both. Memory samples are process-wide, not manager-specific. Fixture byte size varies with the synthetic workspace path in the header. No leak absence, automatic GC per-pause guarantee, real prompts/model/provider/live state.'}));
}finally{loop.disable()}
