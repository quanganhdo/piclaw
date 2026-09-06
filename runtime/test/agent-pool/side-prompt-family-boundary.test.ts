import { expect, test } from 'bun:test';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { createTempWorkspace, setEnv } from '../helpers.js';
import { runSidePrompt, type SidePromptRunnerOptions } from '../../src/agent-pool/side-prompt-runner.js';
import { AgentPool } from '../../src/agent-pool.js';
import { withExecutionIdentity, type ExecutionIdentity } from '../../src/core/execution-context.js';

function setup() {
  const workspace=createTempWorkspace('side-prompt-boundary-');
  const restore=setEnv({PICLAW_WORKSPACE:workspace.workspace,PICLAW_STORE:workspace.store,PICLAW_DATA:workspace.data});
  mkdirSync(join(workspace.workspace,'.piclaw'));
  const path=join(workspace.workspace,'.piclaw/config.json');
  const configure=(mode:string)=>writeFileSync(path,JSON.stringify({domains:{access:{mode,...(mode==='isolated-containers'?{
    isolation:{component:'backend',backendId:'test',ownerUserId:'alice',gatewayUrl:'https://gateway.example',verificationKeyRef:'test-key'},
  }:{})}}}));
  return {path,configure,cleanup:()=>{restore();workspace.cleanup();}};
}
function dependencies(simple:boolean) {
  const calls:string[]=[];
  const fail=(name:string):never=>{calls.push(name);throw new Error(`Unexpected ${name}`);};
  const deps:SidePromptRunnerOptions={
    getOrCreate:async()=>fail('hydrate'),getOrCreateSideRuntime:async()=>fail('side-hydrate'),
    syncSideSessionFromMain:async()=>fail('sync'),modelRuntime:{streamSimple:()=>fail('model')},
    ...(simple?{sideStreamSimple:()=>fail('simple-model')}:{}),
  };
  return {deps,calls};
}

test('raw and AgentPool side entrypoints deny multi-user modes before any injected dependency or callback',async()=>{
  const fixture=setup();
  try{
    for(const mode of ['family-shared','isolated-containers'])for(const simple of [false,true])for(const inherited of [false,true]){
      fixture.configure(mode);const {deps,calls}=dependencies(simple);
      const identity:ExecutionIdentity|null=inherited?{mode:'family-shared',username:'alice',displayName:'Alice',role:'admin',rootChatJid:'web:alice',
        provenance:{actorUserId:'alice',ownerUserId:'alice',chatJid:'web:alice',kind:'interactive',authenticationSessionId:'claimed-login'}}:null;
      await withExecutionIdentity(identity,async()=>{
        const options={onEvent:()=>calls.push('event'),onTextDelta:()=>calls.push('text'),onThinkingDelta:()=>calls.push('thinking')};
        for(const chat of ['web:alice','web:bob']){
          const result=await runSidePrompt(chat,'private prompt',options,deps);
          expect(result).toEqual({status:'error',result:null,thinking:null,error:'Side prompts are unavailable in multi-user mode.',model:null});
          const publicResult=await AgentPool.prototype.runSidePrompt.call({...deps},chat,'private prompt',options);
          expect(publicResult).toEqual(result);
        }
      });
      expect(calls).toEqual([]);
    }
  }finally{fixture.cleanup();}
});

test('mode changes while hydration or side synchronisation waits deny the next side-prompt stage',async()=>{
  const fixture=setup();
  try{
    for(const stage of ['hydrate','simple-hydrate','side-hydrate','sync']){
      fixture.configure('single-user');const {deps,calls}=dependencies(stage==='simple-hydrate');
      deps.getOrCreate=async()=>{calls.push('hydrate');if(stage==='hydrate'||stage==='simple-hydrate')fixture.configure('family-shared');return {model:{provider:'test',id:'model'}} as any;};
      deps.getOrCreateSideRuntime=async()=>{calls.push('side-hydrate');if(stage==='side-hydrate')fixture.configure('family-shared');return {session:{subscribe:()=>{calls.push('subscribe');throw new Error('Unexpected subscribe');}}} as any;};
      deps.syncSideSessionFromMain=async()=>{calls.push('sync');fixture.configure('family-shared');};
      const result=await runSidePrompt('web:alice','prompt',{},deps);
      expect(result.error).toBe('Side prompts are unavailable in multi-user mode.');
      expect(calls).toEqual(stage==='sync'?['hydrate','side-hydrate','sync']:stage==='side-hydrate'?['hydrate','side-hydrate']:['hydrate']);
    }
  }finally{fixture.cleanup();}
});

test('malformed access config cannot fall back to single-user side execution',async()=>{
  const fixture=setup();
  try{
    writeFileSync(fixture.path,'{');const {deps,calls}=dependencies(true);
    await expect(runSidePrompt('web:default','prompt',{},deps)).rejects.toThrow('access configuration cannot default safely');
    expect(calls).toEqual([]);
  }finally{fixture.cleanup();}
});
