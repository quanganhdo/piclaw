import { expect, test } from 'bun:test';
import { join } from 'node:path';
import { createTempWorkspace } from '../helpers.js';

for (const scenario of ['roundtrip','admission','same-metadata','links','deleted','corrupt','unavailable','cancelled','transaction','oversized-output',
  'revoke-grant','replace-session','change-namespace','change-generation','change-coverage','dirty-during-read','replace-database','mode-change','cancel-during-read']) {
  test(`memory_get: ${scenario}`, async () => {
    const ws=createTempWorkspace('memory-get-');
    const child=Bun.spawn([process.execPath,join(import.meta.dir,'../fixtures/note-retrieval/get-worker.ts'),scenario],{
      env:{...process.env,PICLAW_WORKSPACE:ws.workspace,PICLAW_STORE:ws.store,PICLAW_DATA:ws.data,PICLAW_DB_IN_MEMORY:'0',PICLAW_DISABLE_BACKGROUND_WORKSPACE_INDEX:'1'},stdout:'pipe',stderr:'pipe'});
    const timer=setTimeout(()=>child.kill(),25000);
    try{
      const[out,err,code]=await Promise.all([new Response(child.stdout).text(),new Response(child.stderr).text(),child.exited]);
      if(code!==0)throw Error(`${scenario}: ${err.slice(-5000)} ${out.slice(-2000)}`);
      expect(out).toContain('MEMORY_GET_OK='+scenario);
    }finally{clearTimeout(timer);ws.cleanup();}
  },30000);
}
