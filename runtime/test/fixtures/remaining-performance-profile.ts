/** Remaining-workload audit. Synthetic owned disk WAL/FULL; no model or network calls. */
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdirSync, writeFileSync, existsSync, utimesSync } from 'node:fs';
import { join } from 'node:path';
import { monitorEventLoopDelay, performance } from 'node:perf_hooks';
import { heapStats } from 'bun:jsc';
import { SessionManager } from '@earendil-works/pi-coding-agent';
import { initDatabase, getDb, closeDatabase } from '../../src/db/connection.js';
import { storeChatMetadata } from '../../src/db/messages.js';
import { createWebSession, getWebSession } from '../../src/db/web-sessions.js';
import { getUser } from '../../src/db/users.js';
import { resolveRequestPrincipal } from '../../src/channels/web/auth/principal.js';
import { getTimelineResponse } from '../../src/channels/web/timeline-service.js';
import { pruneExpiredAuthState } from '../../src/db/auth-maintenance.js';
import { storeToolOutputWithChunks, searchToolOutputSnippets } from '../../src/db/tool-outputs.js';
import { pruneToolOutputs } from '../../src/tool-output.js';
import { assertPathWithinTestFilesystemIsolation } from '../../scripts/test-filesystem-isolation.js';

const scenario=process.argv[2], mode=process.argv[3]??'plain';
assert(['history','mixed','background'].includes(scenario));assert(['plain','instrument','cpu'].includes(mode));
const workspace=process.env.PICLAW_WORKSPACE!, data=process.env.PICLAW_DATA!;
assertPathWithinTestFilesystemIsolation(workspace,process.env,{allowRoot:false});
assert.equal(process.env.PICLAW_DB_IN_MEMORY,'0');
mkdirSync(join(workspace,'.piclaw'),{recursive:true});writeFileSync(join(workspace,'.piclaw/config.json'),JSON.stringify({domains:{access:{mode:'single-user'}}}));
let networkAttempts=0;const deny=()=>{networkAttempts++;throw Error('External network forbidden')};globalThis.fetch=Object.assign(deny,{preconnect:deny}) as typeof fetch;
const hash=(value:string)=>createHash('sha256').update(value).digest('hex');
const rows:unknown[]=[],counts:Record<string,{calls:number;ms:number;codeUnits?:number}>={};
const count=(name:string)=>counts[name]??={calls:0,ms:0};
const timed=<T>(name:string,fn:()=>T):T=>{const start=performance.now();try{return fn()}finally{const c=count(name);c.calls++;c.ms+=performance.now()-start}};
const originalParse=JSON.parse,originalStringify=JSON.stringify;
let restoreSql=()=>{};
function instrument(){
 if(mode!=='instrument')return;
 JSON.parse=((...args:Parameters<typeof JSON.parse>)=>{const r=timed('JSON.parse',()=>originalParse(...args));const c=count('JSON.parse');c.codeUnits=(c.codeUnits??0)+args[0].length;return r}) as typeof JSON.parse;
 JSON.stringify=((...args:Parameters<typeof JSON.stringify>)=>{const r=timed('JSON.stringify',()=>originalStringify(...args));const c=count('JSON.stringify');c.codeUnits=(c.codeUnits??0)+(r?.length??0);return r}) as typeof JSON.stringify;
 if(scenario==='history')return;
 const db=getDb(),prepare=db.prepare,query=db.query,exec=db.exec,transaction=db.transaction;
 const proxies=new WeakMap<object,object>();
 const wrap=(s:any)=>{const previous=proxies.get(s);if(previous)return previous;const proxy=new Proxy(s,{get(target,key){if(!['get','all','run'].includes(String(key)))return Reflect.get(target,key,target);return(...args:unknown[])=>timed('SQL.'+String(key),()=>Reflect.apply(target[key],target,args))}});proxies.set(s,proxy);return proxy};
 db.prepare=((...args:Parameters<typeof db.prepare>)=>wrap(timed('SQL.prepare',()=>Reflect.apply(prepare,db,args)))) as typeof db.prepare;
 db.query=((...args:Parameters<typeof db.query>)=>wrap(timed('SQL.query',()=>Reflect.apply(query,db,args)))) as typeof db.query;
 db.exec=((...args:Parameters<typeof db.exec>)=>timed('SQL.exec',()=>Reflect.apply(exec,db,args))) as typeof db.exec;
 db.transaction=((...args:Parameters<typeof db.transaction>)=>{const fn=Reflect.apply(transaction,db,args);const wrapped=(...parameters:unknown[])=>timed('SQL.transaction',()=>Reflect.apply(fn,db,parameters));for(const key of ['immediate','deferred','exclusive'])Object.defineProperty(wrapped,key,{value:(...parameters:unknown[])=>timed('SQL.transaction.'+key,()=>Reflect.apply(fn[key],fn,parameters))});return wrapped}) as typeof db.transaction;
 restoreSql=()=>{db.prepare=prepare;db.query=query;db.exec=exec;db.transaction=transaction};
}
function restore(){restoreSql();JSON.parse=originalParse;JSON.stringify=originalStringify}
const memory=()=>({process:process.memoryUsage(),jsc:{heapSize:heapStats().heapSize,heapCapacity:heapStats().heapCapacity,objectCount:heapStats().objectCount,extraMemorySize:heapStats().extraMemorySize}});
const loop=monitorEventLoopDelay({resolution:1});
async function measure(name:string,fn:()=>unknown|Promise<unknown>){const tickStart=performance.now(),tick=new Promise<number>(r=>setTimeout(()=>r(performance.now()-tickStart),0));const cpu=process.cpuUsage(),start=performance.now();const result=await fn();const wallMs=performance.now()-start;const used=process.cpuUsage(cpu);const tickMs=await tick;rows.push({name,wallMs,cpu:used,tickMs});return result}
try{
 let seedMs=0,fixtureBytes=0,settings:unknown=null;let sessionFile='',contentEntries=5000;const tokens:string[]=[];let oldPaths:string[]=[];
 const seedStart=performance.now();
 if(scenario==='history'){
  const entries:any[]=[{type:'session',version:3,id:'33333333-3333-4333-8333-333333333333',timestamp:'2026-01-01T00:00:00.000Z',cwd:workspace}];let parentId:null|string=null;
  for(let n=0;n<contentEntries;n++){const id='entry-'+n;entries.push({type:'message',id,parentId,timestamp:'2026-01-01T00:00:00.000Z',message:n%3===2?{role:'toolResult',toolName:'bash',toolCallId:'call-'+n,content:[{type:'text',text:'Synthetic tool history '+n+' '+('z'.repeat(2048))}],isError:false,timestamp:n}:{role:'user',content:'Synthetic history '+n+' '+('x'.repeat(2048)),timestamp:n}});parentId=id;}
  sessionFile=join(workspace,'history.jsonl');const serialized=entries.map(e=>JSON.stringify(e)).join('\n')+'\n';fixtureBytes=Buffer.byteLength(serialized);writeFileSync(sessionFile,serialized);
 }else{
  initDatabase();const db=getDb();settings={journal:db.query('PRAGMA journal_mode').get(),synchronous:db.query('PRAGMA synchronous').get(),busy:db.query('PRAGMA busy_timeout').get()};assert.deepEqual((settings as any).journal,{journal_mode:'wal'});assert.deepEqual((settings as any).synchronous,{synchronous:2});
  for(let chat=0;chat<10;chat++)storeChatMetadata('web:synthetic-'+chat,'2026-01-01T00:00:00.000Z');
  const insert=db.prepare('INSERT INTO messages(id,chat_jid,sender,sender_name,content,timestamp,is_from_me,is_bot_message,content_blocks) VALUES(?,?,?,?,?,?,?,?,?)');
  db.transaction(()=>{for(let n=0;n<10000;n++)insert.run('message-'+n,'web:synthetic-'+n%10,'synthetic','Synthetic','synthetic content '+n+' '+('y'.repeat(256)),new Date(1700000000000+n).toISOString(),0,0,JSON.stringify([{type:'text',text:'synthetic block'}]));
   for(let n=0;n<1000;n++){const token='synthetic-cookie-'+n;tokens.push(token);createWebSession(token,'default',3600,'totp');}
   if(scenario==='background')db.query("UPDATE web_sessions SET expires_at='2000-01-01T00:00:00.000Z' WHERE rowid%2=0").run();
   for(let n=0;n<1000;n++)storeToolOutputWithChunks({id:'output-'+n,created_at:n%2===0&&scenario==='background'?'2000-01-01T00:00:00.000Z':'2999-01-01T00:00:00.000Z',source:'synthetic'},Array.from({length:10},(_,k)=>'common marker'+n+' synthetic chunk '+k));
   if(scenario==='background'){for(let n=0;n<1000;n++)db.query('INSERT INTO user_auth_attempts(bucket,count,reset_at)VALUES(?,?,?)').run('synthetic-attempt-'+n,1,n%2?Date.now()+3600000:1);}
  }).immediate();
  if(scenario==='background'){
   const dir=join(data,'tool-output','2000','01','01');mkdirSync(dir,{recursive:true});
   for(let n=0;n<200;n++){const path=join(dir,'output-'+n+'.log');writeFileSync(path,'synthetic retained file');utimesSync(path,1,1);db.query('UPDATE tool_outputs SET path=? WHERE id=?').run(path,'output-'+n);if(n%2===0)oldPaths.push(path);}
   for(let n=0;n<200;n++){const path=join(dir,'orphan-'+n+'.log');writeFileSync(path,'synthetic orphan');utimesSync(path,1,1);oldPaths.push(path);}
  }
 }
 seedMs=performance.now()-seedStart;Bun.gc(true);const before=memory();instrument();loop.enable();await Bun.sleep(10);
 if(scenario==='history'){
  let retained=0;
  for(let batch=0;batch<6;batch++){
   await measure('open-project-history',()=>{const manager=SessionManager.open(sessionFile);assert.equal(manager.getEntries().length,contentEntries);for(let n=0;n<10;n++){const projection=manager.buildSessionProjection();assert.equal(projection.messages.length,contentEntries);retained+=projection.messages.length;}return undefined});await Bun.sleep(5);
  }
  assert.equal(retained,contentEntries*60);
 }else if(scenario==='mixed'){
  for(let batch=0;batch<20;batch++){
   await measure('mixed-request-batch',()=>{for(let n=0;n<25;n++){const index=(batch*25+n)%tokens.length;const req=new Request('https://synthetic.invalid/agent/timeline',{headers:{cookie:'piclaw_session='+tokens[index]}});const principal=resolveRequestPrincipal(req,{mode:'single-user',authEnabled:true},{getSession:getWebSession,getUser:id=>getUser(getDb(),id),getLocalDisplayName:()=> 'Synthetic'});assert.equal(principal?.userId,'default');const r=getTimelineResponse('web:synthetic-'+n%10,50);assert.equal((r.body as any).posts.length,50);const snippets=searchToolOutputSnippets('output-999','common',5);assert.equal(snippets.length,5);assert(snippets.every(x=>x.includes('marker999')));getDb().query('SELECT ? AS synthetic'+n).get(n);} });await Bun.sleep(5);
  }
  await measure('auth-maintenance-after-cache-churn',()=>{assert(Object.values(pruneExpiredAuthState(getDb())).every(n=>n===0))});
 }else{
  await measure('auth-expiry-cleanup',()=>{const c=pruneExpiredAuthState(getDb());assert.equal(c.sessions,500);assert.equal(c.attempts,500)});
  await measure('tool-output-db-and-files-cleanup',()=>{assert.equal(pruneToolOutputs(1000),500)});
  assert(oldPaths.every(path=>!existsSync(path)));assert.equal((getDb().query('SELECT count(*) AS n FROM tool_outputs').get()as any).n,500);
  await measure('repeat-idempotent-cleanup',()=>{assert.equal(pruneToolOutputs(1000),0);assert(Object.values(pruneExpiredAuthState(getDb())).every(n=>n===0))});
 }
 await Bun.sleep(10);loop.disable();const after=memory();const gcStart=performance.now();Bun.gc(true);const explicitGcMs=performance.now()-gcStart;const afterGc=memory();restore();
 if(scenario!=='history')assert.deepEqual(getDb().query('PRAGMA quick_check').get(),{quick_check:'ok'});assert.equal(networkAttempts,0);
 console.log(JSON.stringify({scenario,mode,runtime:Bun.version,seedMs,fixtureBytes,contentEntries:scenario==='history'?contentEntries:undefined,settings,rows,metrics:mode==='instrument'?counts:null,memory:{before,after,afterGc,explicitGcMs},eventLoop:{samples:loop.count,resolutionMs:1,maxMs:loop.max/1e6,meanMs:loop.mean/1e6,p99Ms:loop.percentile(99)/1e6},networkAttempts,resultDigest:hash(JSON.stringify({scenario,checks:'passed',iterations:scenario==='mixed'?500:scenario==='history'?60:3})),scope:'Synthetic real helpers/public SDK; seed/startup excluded wall rows but included whole-child CPU. No HTTP middleware, contention writer, family deployment, model, provider, real credentials or production DB. Explicit forced GC measures recovery cost, not automatic-GC causation.'}));
}finally{restore();loop.disable();if(scenario!=='history')closeDatabase()}
