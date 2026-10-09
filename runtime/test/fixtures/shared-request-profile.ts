import '../setup-filesystem-isolation.js';
import assert from 'node:assert/strict';
import {Database} from 'bun:sqlite';
import {performance,monitorEventLoopDelay} from 'node:perf_hooks';
import type {AssistantMessage,AssistantMessageEvent} from '@earendil-works/pi-ai';
import {initDatabase,getDb,closeDatabase} from '../../src/db/connection.js';
import {ensureBudgetWork,saveBudgetCap} from '../../src/db/budget-limits.js';
import {withBudgetWorkContext} from '../../src/budget/context.js';
import {sharedModelRequestBoundary} from '../../src/budget/shared-model-request-boundary.js';
import {recordSessionEventUsage} from '../../src/agent-pool/usage.js';
assert.equal(process.env.PICLAW_DB_IN_MEMORY,'0');initDatabase();const db=getDb();
assert.equal((db.query('PRAGMA synchronous').get()as{synchronous:number}).synchronous,2);
ensureBudgetWork({id:'profile-parent',chatJid:'web:profile',executionKind:'interactive'});
ensureBudgetWork({id:'profile-side',chatJid:'web:profile',executionKind:'side_prompt',parentWorkId:'profile-parent'});
saveBudgetCap({scope:'task',metric:'api_usd_micros',amount:1_000_000,workId:'profile-parent'});
const model={id:'fixture',provider:'fixture',api:'openai-completions'as const,name:'fixture',baseUrl:'https://synthetic.invalid',reasoning:false,input:['text'as const],contextWindow:10,maxTokens:1,cost:{input:1,output:0,cacheRead:2,cacheWrite:3}};
const terminal:AssistantMessage={role:'assistant',content:[],api:model.api,provider:model.provider,model:model.id,stopReason:'stop',timestamp:1,usage:{input:1,output:1,cacheRead:0,cacheWrite:0,totalTokens:2,cost:{input:0.00003,output:0.00001,cacheRead:0,cacheWrite:0,total:0.00004}}};
const boundary=sharedModelRequestBoundary({capture(){return{model,accountRef:'profile-generation',maxTokens:1,documentedFree:false,deadlineAt:Date.now()+5000,authorise(){},async prepare(){return{start(before){return{settled:Promise.resolve(),events:(async function*(){await before();yield{type:'start',partial:terminal}as AssistantMessageEvent;yield{type:'done',reason:'stop',message:terminal}as AssistantMessageEvent;})()};}};}};}});
const metrics:Record<string,{count:number;ms:number;bytes:number}>={};const restore:Array<()=>void>=[];const instrument=process.argv.includes('--instrument');const statements=new WeakSet<object>();
function measure<T>(name:string,operation:()=>T,bytes=0){const start=performance.now();try{return operation();}finally{const value=metrics[name]??={count:0,ms:0,bytes:0};value.count++;value.ms+=performance.now()-start;value.bytes+=bytes;}}
if(instrument){
 for(const key of ['query','prepare','exec']as const){const original=Database.prototype[key]as(...args:any[])=>any;Database.prototype[key]=function(...args:any[]){const result=measure(`sqlite.${key}`,()=>Reflect.apply(original,this,args));if(key!=='exec'&&!statements.has(result)){statements.add(result);for(const method of ['get','all','run']){const fn=result[method];result[method]=function(...values:any[]){return measure(`sqlite.statement.${method}`,()=>Reflect.apply(fn,this,values));};}}return result;};restore.push(()=>{Database.prototype[key]=original as any;});}
 for(const key of ['parse','stringify']as const){const original=JSON[key]as(...args:any[])=>any;JSON[key]=function(...args:any[]){const result=measure(`json.${key}`,()=>Reflect.apply(original,JSON,args));metrics[`json.${key}`].bytes+=Buffer.byteLength(key==='parse'?args[0]:result??'');return result;};restore.push(()=>{JSON[key]=original;});}
}
const loop=monitorEventLoopDelay({resolution:1});loop.enable();const cpu=process.cpuUsage(),start=performance.now();
try{
 for(let n=0;n<100;n++)await withBudgetWorkContext({workId:n%2?'profile-side':'profile-parent',chatJid:'web:profile',kind:n%2?'side_prompt':'interactive'},async()=>{const stream=boundary(model,{messages:[]},{});const message=await stream.result();assert.equal(message.stopReason,'stop');recordSessionEventUsage('web:profile',{type:'message_end',message});if(n%10===0)await Bun.sleep(0);});
 const elapsedMs=performance.now()-start,cpuUsage=process.cpuUsage(cpu);loop.disable();
 for(const undo of restore.reverse())undo();restore.length=0;
 const count=(table:string)=>(db.query(`SELECT count(*) n FROM ${table}`).get()as{n:number}).n;assert.equal(count('token_usage'),100);assert.equal(count('budget_usage_events'),100);assert.equal(count('budget_request_reservations'),100);assert.equal((db.query("SELECT count(*) n FROM budget_request_reservations WHERE state='settled'").get()as{n:number}).n,100);if(instrument){assert(metrics['sqlite.statement.run'].count>0);assert(metrics['json.stringify'].bytes>0);}
 console.log(JSON.stringify({kind:'shared-request-profile',runtime:Bun.version,instrument,requests:100,elapsedMs,cpuUsage,metrics,eventLoop:{resolutionMs:1,count:loop.count,maxMs:loop.max/1e6},memory:process.memoryUsage(),journal:(db.query('PRAGMA journal_mode').get()as{journal_mode:string}).journal_mode,synchronous:2,scope:'owned disk100 alternating parent/side calls through sharedStreamFn plus actualusage recorder replay, rawsettledsynthetic, no provider/auth/network; preparation/execution timing excludes TXcommit, elapsed includes it; no production improvement baseline'}));
}finally{loop.disable();for(const undo of restore.reverse())undo();closeDatabase();}
