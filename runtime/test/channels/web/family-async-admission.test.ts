import {expect,test}from'bun:test';
import{join}from'node:path';
import{createTempWorkspace}from'../../helpers.js';
for(const mode of['release','abort','revoke','home','target','reopen','replace','config','payload','rollback'])test(`family async admission preserves captured authority and atomicity: ${mode}`,async()=>{
 const ws=createTempWorkspace('family-async-');const child=Bun.spawn([process.execPath,'--no-env-file',join(import.meta.dir,'../../fixtures/pi103-family-async-admission.ts'),mode],{cwd:join(import.meta.dir,'../../..'),env:{...process.env,PICLAW_WORKSPACE:ws.workspace,PICLAW_STORE:ws.store,PICLAW_DATA:ws.data,PICLAW_DB_IN_MEMORY:'0'},stdout:'pipe',stderr:'pipe'});const timer=setTimeout(()=>child.kill('SIGKILL'),10000);
 try{const[exit,out,err]=await Promise.all([child.exited,new Response(child.stdout).text(),new Response(child.stderr).text()]);expect(exit,err||out).toBe(0);const r=JSON.parse(out.trim().split('\n').at(-1)!);expect(r).toMatchObject({mode,noUnexpectedRows:true,timeoutRestored:true,accepted:['release','payload'].includes(mode)});}finally{clearTimeout(timer);if(child.exitCode===null){child.kill('SIGKILL');await child.exited}ws.cleanup()}
},12000);
