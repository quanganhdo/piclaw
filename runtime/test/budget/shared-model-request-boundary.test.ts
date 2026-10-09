import {expect,test} from 'bun:test';
import type {AssistantMessage,AssistantMessageEvent} from '@earendil-works/pi-ai';
import {Agent} from '@earendil-works/pi-agent-core';
import {sharedModelRequestBoundary,type SharedModelRequestHost} from '../../src/budget/shared-model-request-boundary.js';
import {isolateBudgetTestDatabase} from './fixture.js';
import {ensureBudgetWork,saveBudgetCap} from '../../src/db/budget-limits.js';
import {getDb} from '../../src/db/connection.js';
import {withBudgetWorkContext} from '../../src/budget/context.js';
import {evaluateBudget} from '../../src/budget/evaluator.js';
import {recordSessionEventUsage} from '../../src/agent-pool/usage.js';
import {modelRequestAccounting} from '../../src/budget/model-request-accounting.js';
import {getBudgetRequest} from '../../src/db/budget-request-reservations.js';
import {installSharedRequestBoundary} from '../../src/budget/install-shared-request-boundary.js';
import {runSidePrompt} from '../../src/agent-pool/side-prompt-runner.js';
import type {ModelRuntime} from '@earendil-works/pi-coding-agent';
isolateBudgetTestDatabase();
const model={id:'fixture',provider:'fixture',api:'openai-completions' as const,name:'fixture',baseUrl:'https://synthetic.invalid',reasoning:false,input:['text' as const],contextWindow:10,maxTokens:1,cost:{input:1,output:0,cacheRead:2,cacheWrite:3}};
const message=():AssistantMessage=>({role:'assistant',content:[{type:'text',text:'synthetic'}],api:model.api,provider:model.provider,model:model.id,stopReason:'stop',timestamp:1,usage:{input:1,output:1,cacheRead:0,cacheWrite:0,totalTokens:2,cost:{input:0.00003,output:0.00001,cacheRead:0,cacheWrite:0,total:0.00004}}});
function gate(){let resolve!:()=>void;const promise=new Promise<void>(done=>{resolve=done;});return{promise,resolve};}
function seed(){ensureBudgetWork({id:'parent',chatJid:'web:fixture',executionKind:'interactive'});for(const[id,kind]of[['side','side_prompt'],['child','delegate']]as const)ensureBudgetWork({id,chatJid:'web:fixture',executionKind:kind,parentWorkId:'parent'});saveBudgetCap({scope:'task',workId:'parent',metric:'api_usd_micros',amount:100});}
function host(tail=Promise.resolve(),unknown=false){let sends=0;const policy:SharedModelRequestHost={capture(){return{model,accountRef:'generation',maxTokens:1,documentedFree:false,deadlineAt:Date.now()+5000,authorise(){},async prepare(){return{start(before){return{settled:tail,events:(async function*(){await before();sends++;const terminal=message();if(unknown)terminal.usage={input:0,output:0,cacheRead:0,cacheWrite:0,totalTokens:0,cost:{input:0,output:0,cacheRead:0,cacheWrite:0,total:0}};yield{type:'start',partial:terminal}as AssistantMessageEvent;yield{type:'done',reason:'stop',message:terminal}as AssistantMessageEvent;})()};}};}};}};return{policy,sends:()=>sends};}
const stream=(boundary:ReturnType<typeof sharedModelRequestBoundary>,id:'parent'|'side'|'child')=>withBudgetWorkContext({workId:id,chatJid:'web:fixture',kind:id==='parent'?'interactive':id==='side'?'side_prompt':'delegate'},()=>boundary(model,{messages:[]},{}));
test('competing parent, side and Delegate requests share the same remaining capacity',async()=>{
 seed();const tail=gate();const h=host(tail.promise);const boundary=sharedModelRequestBoundary(h.policy);const parent=await stream(boundary,'parent');await Bun.sleep(0);
 expect(h.sends()).toBe(1);const side=await stream(boundary,'side');expect((await side.result()).stopReason).toBe('error');const child=await stream(boundary,'child');expect((await child.result()).stopReason).toBe('error');expect(h.sends()).toBe(1);
 tail.resolve();expect((await parent.result()).stopReason).toBe('stop');expect(getDb().query('SELECT count(*) n FROM token_usage').get()).toEqual({n:1});expect(getDb().query("SELECT count(*) n FROM budget_request_reservations WHERE state='settled'").get()).toEqual({n:1});
});
test('each tool-loop turn or retry gets a distinct reservation and stops once remaining balance cannot cover it',async()=>{
 seed();const h=host();const boundary=sharedModelRequestBoundary(h.policy);expect((await(await stream(boundary,'parent')).result()).stopReason).toBe('stop');expect((await(await stream(boundary,'parent')).result()).stopReason).toBe('stop');expect((await(await stream(boundary,'parent')).result()).stopReason).toBe('error');expect(h.sends()).toBe(2);
 expect(getDb().query('SELECT count(DISTINCT invocation_id) n FROM token_usage').get()).toEqual({n:2});
});
test('terminal is published only after settlement and existing recorder replays the host invocation once',async()=>{
 seed();const tail=gate();const h=host(tail.promise);const output=await stream(sharedModelRequestBoundary(h.policy),'side');let delivered=false;const done=output.result().then(message=>{delivered=true;return message;});await Bun.sleep(0);expect(delivered).toBe(false);tail.resolve();const terminal=await done;
 withBudgetWorkContext({workId:'parent',chatJid:'web:fixture',kind:'interactive'},()=>{recordSessionEventUsage('web:fixture',{type:'message_end',message:terminal});recordSessionEventUsage('web:fixture',{type:'message_end',message:terminal});});
 expect(getDb().query('SELECT count(*) n FROM token_usage').get()).toEqual({n:1});expect(getDb().query('SELECT work_id FROM token_usage').get()).toEqual({work_id:'side'});
});
test('zero telemetry retains unresolved charge and blocks later sibling calls',async()=>{
 seed();const h=host(Promise.resolve(),true);const boundary=sharedModelRequestBoundary(h.policy);expect((await(await stream(boundary,'parent')).result()).stopReason).toBe('error');expect(evaluateBudget({workId:'parent'}).blockers[0].reason).toBe('unknown_pricing');expect((await(await stream(boundary,'side')).result()).stopReason).toBe('error');expect(h.sends()).toBe(1);expect(getDb().query('SELECT count(*) n FROM token_usage').get()).toEqual({n:0});
});
test('shared settlement retry preserves host accounting time and exact usage payload',async()=>{
 seed();const accounting=modelRequestAccounting({authorise(){},documentedFree:false});const binding={id:'stable-settlement',workId:'side',chatJid:'web:fixture',providerId:'fixture',modelId:'fixture',accountRef:'generation',amountMicros:60};const signal=new AbortController().signal;
 await accounting.reserve(binding,signal);await accounting.dispatch(binding,signal);const terminal=message();expect((await accounting.settle(binding,terminal)).state).toBe('settled');await Bun.sleep(2);expect((await accounting.settle(binding,structuredClone(terminal))).state).toBe('settled');expect(getDb().query('SELECT count(*) n FROM budget_usage_events').get()).toEqual({n:1});
 await expect(accounting.settle(binding,{...terminal,usage:{...terminal.usage,cost:{...terminal.usage.cost,input:0.000031,total:0.000041}}})).rejects.toThrow('conflict');
});
test('caller cancellation releases a definitely unsent hold but waits for raw preparation',async()=>{
 seed();const auth=gate();let entered=false,sends=0;
 const boundary=sharedModelRequestBoundary({capture(){return{model,accountRef:'generation',maxTokens:1,documentedFree:false,deadlineAt:Date.now()+5000,authorise(){},async prepare(){entered=true;await auth.promise;return{start(){sends++;throw Error('must not send');}};}};}});
 const aborter=new AbortController();const output=await withBudgetWorkContext({workId:'parent',chatJid:'web:fixture',kind:'interactive'},()=>boundary(model,{messages:[]},{signal:aborter.signal}));await Bun.sleep(0);expect(entered).toBe(true);aborter.abort();let done=false;const result=output.result().then(message=>{done=true;return message;});await Bun.sleep(0);expect(done).toBe(false);auth.resolve();expect((await result).stopReason).toBe('aborted');expect(sends).toBe(0);expect(getDb().query('SELECT state FROM budget_request_reservations').get()).toEqual({state:'released'});
});
test('late cancelled dispatched usage still settles once to the captured side work',async()=>{
 seed();const tail=gate();const h=host(tail.promise);const aborter=new AbortController();const output=await withBudgetWorkContext({workId:'side',chatJid:'web:fixture',kind:'side_prompt'},()=>sharedModelRequestBoundary(h.policy)(model,{messages:[]},{signal:aborter.signal}));await Bun.sleep(0);aborter.abort();tail.resolve();expect((await output.result()).stopReason).toBe('aborted');expect(getDb().query('SELECT work_id FROM token_usage').get()).toEqual({work_id:'side'});expect(getDb().query('SELECT state FROM budget_request_reservations').get()).toEqual({state:'settled'});
});
test('post-dispatch storage fault publishes no successful terminal or duplicate usage',async()=>{
 seed();getDb().exec("CREATE TRIGGER refuse_settlement BEFORE UPDATE ON budget_request_reservations WHEN NEW.state='settled' BEGIN SELECT RAISE(ABORT,'storage fault'); END");const h=host();expect((await(await stream(sharedModelRequestBoundary(h.policy),'parent')).result()).stopReason).toBe('error');expect(getDb().query('SELECT state FROM budget_request_reservations').get()).toEqual({state:'unresolved'});expect(getDb().query('SELECT count(*) n FROM token_usage').get()).toEqual({n:0});
});
test('model substitution and missing work deny without executing provider preparation',async()=>{
 seed();let prepare=0;const boundary=sharedModelRequestBoundary({capture(){return{model:{...model,id:'other'},accountRef:'generation',maxTokens:1,documentedFree:false,deadlineAt:Date.now()+5000,authorise(){},async prepare(){prepare++;throw Error('unused');}};}});expect((await(await stream(boundary,'parent')).result()).stopReason).toBe('error');expect((await(await boundary(model,{messages:[]},{})).result()).stopReason).toBe('error');expect(prepare).toBe(0);expect(getDb().query('SELECT count(*) n FROM budget_request_reservations').get()).toEqual({n:0});
});
test('actual public Agent tool loop reserves each paid turn and existing message recorder deduplicates',async()=>{
 seed();let turns=0,tools=0;const base=host();const policy:SharedModelRequestHost={capture(...args){const plan=base.policy.capture(...args);return{...plan,async prepare(){return{start(before){return{settled:Promise.resolve(),events:(async function*(){await before();const terminal=message();if(++turns===1){terminal.stopReason='toolUse';terminal.content=[{type:'toolCall',id:'synthetic-tool',name:'fixture',arguments:{}}];}yield{type:'start',partial:terminal}as AssistantMessageEvent;yield{type:'done',reason:terminal.stopReason,message:terminal}as AssistantMessageEvent;})()};}};}};}};
 const agent=new Agent({initialState:{model,tools:[{name:'fixture',description:'synthetic',parameters:{type:'object',properties:{}}as any,async execute(){tools++;return{content:[{type:'text' as const,text:'synthetic'}],details:{}};}}]},streamFn:sharedModelRequestBoundary(policy)});
 agent.subscribe(event=>{if(event.type==='message_end')recordSessionEventUsage('web:fixture',event);});await withBudgetWorkContext({workId:'parent',chatJid:'web:fixture',kind:'interactive'},()=>agent.prompt('synthetic'));
 expect(turns).toBe(2);expect(tools).toBe(1);expect(getDb().query('SELECT count(*) n FROM token_usage').get()).toEqual({n:2});expect(getDb().query("SELECT count(*) n FROM budget_request_reservations WHERE state='settled'").get()).toEqual({n:2});
});
test('explicit installation routes actual simple side runner through shared accounting without duplicate usage',async()=>{
 seed();let originalCalls=0;const original=()=>{originalCalls++;throw Error('must not fall back');};const runtime={streamSimple:original}as unknown as ModelRuntime;const h=host();const installed=installSharedRequestBoundary(runtime,h.policy);
 const result=await withBudgetWorkContext({workId:'side',chatJid:'web:fixture',kind:'side_prompt'},()=>runSidePrompt('web:fixture','synthetic',{}, {getOrCreate:async()=>({model,thinkingLevel:'off'})as any,getOrCreateSideRuntime:async()=>{throw Error('unused');},syncSideSessionFromMain:async()=>{},modelRuntime:runtime,sideStreamSimple:runtime.streamSimple}));
 expect(result.status).toBe('success');expect(originalCalls).toBe(0);expect(getDb().query('SELECT count(*) n FROM token_usage').get()).toEqual({n:1});expect(getDb().query('SELECT work_id FROM token_usage').get()).toEqual({work_id:'side'});installed.release();expect(runtime.streamSimple).toBe(original);
});
test('explicit session installation restores only its own wrapper and preserves later replacement',async()=>{
 seed();const original=()=>{throw Error('unused');};const runtime={streamSimple:original}as unknown as ModelRuntime;const agent=new Agent({initialState:{model},streamFn:original});const installed=installSharedRequestBoundary(runtime,host().policy);installed.attach({agent});await withBudgetWorkContext({workId:'parent',chatJid:'web:fixture',kind:'interactive'},()=>agent.prompt('synthetic'));
 expect(getDb().query('SELECT count(*) n FROM token_usage').get()).toEqual({n:1});const replacement=()=>{throw Error('replacement');};agent.streamFunction=replacement;installed.release();expect(agent.streamFunction).toBe(replacement);expect(runtime.streamSimple).toBe(original);expect(()=>installed.attach({agent})).toThrow('released');
});
test('overlapping installers reject instead of later restoring a released wrapper',()=>{
 seed();const original=()=>{throw Error('unused');};const runtime={streamSimple:original}as unknown as ModelRuntime;const first=installSharedRequestBoundary(runtime,host().policy);expect(()=>installSharedRequestBoundary(runtime,host().policy)).toThrow('already installed');first.release();const second=installSharedRequestBoundary(runtime,host().policy);second.release();expect(runtime.streamSimple).toBe(original);
 const agent=new Agent({initialState:{model},streamFn:original});const a=installSharedRequestBoundary({streamSimple:original}as unknown as ModelRuntime,host().policy),b=installSharedRequestBoundary({streamSimple:original}as unknown as ModelRuntime,host().policy);a.attach({agent});expect(()=>b.attach({agent})).toThrow('already has');a.release();b.attach({agent});b.release();expect(agent.streamFunction).toBe(original);
});
test('cancellation after durable settlement but before public terminal reports aborted with one charge',async()=>{
 seed();const aborter=new AbortController();const base=host();let committed=false;const policy:SharedModelRequestHost={capture(...args){const plan=base.policy.capture(...args);return{...plan,authorise(){if(!committed&&(getDb().query('SELECT count(*) n FROM token_usage').get()as{n:number}).n>0){committed=true;aborter.abort();}}};}};
 const output=await withBudgetWorkContext({workId:'parent',chatJid:'web:fixture',kind:'interactive'},()=>sharedModelRequestBoundary(policy)(model,{messages:[]},{signal:aborter.signal}));expect((await output.result()).stopReason).toBe('aborted');expect(getDb().query('SELECT count(*) n FROM token_usage').get()).toEqual({n:1});expect(getDb().query('SELECT state FROM budget_request_reservations').get()).toEqual({state:'settled'});
});
test('provider timestamp cannot move charged usage outside the current calendar cap',async()=>{
 seed();saveBudgetCap({id:'daily-cap',scope:'instance_daily',metric:'api_usd_micros',amount:30,timezone:'UTC'});const h=host();const terminal=await(await stream(sharedModelRequestBoundary(h.policy),'parent')).result();expect(terminal.stopReason).toBe('error');expect(h.sends()).toBe(0);
 // Revise the same cap to permit a known charge in the current host window.
 saveBudgetCap({id:'daily-cap',scope:'instance_daily',metric:'api_usd_micros',amount:100,timezone:'UTC'});expect((await(await stream(sharedModelRequestBoundary(h.policy),'parent')).result()).stopReason).toBe('stop');
 const row=getDb().query('SELECT run_at FROM token_usage').get()as{run_at:string};expect(row.run_at.slice(0,10)).toBe(new Date().toISOString().slice(0,10));
});
test('accounting rejects disclosed response-model changes and keeps the dispatched hold',async()=>{
 seed();const accounting=modelRequestAccounting({authorise(){},documentedFree:false});const binding={id:'response-model-conflict',workId:'parent',chatJid:'web:fixture',providerId:'fixture',modelId:'fixture',accountRef:'generation',amountMicros:60};const signal=new AbortController().signal;await accounting.reserve(binding,signal);await accounting.dispatch(binding,signal);await expect(accounting.settle(binding,{...message(),responseModel:'other'})).rejects.toThrow('identity changed');expect(getBudgetRequest(binding.id)?.state).toBe('dispatched');
});
