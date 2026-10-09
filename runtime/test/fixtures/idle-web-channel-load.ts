import '../setup-filesystem-isolation.js';
import assert from 'node:assert/strict';
import {mkdirSync,writeFileSync} from 'node:fs';
import {join} from 'node:path';
import {performance,monitorEventLoopDelay} from 'node:perf_hooks';
import {Database} from 'bun:sqlite';
import {initDatabase,getDb,closeDatabase} from '../../src/db/connection.js';
import {getWorkspaceDir,getStoreDir} from '../../src/core/config.js';
import {WebChannel} from '../../src/channels/web.js';
import {createWebSession} from '../../src/db/web-sessions.js';
import {getWebRuntimeConfig} from '../../src/core/config-web.js';
assert.equal(process.env.PICLAW_DB_IN_MEMORY,'0');
mkdirSync(join(getWorkspaceDir(),'.piclaw'),{recursive:true});writeFileSync(join(getWorkspaceDir(),'.piclaw/config.json'),JSON.stringify({domains:{access:{mode:'single-user'}}}),{mode:0o600});
initDatabase();let scheduled=0;const chat='web:public-idle';
const authenticated=process.argv.includes('--authenticated');
const session='synthetic-load-cookie';
if(authenticated){(getWebRuntimeConfig() as {totpSecret:string}).totpSecret='JBSWY3DPEHPK3PXP';createWebSession(session,'default',3600,'totp');}
const authHeaders=authenticated?{Cookie:`piclaw_session=${session}`} : {};
const web=new WebChannel({queue:{enqueue(){scheduled++;}} as any,agentPool:{isStreaming:()=>false,isActive:()=>false,getContextUsageForChat:async()=>null} as any});
const server=Bun.serve({hostname:'127.0.0.1',port:0,fetch:(request)=>web.handleRequest(request)});
if(authenticated){const denied=await fetch(new URL(`/agent/default/message?chat_jid=${chat}`,server.url),{method:'POST',headers:{Origin:server.url.origin,'Content-Type':'application/json'},body:JSON.stringify({content:'Unauthenticated input must be rejected'})});assert.equal(denied.status,401);}
const stream=await fetch(new URL(`/sse/stream?chat_jid=${chat}`,server.url),{headers:authHeaders});assert.equal(stream.status,200);const reader=stream.body!.getReader();await reader.read();let blocker:ReturnType<typeof Bun.spawn>|undefined;
const instrument=process.argv.includes('--instrument');
const metrics:Record<string,{count:number;ms:number}>={};
const undo:Array<()=>void>=[];let phase='idle';
function wrap(object:any,key:string,name:string){const original=object[key];object[key]=function(...args:unknown[]){const start=performance.now();try{return Reflect.apply(original,this,args);}finally{const row=metrics[`${phase}.${name}`]??={count:0,ms:0};row.count++;row.ms+=performance.now()-start;}};undo.push(()=>{object[key]=original;});}
if(instrument){wrap(JSON,'parse','json.parse');wrap(JSON,'stringify','json.stringify');for(const key of ['exec','query','prepare'])wrap(Database.prototype,key,`sqlite.${key}`);}
const loop=monitorEventLoopDelay({resolution:1});loop.enable();
async function probe(mode:string){const started=performance.now();let timerDelay=0;const timer=new Promise<void>(resolve=>setTimeout(()=>{timerDelay=performance.now()-started;resolve();},10));
const input=fetch(new URL(`/agent/default/message?chat_jid=${chat}`,server.url),{method:'POST',headers:{Origin:server.url.origin,'Content-Type':'application/json',...authHeaders},body:JSON.stringify({content:'Public idle input'})}).then(async response=>({status:response.status,ms:performance.now()-started,requestId:!!response.headers.get('x-request-id'),serverTiming:response.headers.get('Server-Timing'),hasMessage:!!(await response.json()).user_message}));
const read=fetch(new URL(`/timeline?chat_jid=${chat}`,server.url),{headers:authHeaders}).then(async response=>({status:response.status,ms:performance.now()-started,body:await response.json()}));
const sse=(async()=>{for(;;){const item=await reader.read();if(item.done)throw Error('stream closed');if(new TextDecoder().decode(item.value).includes('new_post'))return {ms:performance.now()-started};}})();
const [ack,timeline,delivery]=await Promise.all([input,read,sse,timer]);assert.equal(ack.status,201);assert.equal(ack.hasMessage,true);assert.equal(timeline.status,200);return {mode,input:ack,timeline:{status:timeline.status,ms:timeline.ms},sse:delivery,timerDelayMs:timerDelay};}
try{const idle=await probe('idle');blocker=Bun.spawn([process.execPath,'--no-env-file','-e',`import{Database}from'bun:sqlite';const d=new Database(${JSON.stringify(join(getStoreDir(),'messages.db'))});d.exec('BEGIN IMMEDIATE');console.log('LOCKED');await Bun.sleep(2000);d.exec('ROLLBACK');d.close();`],{env:{PATH:process.env.PATH,HOME:process.env.HOME},stdin:'ignore',stdout:'pipe',stderr:'pipe'});const lock=blocker.stdout.getReader();assert.ok(new TextDecoder().decode((await lock.read()).value).includes('LOCKED'));phase='writer-lock';const loaded=await probe('writer-lock');await blocker.exited;lock.releaseLock();assert.equal(scheduled,2);assert.equal((getDb().query('SELECT count(*) AS n FROM messages').get() as {n:number}).n,2);loop.disable();
const eventLoop={resolutionMs:1,samples:loop.count,maxMs:loop.max/1e6,p50Ms:loop.percentile(50)/1e6,p95Ms:loop.percentile(95)/1e6,p99Ms:loop.percentile(99)/1e6};
for(const restore of undo.reverse())restore();undo.length=0;
console.log(JSON.stringify({kind:'public-idle-admission-load',results:[idle,loaded],scheduled,instrument,authenticated,metrics,eventLoop,memory:process.memoryUsage(),scope:`actual WebChannel router/guards/storage/prototype/SSE; no-op task executor/provider; ${authenticated?'verified synthetic cookie; unauthenticated POST rejected':'auth disabled'} single-user owned loopback`}));}
finally{loop.disable();for(const restore of undo.reverse())restore();await reader.cancel();if(blocker?.exitCode===null){blocker.kill('SIGKILL');await blocker.exited;}server.stop(true);closeDatabase();}
