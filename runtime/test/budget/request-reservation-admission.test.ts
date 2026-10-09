import { expect,test } from 'bun:test';
import { isolateBudgetTestDatabase } from './fixture.js';
import { createTempWorkspace } from '../helpers.js';
import { ensureBudgetWork,saveBudgetCap } from '../../src/db/budget-limits.js';
import { getBudgetRequest } from '../../src/db/budget-request-reservations.js';
import { admitBudgetRequest,admitBudgetRequestDispatch } from '../../src/budget/request-reservation-admission.js';
isolateBudgetTestDatabase();
const binding={id:'async-request',workId:'async-work',chatJid:'web:async',providerId:'fixture',modelId:'fixture',accountRef:'fixture',amountMicros:60};
function fixture(){ensureBudgetWork({id:binding.workId,chatJid:binding.chatJid,executionKind:'interactive'});saveBudgetCap({scope:'task',metric:'api_usd_micros',amount:100,workId:binding.workId});}
test('async host admission snapshots caller binding and verifies authority before commit',async()=>{
 fixture();let checks=0;const captured={...binding};const row=await admitBudgetRequest(captured,{signal:new AbortController().signal,authorise(){checks++;captured.amountMicros=1;}});
 expect(row.amount_microusd).toBe(60);expect(checks).toBe(2);
 expect((await admitBudgetRequestDispatch(binding,{signal:new AbortController().signal,authorise(){}})).state).toBe('dispatched');
});
test('revoked post-mutation admission rolls back its reservation',async()=>{
 fixture();let checks=0;
 await expect(admitBudgetRequest(binding,{signal:new AbortController().signal,authorise(){if(++checks===2)throw Error('revoked');}})).rejects.toThrow('revoked');
 expect(getBudgetRequest(binding.id)).toBeNull();
});
test('dispatch authority revoked after mutation rolls back to its original hold',async()=>{
 fixture();await admitBudgetRequest(binding,{signal:new AbortController().signal,authorise(){}});let checks=0;
 await expect(admitBudgetRequestDispatch(binding,{signal:new AbortController().signal,authorise(){if(++checks===4)throw Error('revoked-after-dispatch');}})).rejects.toThrow('revoked-after-dispatch');
 expect(checks).toBe(4);expect(getBudgetRequest(binding.id)?.state).toBe('reserved');
});
test('dispatch aborted after mutation rolls back to its original hold',async()=>{
 fixture();await admitBudgetRequest(binding,{signal:new AbortController().signal,authorise(){}});let checks=0;const aborter=new AbortController();
 await expect(admitBudgetRequestDispatch(binding,{signal:aborter.signal,authorise(){if(++checks===4)aborter.abort(Error('aborted-after-dispatch'));}})).rejects.toThrow('aborted-after-dispatch');
 expect(getBudgetRequest(binding.id)?.state).toBe('reserved');
});
test('actual reservation contention yields to timers, restores policy and denies revocation',async()=>{
 const entry=new URL('../fixtures/budget-request-admission-disk.ts',import.meta.url).pathname;
 const launcher=new URL('../../scripts/local-test-priority.ts',import.meta.url).pathname;
 const workspace=createTempWorkspace('budget-admission-child-');
 const child=Bun.spawn([process.execPath,'--no-env-file',launcher,'--','--env','PICLAW_DB_IN_MEMORY=0','--env',`PICLAW_WORKSPACE=${workspace.workspace}`,'--env',`PICLAW_STORE=${workspace.store}`,'--env',`PICLAW_DATA=${workspace.data}`,'--',process.execPath,'--no-env-file',entry],{stdin:'ignore',stdout:'pipe',stderr:'pipe'});
 const timer=setTimeout(()=>child.kill('SIGKILL'),10000);
 try{const [exit,stdout,stderr]=await Promise.all([child.exited,new Response(child.stdout).text(),new Response(child.stderr).text()]);expect(exit,stderr).toBe(0);expect(JSON.parse(stdout.trim().split('\n').at(-1)!)).toMatchObject({reservedAfterRelease:true,revokedDispatchDenied:true,cancelledNoHold:true,busyTimeoutRestored:true,replacedDatabaseDenied:true});}
 finally{clearTimeout(timer);if(child.exitCode===null)child.kill('SIGKILL');await child.exited;workspace.cleanup();}
},15000);
