import { expect, test } from 'bun:test';
import { mkdirSync, writeFileSync, symlinkSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { createTempWorkspace } from '../helpers.js';

// Shipping subprocess runner is copied into the fixture by the explicit owner
// qualification script. This test uses the current packaged CLI, never a provider.
const source=process.env.PICLAW_DELEGATE_SHIPPING_SOURCE;
const run=source?test:test.skip;
run('shipping Delegate runner executes Pi1.1.0 JSON/no-session with parent thinking and cleanup',async()=>{
 if(!source||!source.startsWith('/workspace/'))throw Error('Explicit shipping source required');
 const ws=createTempWorkspace('pi110-delegate-child-'),profile=join(ws.base,'profile');mkdirSync(profile,{mode:0o700});
 const cli=resolve(import.meta.dir,'../../../node_modules/@earendil-works/pi-coding-agent/dist/bundle/cli.js');
 const extension=join(ws.base,'fixture.ts');symlinkSync(resolve(import.meta.dir,'../../../node_modules'),join(ws.base,'node_modules'));
 writeFileSync(extension,`import{AssistantMessageEventStream}from'@earendil-works/pi-ai';export default pi=>{const stream=(model,context,options)=>{const s=new AssistantMessageEventStream();const message={role:'assistant',api:model.api,provider:model.provider,model:model.id,content:[{type:'text',text:'SHIPPING_CHILD_'+pi.getThinkingLevel()}],stopReason:'stop',timestamp:1,usage:{input:1,output:1,cacheRead:0,cacheWrite:0,totalTokens:2,cost:{input:0,output:0,cacheRead:0,cacheWrite:0,total:0}}};s.push({type:'start',partial:message});s.push({type:'done',reason:'stop',message});s.end(message);return s;};pi.registerProvider('fixture',{baseUrl:'http://127.0.0.1:1',apiKey:'synthetic',api:'openai-completions',models:[{id:'fixture',name:'fixture',reasoning:true,input:['text'],contextWindow:1000,maxTokens:100,cost:{input:0,output:0,cacheRead:0,cacheWrite:0}}],streamSimple:stream});};`);
 const previous=process.env.PI_CODING_AGENT_DIR,home=process.env.HOME;
 try{
  process.env.PI_CODING_AGENT_DIR=profile;process.env.HOME=ws.base;
  const {runDelegateProcess,delegateProcessFailure}=await import(source);
  const args=['--mode','json','--no-session','--no-extensions','--model','fixture/fixture','--thinking','medium','--tools','read','-e',extension];
  const result=await runDelegateProcess(args,'Synthetic fixture only',10000,undefined,undefined,{command:process.execPath,argsPrefix:[cli],label:'exact1.1.0fixture'});
  expect(delegateProcessFailure(result)).toBeNull();expect(result.text).toContain('SHIPPING_CHILD_medium');expect(result.provider).toBe('fixture');expect(result.model).toBe('fixture');
  expect([...new Bun.Glob('**/*.jsonl').scanSync(profile)]).toEqual([]);
 }finally{if(previous===undefined)delete process.env.PI_CODING_AGENT_DIR;else process.env.PI_CODING_AGENT_DIR=previous;if(home===undefined)delete process.env.HOME;else process.env.HOME=home;ws.cleanup();}
},15000);
