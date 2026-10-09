import {expect,test} from 'bun:test';
import {fileURLToPath} from 'node:url';

test('queued admission refuses reopened handles and replaced database files during retry',async()=>{
  const entry=fileURLToPath(new URL('../../fixtures/queued-admission-binding.ts',import.meta.url));
  // The child owns its disposable disk database; no live snapshot/path is used.
  const child=Bun.spawn([process.execPath,'--no-env-file',fileURLToPath(new URL('../../../scripts/local-test-priority.ts',import.meta.url)),'--','--cwd',fileURLToPath(new URL('../../../',import.meta.url)),'--env','PICLAW_DB_IN_MEMORY=0','--',process.execPath,'--no-env-file',entry],{stdin:'ignore',stdout:'pipe',stderr:'pipe'});
  const timer=setTimeout(()=>child.kill('SIGKILL'),15000);
  try{const [exit,stdout,stderr]=await Promise.all([child.exited,new Response(child.stdout).text(),new Response(child.stderr).text()]);expect(exit,stderr||stdout).toBe(0);expect(stdout).toContain('QUEUE_BINDING_REJECTED');}
  finally{clearTimeout(timer);if(child.exitCode===null)child.kill('SIGKILL');await child.exited;}
},20000);
