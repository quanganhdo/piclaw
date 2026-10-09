import { expect,test } from 'bun:test';
import type { AssistantMessage,AssistantMessageEvent,FetchFunction } from '@earendil-works/pi-ai';
import { childRequestExecutor } from '../../src/addons/child-request-executor.js';
const endpoint='https://synthetic.invalid/chat/completions';
const message:AssistantMessage={role:'assistant',content:[],api:'openai-completions',provider:'fixture',model:'fixture',stopReason:'stop',timestamp:1,usage:{input:1,output:1,cacheRead:0,cacheWrite:0,totalTokens:2,cost:{input:1e-6,output:1e-6,cacheRead:0,cacheWrite:0,total:2e-6}}};
const model={id:'fixture',provider:'fixture',api:'openai-completions' as const,name:'fixture',baseUrl:endpoint,reasoning:false,input:['text' as const],contextWindow:100,maxTokens:10,cost:{input:1,output:1,cacheRead:0,cacheWrite:0}};
function gate(){let resolve!:()=>void;const promise=new Promise<void>(done=>{resolve=done;});return{promise,resolve};}
const consume=async(source:AsyncIterable<AssistantMessageEvent>)=>{const result=[];for await(const event of source)result.push(event.type);return result;};
test('prepared executor uses one admitted fetch with retries off and raw settlement distinct',async()=>{
 let prepared=0,sends=0,dispatches=0;const raw=gate();
 const prepare=childRequestExecutor({model,endpoint,authorise(){},fetch:(async()=>{sends++;return new Response('synthetic');}) as FetchFunction,
 async prepare(){prepared++;return{start(options){expect(options.maxRetries).toBe(0);return{settled:raw.promise,events:(async function*(){const response=await options.fetch!(endpoint);await response.text();yield{type:'start',partial:message} as AssistantMessageEvent;yield{type:'done',reason:'stop',message} as AssistantMessageEvent;})()};}};}});
 const ready=await prepare({messages:[]},{},new AbortController().signal);const execution=ready.start(async()=>{dispatches++;});const iterator=execution.events[Symbol.asyncIterator]();await iterator.next();await iterator.next();let done=false;void execution.settled.then(()=>{done=true;});const end=iterator.next();await Bun.sleep(0);expect(done).toBe(false);raw.resolve();await end;await execution.settled;expect(prepared).toBe(1);expect(sends).toBe(1);expect(dispatches).toBe(1);
});
test('malformed provider after send drains raw tail and rejects completion',async()=>{
 const raw=gate();let cancelled=false;const prepare=childRequestExecutor({model,endpoint,authorise(){},fetch:(async()=>new Response(new ReadableStream({cancel(){cancelled=true;}}))) as FetchFunction,
 async prepare(){return{start(options){return{settled:raw.promise,events:(async function*(){await options.fetch!(endpoint);yield{type:'done',reason:'stop',message:{...message,model:'wrong'}} as AssistantMessageEvent;})()};}};}});
 const ready=await prepare({messages:[]},{},new AbortController().signal);const execution=ready.start(async()=>{});const output=consume(execution.events).then(()=>false,()=>true);await Bun.sleep(0);let done=false;void output.then(()=>{done=true;});expect(done).toBe(false);raw.resolve();expect(await output).toBe(true);await expect(execution.settled).rejects.toThrow('settlement_failed');expect(cancelled).toBe(true);
});
test('provider observation byte cap denies hostile events without publishing diagnostic text',async()=>{
 const prepare=childRequestExecutor({model,endpoint,authorise(){},fetch:(async()=>new Response(null)) as FetchFunction,
 async prepare(){return{start(options){return{settled:Promise.resolve(),events:(async function*(){await options.fetch!(endpoint);await options.onProviderStreamEvent?.({private:'x'.repeat(16*1024*1024)},model);yield{type:'done',reason:'stop',message} as AssistantMessageEvent;})()};}};}});
 const ready=await prepare({messages:[]},{},new AbortController().signal);const execution=ready.start(async()=>{});await expect(consume(execution.events)).rejects.toThrow('execution_failed');await expect(execution.settled).rejects.toThrow('settlement_failed');
});
