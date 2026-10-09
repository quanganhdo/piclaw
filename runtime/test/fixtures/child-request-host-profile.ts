import '../setup-filesystem-isolation.js';
import {performance,monitorEventLoopDelay} from 'node:perf_hooks';
import assert from 'node:assert/strict';
import type {AssistantMessage,AssistantMessageEvent} from '@earendil-works/pi-ai';
import {createChildRequestScope} from '../../src/addons/child-request-scope.js';
const terminal:AssistantMessage={role:'assistant',content:[{type:'text',text:'synthetic'}],api:'openai-completions',provider:'fixture',model:'fixture',stopReason:'stop',timestamp:1,usage:{input:1,output:1,cacheRead:0,cacheWrite:0,totalTokens:2,cost:{input:1e-6,output:1e-6,cacheRead:0,cacheWrite:0,total:2e-6}}};
const instrument=process.argv.includes('--instrument');
const metrics:Record<string,{count:number;ms:number;bytes:number}>={};const restore:Array<()=>void>=[];
if(instrument)for(const key of ['parse','stringify'] as const){const original=JSON[key] as (...args:any[])=>any;JSON[key]=function(...args:any[]){const start=performance.now();const result=Reflect.apply(original,JSON,args);const metric=metrics[key]??={count:0,ms:0,bytes:0};metric.count++;metric.ms+=performance.now()-start;metric.bytes+=Buffer.byteLength(key==='parse'?args[0]:result??'');return result;};restore.push(()=>{JSON[key]=original;});}
const cpu=process.cpuUsage(),loop=monitorEventLoopDelay({resolution:1});loop.enable();const start=performance.now();let settled=0,delivered=0;
try{
 for(let n=0;n<1000;n++){
  const scope=createChildRequestScope({plan:{version:1,execution:'parent-provider-proxy',model:{provider:'fixture',id:'fixture'},mcp:'none'},signal:new AbortController().signal,deadlineAt:Date.now()+5000,
   authorise(){},validate(context,options){return{context,options};},binding(){return{id:`profile-${n}`,workId:'synthetic',chatJid:'web:synthetic',providerId:'fixture',modelId:'fixture',accountRef:'synthetic',amountMicros:10};},
   async reserve(){},async dispatch(){},async abandon(){throw Error('unexpected unresolved');},async settle(){settled++;},
   async prepare(){return{start(before){return{settled:Promise.resolve(),events:(async function*(){await before();yield{type:'start',partial:terminal} as AssistantMessageEvent;yield{type:'done',reason:'stop',message:terminal} as AssistantMessageEvent;})()};}};},
  });
  const stream=scope.stream({messages:[]},{},{requestId:'synthetic'});for await(const _event of stream)delivered++;await stream.settled;await scope.close();if(n%100===0)await Bun.sleep(0);
 }
 const elapsedMs=performance.now()-start,cpuUsage=process.cpuUsage(cpu);loop.disable();assert.equal(settled,1000);assert.equal(delivered,2000);
 for(const undo of restore.reverse())undo();restore.length=0;
 console.log(JSON.stringify({kind:'child-request-host-profile',runtime:Bun.version,instrument,requests:1000,delivered,settled,elapsedMs,cpuUsage,metrics,eventLoop:{resolutionMs:1,count:loop.count,maxMs:loop.max/1e6},memory:process.memoryUsage(),scope:'synthetic injected scope/clone/output/cancel-close lifecycle only; no database/provider/auth/HTTP; CPUartifact includes startup, no production baseline'}));
}finally{loop.disable();for(const undo of restore.reverse())undo();}
