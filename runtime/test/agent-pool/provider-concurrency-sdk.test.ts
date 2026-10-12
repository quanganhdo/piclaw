import {expect,test} from 'bun:test';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createAgentSession,ModelRuntime,DefaultResourceLoader,SessionManager,SettingsManager} from '@earendil-works/pi-coding-agent';

import {InMemoryCredentialStore} from '@earendil-works/pi-ai';
import {installOpenAICompletionsUsageCompatibility} from '../../src/agent-pool/openai-completions-usage-compat';

test('real SDK sessions share a provider while one response hangs',async()=>{
 const cwd=mkdtempSync(join(tmpdir(),'provider-concurrency-'));let slowEntered!:()=>void;const entered=new Promise<void>(resolve=>{slowEntered=resolve;});const requests:string[]=[];
 const server=Bun.serve({hostname:'127.0.0.1',port:0,async fetch(request){
  const body=await request.json() as any;const slow=JSON.stringify(body.messages).includes('hold this');requests.push(slow?'slow':'fast');
  if(slow){slowEntered();return new Response(new ReadableStream({start(controller){controller.enqueue(new TextEncoder().encode(': waiting\n\n'));}}),{headers:{'Content-Type':'text/event-stream'}});}
  const event=(delta:any,finish_reason:any=null)=>'data: '+JSON.stringify({id:'test',object:'chat.completion.chunk',created:1,model:'synthetic',choices:[{index:0,delta,finish_reason}]})+'\n\n';
  return new Response(event({role:'assistant',content:'fast reply'})+event({},'stop')+'data: [DONE]\n\n',{headers:{'Content-Type':'text/event-stream'}});
 }});
 const runtime=await ModelRuntime.create({credentials:new InMemoryCredentialStore(),modelsPath:null,refreshOnCreate:false,allowModelNetwork:false});
 installOpenAICompletionsUsageCompatibility(runtime);
 runtime.registerProvider('synthetic-local',{baseUrl:server.url.href+'v1',api:'openai-completions',apiKey:'disposable',models:[{id:'synthetic',name:'Synthetic',reasoning:false,input:['text'],cost:{input:0,output:0,cacheRead:0,cacheWrite:0},contextWindow:8192,maxTokens:512}]});
 const sessions:any[]=[];
 try{
  for(let i=0;i<2;i++){
   const loader=new DefaultResourceLoader({cwd,agentDir:join(cwd,'profile'),noExtensions:true,noSkills:true,noPromptTemplates:true,noThemes:true,disabledBuiltinExtensions:['codemode','tool-search','mcp'],systemPromptOverride:()=> 'Reply briefly.'});await loader.reload();
   const {session}=await createAgentSession({cwd,agentDir:join(cwd,'profile'),modelRuntime:runtime,model:runtime.getModel('synthetic-local','synthetic')!,sessionManager:SessionManager.inMemory(cwd),settingsManager:SettingsManager.inMemory({retry:{enabled:false},compaction:{enabled:false}}),resourceLoader:loader,tools:[],noTools:'all'});sessions.push(session);
  }
  const slow=sessions[0].prompt('hold this request');await entered;
  const started=Date.now();await Promise.race([sessions[1].prompt('reply immediately'),new Promise<never>((_,reject)=>setTimeout(()=>reject(Error('fast session blocked')),2000))]);
  expect(Date.now()-started).toBeLessThan(2000);expect(requests).toEqual(['slow','fast']);expect(sessions[1].messages.some((message:any)=>message.role==='assistant'&&message.content.some((part:any)=>part.text==='fast reply'))).toBe(true);
  await sessions[0].abort();await slow;expect(sessions[0].isStreaming).toBe(false);
 }finally{for(const session of sessions){await session.abort();session.dispose();}server.stop(true);rmSync(cwd,{recursive:true,force:true});}
},15000);

test('production usage wrapper completes at provider DONE without waiting for EOF',async()=>{
 const runtime=await ModelRuntime.create({credentials:new InMemoryCredentialStore(),modelsPath:null,refreshOnCreate:false,allowModelNetwork:false});installOpenAICompletionsUsageCompatibility(runtime);
 runtime.registerProvider('synthetic-local',{api:'openai-completions',baseUrl:'http://synthetic.invalid/v1',apiKey:'disposable',models:[{id:'synthetic',name:'Synthetic',reasoning:false,input:['text'],cost:{input:0,output:0,cacheRead:0,cacheWrite:0},contextWindow:8192,maxTokens:512}]});
 const model:any={id:'synthetic',name:'Synthetic',api:'openai-completions',provider:'synthetic-local',baseUrl:'http://synthetic.invalid/v1',reasoning:false,input:['text'],cost:{input:0,output:0,cacheRead:0,cacheWrite:0},contextWindow:8192,maxTokens:512};
 let close!:()=>void;const stream=new ReadableStream<Uint8Array>({start(controller){const data=(delta:any,finish_reason:any=null)=>'data: '+JSON.stringify({id:'test',object:'chat.completion.chunk',created:1,model:'synthetic',choices:[{index:0,delta,finish_reason}]})+'\n\n';controller.enqueue(new TextEncoder().encode(data({role:'assistant',content:'reply'})+data({},'stop')+'data: [DONE]\n\n'));close=()=>controller.close();}});
 let terminal=false;const consuming=(async()=>{for await(const event of runtime.streamSimple(model,{messages:[{role:'user',content:'test',timestamp:Date.now()}]},{apiKey:'disposable',fetch:async()=>new Response(stream,{headers:{'Content-Type':'text/event-stream'}})} as any)){if(event.type==='done'||event.type==='error'){terminal=true;}}})();
 await new Promise(resolve=>setTimeout(resolve,100));expect(terminal).toBe(true);await consuming;expect(terminal).toBe(true);
},5000);

test('shared transport directory timeout releases both prompts and coalesces held discovery',async()=>{
 const {chatTool}=await import('../../src/extensions/chat-tool');
 const {registerChatTransport,resetChatTransportRegistryForTests}=await import('../../src/extensions/chat-transport-registry');
 let release!:()=>void;const held=new Promise<void>(resolve=>{release=resolve;});let calls=0;
 registerChatTransport({id:'synthetic',kind:'bang',directory:async()=>{calls++;await held;return{transport:'synthetic',generated_at:new Date().toISOString(),entries:[]};},send:async()=>({status:'ok'})} as any);
 const callbacks:Array<(event:any,context:any)=>Promise<any>>=[];
 try{
  for(let i=0;i<2;i++)chatTool({registerTool:()=>{},on:(name:string,callback:any)=>{if(name==='before_agent_start')callbacks.push(callback);}} as any);
  let finished=0;const runs=callbacks.map(callback=>callback({systemPrompt:'base'},{sessionManager:{getSessionId:()=> 'synthetic'}}).then(()=>{finished++;}));
  await new Promise(resolve=>setTimeout(resolve,50));expect(calls).toBe(1);expect(finished).toBe(0);await Promise.all(runs);expect(finished).toBe(2);expect(calls).toBe(1);release();
 }finally{release();resetChatTransportRegistryForTests();}
});
