import { expect, test } from 'bun:test';
import type { AssistantMessage, AssistantMessageEvent } from '@earendil-works/pi-ai';
import { randomUUID } from 'node:crypto';
import { isolateBudgetTestDatabase } from '../budget/fixture.js';
import { ensureBudgetWork, saveBudgetCap } from '../../src/db/budget-limits.js';
import { getDb } from '../../src/db/connection.js';
import { evaluateBudget } from '../../src/budget/evaluator.js';
import { getBudgetRequest } from '../../src/db/budget-request-reservations.js';
import { createChildRequestScope } from '../../src/addons/child-request-scope.js';
import { childRequestAccounting } from '../../src/addons/child-request-accounting.js';
isolateBudgetTestDatabase();
function fixture(mode:'known'|'unknown'|'unsent'='known') {
 ensureBudgetWork({id:'host-work',chatJid:'web:host',executionKind:'delegate'});saveBudgetCap({scope:'task',workId:'host-work',metric:'api_usd_micros',amount:100});
 const id=randomUUID();const accounting=childRequestAccounting({authorise(){},documentedFree:false});
 const message:AssistantMessage={role:'assistant',content:[],api:'openai-completions',provider:'fixture',model:'fixture',stopReason:'stop',timestamp:1,
 usage:{input:mode==='unknown'?0:1,output:mode==='unknown'?0:1,cacheRead:0,cacheWrite:0,totalTokens:mode==='unknown'?0:2,cost:{input:mode==='unknown'?0:0.00003,output:mode==='unknown'?0:0.00001,cacheRead:0,cacheWrite:0,total:mode==='unknown'?0:0.00004}}};
 const scope=createChildRequestScope({plan:{version:1,execution:'parent-provider-proxy',model:{provider:'fixture',id:'fixture'},mcp:'none'},signal:new AbortController().signal,deadlineAt:Date.now()+5000,
 authorise(){},validate(context,options){return {context,options};},binding(){return {id,workId:'host-work',chatJid:'web:host',providerId:'fixture',modelId:'fixture',accountRef:'host-generation',amountMicros:60};},...accounting,
 async prepare(){if(mode==='unsent')throw Error('auth denial');return {start(before){return {settled:Promise.resolve(),events:(async function*(){await before();yield {type:'start',partial:message} as AssistantMessageEvent;yield {type:'done',reason:'stop',message} as AssistantMessageEvent;})()};}};}});
 return {id,scope};
}
const consume=async(stream:AsyncIterable<AssistantMessageEvent>)=>{for await(const _event of stream){/* synthetic delivery */}};
test('actual captured ledger settlement charges once and releases capacity after raw completion',async()=>{
 const f=fixture();const stream=f.scope.stream({messages:[]},{},{requestId:'wire'});await consume(stream);await stream.settled;
 expect(getBudgetRequest(f.id)?.state).toBe('settled');expect(getDb().query('SELECT count(*) n FROM token_usage').get()).toEqual({n:1});
 expect(getDb().query('SELECT work_id,invocation_id FROM budget_usage_events').get()).toEqual({work_id:'host-work',invocation_id:f.id});expect(evaluateBudget({workId:'host-work'}).action).toBe('allow');await f.scope.close();
});
test('actual zero telemetry remains unresolved, blocks cap and rejects settled/close',async()=>{
 const f=fixture('unknown');const stream=f.scope.stream({messages:[]},{},{requestId:'wire'});await expect(consume(stream)).rejects.toThrow('execution_failed');await expect(stream.settled).rejects.toThrow('settlement_failed');
 expect(getBudgetRequest(f.id)?.state).toBe('unresolved');expect(evaluateBudget({workId:'host-work'}).blockers[0].reason).toBe('unknown_pricing');expect(getDb().query('SELECT count(*) n FROM token_usage').get()).toEqual({n:0});await expect(f.scope.close()).rejects.toThrow('settlement_failed');
});
test('actual unsent denial releases its hold without any usage event',async()=>{
 const f=fixture('unsent');const stream=f.scope.stream({messages:[]},{},{requestId:'wire'});await expect(consume(stream)).rejects.toThrow('execution_failed');await stream.settled;
 expect(getBudgetRequest(f.id)?.state).toBe('released');expect(getDb().query('SELECT count(*) n FROM token_usage').get()).toEqual({n:0});await f.scope.close();
});
