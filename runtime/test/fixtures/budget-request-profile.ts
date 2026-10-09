/** Owned synthetic disk/WAL admission/settlement profile. No provider or auth calls. */
import '../setup-filesystem-isolation.js';
import { Database } from 'bun:sqlite';
import { performance, monitorEventLoopDelay } from 'node:perf_hooks';
import { createTempWorkspace } from '../helpers.js';
import { initDatabase, getDb, closeDatabase } from '../../src/db/connection.js';
import { ensureBudgetWork, saveBudgetCap } from '../../src/db/budget-limits.js';
import { reserveBudgetRequest, dispatchBudgetRequest, settleBudgetRequest } from '../../src/db/budget-request-reservations.js';
import { join } from 'node:path';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
initDatabase();
const source=getDb();
ensureBudgetWork({id:'profile-parent',chatJid:'web:profile',executionKind:'interactive'});
ensureBudgetWork({id:'profile-child',chatJid:'web:profile',executionKind:'delegate',parentWorkId:'profile-parent'});
saveBudgetCap({scope:'task',metric:'api_usd_micros',amount:1000000,workId:'profile-parent'});
const ws=createTempWorkspace('budget-request-profile-'),path=join(ws.workspace,'requests.db');await Bun.write(path,source.serialize());
const db=new Database(path);db.exec('PRAGMA journal_mode=WAL; PRAGMA synchronous=FULL; PRAGMA foreign_keys=ON; PRAGMA busy_timeout=5000;');
const metrics:Record<string,{count:number;ms:number;bytes:number}>={};const restore:Array<()=>void>=[];
const statements=new WeakSet<object>();
const queryPatterns:Record<string,number>={};
function measured<T>(name:string,operation:()=>T,bytes=0):T {
 const start=performance.now();
 try{return operation();}finally{const value=metrics[name]??={count:0,ms:0,bytes:0};value.count++;value.ms+=performance.now()-start;value.bytes+=bytes;}
}
function instrumentStatement(statement:any){
 if(statements.has(statement))return;statements.add(statement);
 for(const key of ['get','all','run']){const original=statement[key];statement[key]=function(...args:unknown[]){return measured(`sqlite.statement.${key}`,()=>Reflect.apply(original,this,args));};}
}
function wrap(object:any,key:string,name:string){
 const original=object[key];object[key]=function(...args:unknown[]){
  const bytes=typeof args[0]==='string'?Buffer.byteLength(args[0]):0;
  const result=measured(name,()=>Reflect.apply(original,this,args),bytes);
  if(object===Database.prototype && (key==='query'||key==='prepare')){
   const hash=createHash('sha256').update(String(args[0])).digest('hex');queryPatterns[hash]=(queryPatterns[hash]??0)+1;
   instrumentStatement(result);
  }
  if(object===JSON && key==='stringify' && typeof result==='string')metrics[name].bytes+=Buffer.byteLength(result);
  return result;
 };restore.push(()=>{object[key]=original;});
}
const instrument=process.argv.includes('--instrument');
if(instrument){
 for(const key of ['query','prepare','exec'])wrap(Database.prototype,key,`sqlite.${key}`);
 wrap(JSON,'parse','json.parse');wrap(JSON,'stringify','json.stringify');
 const original=Database.prototype.transaction;
 Database.prototype.transaction=function(fn:any){
  const transaction=Reflect.apply(original,this,[fn]);
  const wrapped=function(...args:unknown[]){return measured('sqlite.transaction.default',()=>Reflect.apply(transaction,this,args));};
  for(const mode of ['default','deferred','immediate','exclusive'] as const)Object.defineProperty(wrapped,mode,{value:function(...args:unknown[]){return measured(`sqlite.transaction.${mode}`,()=>Reflect.apply(transaction[mode],this,args));}});
  return Object.assign(wrapped,{database:transaction.database}) as typeof transaction;
 } as typeof original;
 restore.push(()=>{Database.prototype.transaction=original;});
}
const loop=monitorEventLoopDelay({resolution:1});loop.enable();const cpu=process.cpuUsage();const start=performance.now();const samples:number[]=[];
try{
for(let n=0;n<100;n++){
 const began=performance.now();const binding={id:`profile-${n}`,workId:'profile-child',chatJid:'web:profile',providerId:'fixture',modelId:'fixture',accountRef:'synthetic-account',amountMicros:100};
 reserveBudgetRequest(binding,{},db);dispatchBudgetRequest(binding,{authorise(){},signal:new AbortController().signal},db);
 settleBudgetRequest(binding,{chat_jid:binding.chatJid,run_at:new Date().toISOString(),input_tokens:1,output_tokens:1,cache_read_tokens:0,cache_write_tokens:0,total_tokens:2,cost_input:0.00003,cost_output:0.00001,cost_cache_read:0,cost_cache_write:0,cost_total:0.00004,provider:binding.providerId,model:binding.modelId,api_equivalent_cost_known:true,api_equivalent_cost_microusd:40,valuation_provenance:'catalogue_estimate'},db);
 samples.push(performance.now()-began);if(n%10===0)await Bun.sleep(0);
}
const elapsedMs=performance.now()-start,cpuUsage=process.cpuUsage(cpu);loop.disable();const count=(table:string)=>(db.query(`SELECT count(*) n FROM ${table}`).get() as {n:number}).n;
assert.equal(count('budget_request_reservations'),100);assert.equal(count('token_usage'),100);assert.equal(count('budget_usage_events'),100);
assert.equal((db.query('SELECT count(*) n FROM budget_request_reservations WHERE state<>?').get('settled') as {n:number}).n,0);
assert.equal((db.query('PRAGMA synchronous').get() as {synchronous:number}).synchronous,2);
if(instrument){assert.equal(metrics['sqlite.transaction.immediate'].count,400); /* 300 outer transactions + 100 usage savepoints. */ assert(metrics['sqlite.statement.run'].count>=300);assert(metrics['sqlite.statement.get'].count>0);assert(metrics['json.stringify'].bytes>0);}
for(const undo of restore.reverse())undo();restore.length=0;
console.log(JSON.stringify({kind:'budget-request-profile',runtime:Bun.version,instrument,requests:100,elapsedMs,cpuUsage,perRequestMs:samples,metrics,queryPatterns,eventLoop:{resolutionMs:1,samples:loop.count,maxMs:loop.max/1e6},memory:process.memoryUsage(),journal:'wal',synchronous:2,scope:'100 owned synthetic reserve/dispatch/settle disk transactions; measured work excludes seed/schema, CPU profile includes process startup; instrumented SQL preparation/execution and inclusive transaction wall time (nested spans overlap, no separate commit hook), JSON input/output bytes and hashed query frequency; no binds/text; no provider/auth/inference/production data'}));
}finally{loop.disable();for(const undo of restore.reverse())undo();db.close();closeDatabase();ws.cleanup();}
