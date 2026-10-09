import { expect, test } from 'bun:test';
import { join } from 'node:path';
import { createTempWorkspace } from '../helpers';
test('public SDK adapter-Native-adapter reload retains history with one acknowledged owner', async () => {
  const ws = createTempWorkspace('native-sdk-switch-');
  const child = Bun.spawn([process.execPath, '--no-env-file', join(import.meta.dir, 'fixtures/mcp-native-sdk-switch.ts')], {cwd:ws.workspace,env:{PATH:process.env.PATH,HOME:'/nonexistent',PICLAW_WORKSPACE:ws.workspace,PI_CODING_AGENT_DIR:join(ws.workspace,'agent'),PI_OFFLINE:'1',PI_TELEMETRY:'0',OTEL_SDK_DISABLED:'true'},stdin:'ignore',stdout:'pipe',stderr:'pipe'});
  const timer=setTimeout(()=>child.kill('SIGKILL'),15000);
  try{
    const [exit,stdout,stderr]=await Promise.all([child.exited,new Response(child.stdout).text(),new Response(child.stderr).text()]);
    expect(exit,stderr).toBe(0);
    expect(JSON.parse(stdout.trim().split('\n').at(-1)!)).toEqual({adapterNativeAdapter:true,historyPreserved:true,acquired:3,released:3,soleOwner:true});
  }finally{clearTimeout(timer);if(child.exitCode===null)child.kill('SIGKILL');await child.exited;ws.cleanup();}
},20000);
for (const mode of ['success', 'close-failure', 'startup-failure']) test(`Settings controller Native switch ${mode} uses the public SDK owner barrier`, async () => {
  const ws=createTempWorkspace('native-controller-');
  const child=Bun.spawn([process.execPath,'--no-env-file',join(import.meta.dir,'fixtures/mcp-native-controller-switch.ts'),mode],{cwd:ws.workspace,env:{PATH:process.env.PATH,HOME:'/nonexistent',PICLAW_WORKSPACE:ws.workspace,PI_CODING_AGENT_DIR:join(ws.workspace,'agent'),PI_OFFLINE:'1',PI_TELEMETRY:'0',OTEL_SDK_DISABLED:'true'},stdin:'ignore',stdout:'pipe',stderr:'pipe'});
  const timer=setTimeout(()=>child.kill('SIGKILL'),15000);
  try{
    const [exit,stdout,stderr]=await Promise.all([child.exited,new Response(child.stdout).text(),new Response(child.stderr).text()]);expect(exit,stderr).toBe(0);
    expect(JSON.parse(stdout.trim().split('\n').at(-1)!)).toEqual(mode==='success'?{mode,generations:3,quarantines:0,resumes:2,historyPreserved:true,passed:true}:{mode,generations:mode==='startup-failure'?2:1,quarantines:1,resumes:0,historyPreserved:true,passed:true});
  }finally{clearTimeout(timer);if(child.exitCode===null)child.kill('SIGKILL');await child.exited;ws.cleanup();}
},20000);
