import { expect, test } from 'bun:test';
import { join } from 'node:path';
import { createTempWorkspace } from '../helpers.js';

test('file-backed operations survive a real process restart without replaying uncertain work',async()=>{
  const ws=createTempWorkspace('addon-operation-restart-');
  async function run(phase:string,id?:string){
    const child=Bun.spawn([process.execPath,'--preload',join(import.meta.dir,'../setup-filesystem-isolation.ts'),join(import.meta.dir,'../fixtures/addon-operation-restart.ts'),phase,...(id?[id]:[])],{
      env:{...process.env,PICLAW_DB_IN_MEMORY:'0',PICLAW_WORKSPACE:ws.workspace,PICLAW_STORE:ws.store,PICLAW_DATA:ws.data},stdout:'pipe',stderr:'pipe',
    });
    const [out,err,code]=await Promise.all([new Response(child.stdout).text(),new Response(child.stderr).text(),child.exited]);
    expect(code,err).toBe(0);const line=out.split('\n').find(l=>l.startsWith('RESULT '));expect(line).toBeDefined();return JSON.parse(line!.slice(7));
  }
  try{
    const first=await run('admit'),second=await run('recover',first.id);
    expect(second.result).toMatchObject({id:first.id,status:'failed',reason:'interrupted_execution_unknown'});
    expect(second.duplicateId).toBe(first.id);expect(second.created).toBe(false);expect(second.executions).toBe(0);
  }finally{ws.cleanup();}
},15000);
