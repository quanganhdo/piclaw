import '../setup-filesystem-isolation.js';
import assert from 'node:assert/strict';
import {join} from 'node:path';
import {performance} from 'node:perf_hooks';
import {initDatabase,getDb,closeDatabase} from '../../src/db/connection.js';
import {STORE_DIR} from '../../src/core/config.js';
import {handlePickerPins} from '../../src/channels/web/handlers/picker-pins.js';
import {changePickerPins} from '../../src/db/picker-pins.js';
assert.equal(process.env.PICLAW_DB_IN_MEMORY,'0');
initDatabase();const db=getDb();changePickerPins(db,'operator',{action:'set',kind:'model',key:'fixture/baseline',pinned:true});
const channel={broadcastEvent(){}} as any;
const results:any[]=[];
let blocker:ReturnType<typeof Bun.spawn>|undefined;
const server=Bun.serve({hostname:'127.0.0.1',port:0,async fetch(req){const path=new URL(req.url).pathname;if(path==='/agent/picker-pins')return handlePickerPins(req,channel);return Response.json({ack:true});}});
async function probe(mode:string){
  const started=performance.now();let timerDelay=0;
  const timer=new Promise<void>(resolve=>setTimeout(()=>{timerDelay=performance.now()-started;resolve();},10));
  const pin=fetch(new URL('/agent/picker-pins',server.url),{method:'POST',headers:{Origin:server.url.origin,'Content-Type':'application/json'},body:JSON.stringify({action:'set',kind:'model',key:`fixture/${mode}`,pinned:true})}).then(async res=>({status:res.status,ms:performance.now()-started,body:await res.json()}));
  const input=fetch(new URL('/input',server.url),{method:'POST',body:'synthetic'}).then(async res=>({status:res.status,ms:performance.now()-started,body:await res.json()}));
  const [pinResult,inputResult]=await Promise.all([pin,input,timer]).then(([pin,input])=>[pin,input]);results.push({mode,pin:pinResult,input:inputResult,timerDelayMs:timerDelay});
}
try{
  await probe('idle');
  blocker=Bun.spawn([process.execPath,'--no-env-file','-e',`import {Database} from 'bun:sqlite'; const d=new Database(${JSON.stringify(join(STORE_DIR,'messages.db'))});d.exec('BEGIN IMMEDIATE');console.log('LOCKED');await Bun.sleep(2000);d.exec('ROLLBACK');d.close();`],{stdin:'ignore',stdout:'pipe',stderr:'pipe',env:{PATH:process.env.PATH,HOME:process.env.HOME}});
  const reader=blocker.stdout.getReader();const first=await reader.read();assert.ok(new TextDecoder().decode(first.value).includes('LOCKED'));
  await probe('writer-lock');await blocker.exited;reader.releaseLock();
  console.log(JSON.stringify({kind:'picker-pin-load-profile',busyTimeout:db.query('PRAGMA busy_timeout').get(),results,scope:'real pin backend + disposable WAL lock; unrelated synthetic HTTP input ACK shows shared event-loop blockage, not full production admission/browser',network:'owned loopback only'}));
}finally{if(blocker?.exitCode===null){blocker.kill('SIGKILL');await blocker.exited;}server.stop(true);closeDatabase();}
