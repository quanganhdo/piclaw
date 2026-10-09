import {expect,test} from 'bun:test';
import {fileURLToPath} from 'node:url';
test('idle admission rejects cancelled, revoked, reopened and replaced disk bindings while waiting',async()=>{
  const entry=fileURLToPath(new URL('../../../fixtures/idle-admission-disk.ts',import.meta.url));
  const launcher=fileURLToPath(new URL('../../../../scripts/local-test-priority.ts',import.meta.url));
  const cwd=fileURLToPath(new URL('../../../../',import.meta.url));
  const child=Bun.spawn([process.execPath,'--no-env-file',launcher,'--','--cwd',cwd,'--env','PICLAW_DB_IN_MEMORY=0','--',process.execPath,'--no-env-file',entry],{stdin:'ignore',stdout:'pipe',stderr:'pipe'});
  const timer=setTimeout(()=>child.kill('SIGKILL'),15000);
  try{const [exit,stdout,stderr]=await Promise.all([child.exited,new Response(child.stdout).text(),new Response(child.stderr).text()]);expect(exit,stderr||stdout).toBe(0);expect(JSON.parse(stdout.trim().split('\n').at(-1)!)).toMatchObject({cancelled:true,revoked:true,reopenedRejected:true,replacedRejected:true,noRowsCommitted:true});}
  finally{clearTimeout(timer);if(child.exitCode===null)child.kill('SIGKILL');await child.exited;}
},20000);
