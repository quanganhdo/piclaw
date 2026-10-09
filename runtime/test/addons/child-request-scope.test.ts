import { expect, test } from 'bun:test';
import type { AssistantMessage, AssistantMessageEvent } from '@earendil-works/pi-ai';
import { ChildRequestError, createChildRequestScope, type ChildRequestHostDependencies } from '../../src/addons/child-request-scope.js';
function gate() { let resolve!:()=>void; const promise=new Promise<void>(done=>{resolve=done;});return {promise,resolve}; }
const message=():AssistantMessage=>({role:'assistant',content:[{type:'text',text:'synthetic'}],api:'openai-completions',provider:'fixture',model:'fixture',usage:{input:1,output:1,cacheRead:0,cacheWrite:0,totalTokens:2,cost:{input:0.000001,output:0.000001,cacheRead:0,cacheWrite:0,total:0.000002}},stopReason:'stop',timestamp:1});
const events=():AssistantMessageEvent[]=>[{type:'start',partial:message()},{type:'done',reason:'stop',message:message()}];
function fixture(overrides:Partial<ChildRequestHostDependencies>={}) {
 const counts={reserve:0,dispatch:0,prepare:0,abandon:0,settle:0,produced:0};let number=0;
 const deps:ChildRequestHostDependencies={
  plan:{version:1,execution:'parent-provider-proxy',model:{provider:'fixture',id:'fixture'},mcp:'none'},signal:new AbortController().signal,deadlineAt:Date.now()+5000,
  authorise(){},validate(context,options){return {context,options};},binding(){return {id:`host-${++number}`,workId:'work',chatJid:'web:fixture',providerId:'fixture',modelId:'fixture',accountRef:'generation',amountMicros:10};},
  async reserve(){counts.reserve++;},async dispatch(){counts.dispatch++;},async abandon(){counts.abandon++;},async settle(){counts.settle++;},
  async prepare(){counts.prepare++;return {start(beforeSend){const settled=gate();return {settled:settled.promise,events:(async function*(){try{await beforeSend();for(const event of events()){counts.produced++;yield event;}}finally{settled.resolve();}})()};}};},...overrides,
 };
 return {counts,deps,scope:createChildRequestScope(deps)};
}
const input={messages:[{role:'user' as const,content:'synthetic',timestamp:1}]};
const consume=async(stream:AsyncIterable<AssistantMessageEvent>)=>{const output=[];for await(const event of stream)output.push(event);return output;};
test('host scope reserves, dispatches exactly once and settles after terminal/raw tail',async()=>{
 const f=fixture();const stream=f.scope.stream(input,{}, {requestId:'wire-1'});expect((await consume(stream)).map(e=>e.type)).toEqual(['start','done']);await stream.settled;
 expect(f.counts).toMatchObject({reserve:1,dispatch:1,settle:1,abandon:0});await f.scope.close();
});
test('one slot backpressure prevents eager provider output and close drains raw execution',async()=>{
 const f=fixture();const stream=f.scope.stream(input,{}, {requestId:'wire-1'});await Bun.sleep(0);expect(f.counts.produced).toBe(1);
 await f.scope.close();await stream.settled;expect(f.counts.produced).toBe(2);expect(f.counts.settle).toBe(1);
});
test('scope refuses overlapping, duplicate IDs and post-close admission',async()=>{
 const f=fixture();const first=f.scope.stream(input,{}, {requestId:'wire-1'});expect(()=>f.scope.stream(input,{}, {requestId:'wire-2'})).toThrow('invalid_request');await consume(first);await first.settled;
 expect(()=>f.scope.stream(input,{}, {requestId:'wire-1'})).toThrow('invalid_request');await f.scope.close();expect(()=>f.scope.stream(input,{}, {requestId:'wire-3'})).toThrow('cancelled');
});
test('cancel during raw auth preparation stops delivery but close waits for late tail',async()=>{
 const auth=gate();let started=0;const f=fixture({async prepare(){await auth.promise;return {start(){started++;throw Error('must not start');}};}});
 const stream=f.scope.stream(input,{}, {requestId:'wire-1'});await Bun.sleep(0);stream.cancel();let closed=false;const close=f.scope.close().then(()=>{closed=true;});await Bun.sleep(0);expect(closed).toBe(false);
 auth.resolve();await close;await stream.settled;expect(started).toBe(0);expect(f.counts.abandon).toBe(1);await expect(consume(stream)).rejects.toThrow('cancelled');
});
test('terminal delivery is separate from raw executor and settlement completion',async()=>{
 const tail=gate();const f=fixture({async prepare(){return {start(before){return {settled:tail.promise,events:(async function*(){await before();yield* events();})()};}};}});
 const stream=f.scope.stream(input,{}, {requestId:'wire-1'});const iterator=stream[Symbol.asyncIterator]();expect((await iterator.next()).value?.type).toBe('start');expect((await iterator.next()).value?.type).toBe('done');
 let done=false;void stream.settled.then(()=>{done=true;});await Bun.sleep(0);expect(done).toBe(false);tail.resolve();await stream.settled;expect(f.counts.settle).toBe(1);await f.scope.close();
});
test('auth denial exposes finite errors and releases only unsent hold',async()=>{
 const f=fixture({async prepare(){throw Error('PRIVATE_CREDENTIAL_VALUE');}});const stream=f.scope.stream(input,{}, {requestId:'wire-1'});await expect(consume(stream)).rejects.toThrow('execution_failed');await stream.settled;
 expect(f.counts.dispatch).toBe(0);expect(f.counts.abandon).toBe(1);await f.scope.close();
});
test('revocation after dispatch denies output and retains unresolved accounting',async()=>{
 let revoked=false;const f=fixture({authorise(){if(revoked)throw Error('revoked');},async dispatch(){revoked=true;}});const stream=f.scope.stream(input,{}, {requestId:'wire-1'});await expect(consume(stream)).rejects.toThrow('execution_failed');await expect(stream.settled).rejects.toThrow('settlement_failed');
 expect(f.counts.abandon).toBe(1);expect(f.counts.settle).toBe(0);await expect(f.scope.close()).rejects.toThrow('settlement_failed');
});
test('late provider result after cancellation still settles captured usage',async()=>{
 const tail=gate();const f=fixture({async prepare(){return {start(before){return {settled:Promise.resolve(),events:(async function*(){await before();yield events()[0];await tail.promise;yield events()[1];})()};}};}});
 const stream=f.scope.stream(input,{}, {requestId:'wire-1'});const iterator=stream[Symbol.asyncIterator]();await iterator.next();stream.cancel();tail.resolve();await stream.settled;expect(f.counts.settle).toBe(1);await f.scope.close();
});
test('settlement storage failure rejects settled and sticky close instead of success',async()=>{
 const f=fixture({async settle(){throw Error('disk fault');}});const stream=f.scope.stream(input,{}, {requestId:'wire-1'});await expect(consume(stream)).rejects.toThrow('execution_failed');await expect(stream.settled).rejects.toThrow('settlement_failed');await expect(f.scope.close()).rejects.toThrow('settlement_failed');expect(f.counts.abandon).toBe(1);
});
test('wrong response model and repeated actual-send admission fail closed',async()=>{
 for(const repeated of [false,true]){
  const f=fixture({async prepare(){return {start(before){return {settled:Promise.resolve(),events:(async function*(){await before();if(repeated)await before();yield events()[0];yield {type:'done',reason:'stop',message:{...message(),model:'other'}} as AssistantMessageEvent;})()};}};}});
  const stream=f.scope.stream(input,{}, {requestId:'wire-1'});await expect(consume(stream)).rejects.toThrow('execution_failed');await expect(stream.settled).rejects.toThrow('settlement_failed');expect(f.counts.dispatch).toBe(1);expect(f.counts.abandon).toBe(1);await expect(f.scope.close()).rejects.toThrow('settlement_failed');
 }
});
test('public error projection removes raw provider diagnostics while retaining host usage',async()=>{
 const raw={...message(),stopReason:'error' as const,errorMessage:'PRIVATE_DETAIL',content:[{type:'text' as const,text:'PRIVATE_DETAIL'}]};
 const f=fixture({async prepare(){return {start(before){return {settled:Promise.resolve(),events:(async function*(){await before();yield {type:'error',reason:'error',error:raw} as AssistantMessageEvent;})()};}};}});
 const stream=f.scope.stream(input,{}, {requestId:'wire-1'});const output=await consume(stream);await stream.settled;expect(JSON.stringify(output)).not.toContain('PRIVATE_DETAIL');expect(output[0]).toMatchObject({type:'error',error:{content:[],errorMessage:'Model request failed.'}});expect(f.counts.settle).toBe(1);await f.scope.close();
});
test('close publishes one promise before a synchronous cancellation listener reenters',async()=>{
 let reentrant:Promise<void>|undefined;let scope:ReturnType<typeof createChildRequestScope>;
 const f=fixture({async prepare(_context,_options,signal){signal.addEventListener('abort',()=>{reentrant=scope.close();},{once:true});return {start(before){return {settled:Promise.resolve(),events:(async function*(){await before();yield* events();})()};}};}});scope=f.scope;
 const stream=scope.stream(input,{}, {requestId:'wire-1'});await Bun.sleep(0);const close=scope.close();await close;await stream.settled;expect(reentrant).toBe(close);
});
test('disclosed response model mismatch retains ambiguous hold instead of fake settlement',async()=>{
 const f=fixture({async prepare(){return {start(before){return {settled:Promise.resolve(),events:(async function*(){await before();yield events()[0];yield {type:'done',reason:'stop',message:{...message(),responseModel:'other'}} as AssistantMessageEvent;})()};}};}});
 const stream=f.scope.stream(input,{}, {requestId:'wire-1'});await expect(consume(stream)).rejects.toThrow('execution_failed');await expect(stream.settled).rejects.toThrow('settlement_failed');expect(f.counts.settle).toBe(0);expect(f.counts.abandon).toBe(1);await expect(f.scope.close()).rejects.toThrow('settlement_failed');
});
test('validation reentrancy cannot admit a sibling request before active tracking',async()=>{
 let scope:ReturnType<typeof createChildRequestScope>;let checked=false;
 const f=fixture({validate(context,options){if(!checked){checked=true;expect(()=>scope.stream(context,options,{requestId:'sibling'})).toThrow('invalid_request');}return{context,options};}});scope=f.scope;
 const stream=scope.stream(input,{}, {requestId:'wire-1'});await consume(stream);await stream.settled;expect(f.counts.reserve).toBe(1);await scope.close();
});
test('expired scope and binding mismatch deny before any async reservation',async()=>{
 const f=fixture();expect(()=>createChildRequestScope({...f.deps,deadlineAt:Date.now()-1})).toThrow('unavailable');
 const other=fixture({binding(){return {...f.deps.binding(input,{}),modelId:'other'};}});expect(()=>other.scope.stream(input,{}, {requestId:'wire-1'})).toThrow('unavailable');expect(other.counts.reserve).toBe(0);await other.scope.close();await f.scope.close();
 expect(new ChildRequestError('execution_failed').message).toBe('Child model request execution_failed.');
});
