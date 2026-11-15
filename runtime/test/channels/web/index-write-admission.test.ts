import {expect,test} from 'bun:test';
import {createTempWorkspace} from '../../helpers.js';
test('Index invalidation waits without blocking and commits both representations before publishing',async()=>{
 const workspace=createTempWorkspace('http-state-admission-child-');
 const launcher=new URL('../../../scripts/local-test-priority.ts',import.meta.url).pathname;
 const fixture=new URL('../../fixtures/index-write-admission.ts',import.meta.url).pathname;
 const child=Bun.spawn([process.execPath,'--no-env-file',launcher,'--','--env','PICLAW_DB_IN_MEMORY=0','--env','PICLAW_ACCESS_MODE=single-user','--env',`PICLAW_WORKSPACE=${workspace.workspace}`,'--env',`PICLAW_STORE=${workspace.store}`,'--env',`PICLAW_DATA=${workspace.data}`,'--',process.execPath,'--no-env-file',fixture],{stdin:'ignore',stdout:'pipe',stderr:'pipe'});
 const timer=setTimeout(()=>child.kill('SIGKILL'),10000);
 try{
  const[exit,stdout,stderr]=await Promise.all([child.exited,new Response(child.stdout).text(),new Response(child.stderr).text()]);
  expect(exit,`${stderr}\n${stdout}`).toBe(0);
  expect(JSON.parse(stdout.trim().split('\n').at(-1)!)).toEqual({kind:'index-write-admission',cases:7,realWal:true});
 }finally{clearTimeout(timer);if(child.exitCode===null)child.kill('SIGKILL');await child.exited;workspace.cleanup();}
},15000);
