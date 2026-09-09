import { afterEach,beforeEach,expect,test } from 'bun:test';
import Database from 'bun:sqlite';
import { existsSync,mkdirSync,readFileSync,readdirSync,writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { createTempWorkspace,setEnv } from '../helpers.js';
import { initDatabase,getDb,closeDatabase } from '../../src/db/connection.js';
import { createWebSession } from '../../src/db/web-sessions.js';
import { provisionFamilyAccount,updateManagedAccount } from '../../src/db/account-administration.js';
import { getUser } from '../../src/db/users.js';
import { createFamilyScheduledTask } from '../../src/db/family-scheduled-grants.js';
import { claimFamilyScheduledOccurrence } from '../../src/db/family-scheduled-occurrences.js';
import { beginFamilyScheduledExecution,readOwnFamilyScheduledResult,readFamilyScheduledDispatch,startFamilyScheduledDispatch,settleFamilyScheduledExecution,recoverExpiredFamilyScheduledExecutions,cancelOwnFamilyScheduledExecution } from '../../src/db/family-scheduled-executions.js';
import type { AuthenticatedPrincipal } from '../../src/core/access-types.js';
import { ChatAccessDenied } from '../../src/db/session-ownership.js';

let ws:ReturnType<typeof createTempWorkspace>,restore:()=>void,alice:AuthenticatedPrincipal,clock:number;const realNow=Date.now;
function actor(id:string):AuthenticatedPrincipal{
  const user=getUser(getDb(),id)!,login=createWebSession(`crash-${id}`,id,3600,'passkey');return {kind:'user',mode:'family-shared',userId:id,username:user.username,displayName:user.display_name,role:user.role,homeChatJid:user.home_chat_jid,authentication:{method:'passkey',sessionId:login.session_id!,expiresAt:login.expires_at}};
}
beforeEach(()=>{
  ws=createTempWorkspace('scheduled-worker-crash-');restore=setEnv({PICLAW_WORKSPACE:ws.workspace,PICLAW_STORE:ws.store,PICLAW_DATA:ws.data});
  mkdirSync(join(ws.workspace,'.piclaw'));writeFileSync(join(ws.workspace,'.piclaw/config.json'),JSON.stringify({domains:{access:{mode:'family-shared'}}}));
  closeDatabase();initDatabase();const admin=actor('default'),user=provisionFamilyAccount(getDb(),admin,{username:'alice',displayName:'Alice'});
  getDb().query("INSERT INTO webauthn_credentials(user_id,rp_id,credential_id,public_key) VALUES (?,'family.local','fixture','key')").run(user.id);
  updateManagedAccount(getDb(),admin,user.id,{enabled:true},{totp:false,passkey:true,rpId:'family.local'});alice=actor(user.id);clock=realNow()+10;Date.now=()=>clock;
});
afterEach(()=>{Date.now=realNow;closeDatabase();restore();ws.cleanup();});
const unchanged=(db:Database)=>JSON.stringify(['messages','chat_cursors','family_scheduled_publications'].map(table=>db.query(`SELECT * FROM ${table} ORDER BY rowid`).all()));
async function boundedExit(child:ReturnType<typeof Bun.spawn>):Promise<number>{
  let timer:ReturnType<typeof setTimeout>|undefined;
  try{return await Promise.race([child.exited,new Promise<never>((_,reject)=>{timer=setTimeout(()=>{child.kill('SIGKILL');reject(Error('Child exit timeout'));},5000);})]);}finally{clearTimeout(timer);}
}
function assertNoTokenFiles(root:string,token:string):void{
  if(!existsSync(root))return;
  for(const entry of readdirSync(root,{withFileTypes:true})){
    const path=join(root,entry.name);if(entry.isDirectory())assertNoTokenFiles(path,token);else if(entry.isFile())expect(readFileSync(path).includes(Buffer.from(token))).toBe(false);
  }
}

for(const phase of ['hydrate','prompt','settled','cancelled'])test(`SIGKILL scheduled worker at ${phase} preserves durable outcome and denies restart replay`,async()=>{
  const db=getDb(),prompt='deterministic owned prompt',ids=createFamilyScheduledTask(db,alice,alice.homeChatJid!,{prompt,scheduled_for:new Date(clock+1000).toISOString(),allowed_tools:['read','messages']});
  clock+=1000;const proof=beginFamilyScheduledExecution(db,claimFamilyScheduledOccurrence(db,ids.grant_id,'crash-worker'));
  const store=join(ws.workspace,'copy');mkdirSync(store);const path=join(store,'messages.db');db.query('VACUUM INTO ?').run(path);const baseline=unchanged(db);
  const payload=JSON.stringify({proof,owner:alice.userId,chat:alice.homeChatJid,prompt})+'\n';
  const spawn=(stage:string)=>{
    const child=Bun.spawn([process.execPath,join(import.meta.dir,'../fixtures/family-scheduled-worker-crash.ts'),stage,String(clock),phase],{
      env:{...process.env,PICLAW_WORKSPACE:ws.workspace,PICLAW_STORE:store,PICLAW_DATA:ws.data,PICLAW_DB_IN_MEMORY:'0'},stdin:'pipe',stdout:'pipe',stderr:'pipe'});
    child.stdin.write(payload);const stderr=new Response(child.stderr).text(),reader=child.stdout.getReader();let buffer='';
    const marker=async()=>{
      let timer:ReturnType<typeof setTimeout>|undefined;
      try{return await Promise.race([(async()=>{
        for(;;){const end=buffer.indexOf('\n');if(end>=0){const line=buffer.slice(0,end);buffer=buffer.slice(end+1);if(line.includes(proof.token))throw Error('Proof leaked in marker');const value=JSON.parse(line);if(value.stage)return value;if(!['info','warn','debug'].includes(value.level))throw Error('Unexpected worker diagnostic');continue;}
          const next=await reader.read();if(next.done)throw Error('Worker exited before requested checkpoint');buffer+=new TextDecoder().decode(next.value);}
      })(),new Promise<never>((_,reject)=>{timer=setTimeout(()=>reject(Error('Worker checkpoint timeout')),15000);})]);}finally{clearTimeout(timer);}
    };
    const drain=async()=>{let rest=buffer;for(;;){const chunk=await reader.read();if(chunk.done)break;rest+=new TextDecoder().decode(chunk.value);}expect(rest.includes(proof.token)).toBe(false);};
    return {child,stderr,reader,marker,drain};
  };
  const worker=spawn(phase);
  try{
    const marker=await worker.marker();expect(marker).toEqual({stage:phase==='cancelled'?'prompt':phase,execution_id:proof.execution_id,prompts:phase==='hydrate'?0:1,hydrations:1,network:0});
    const observing=new Database(path);
    try{
      expect(observing.query('SELECT execution_id FROM family_scheduled_dispatches').all()).toEqual([{execution_id:proof.execution_id}]);expect(unchanged(observing)).toBe(baseline);
      if(phase==='cancelled'){expect(cancelOwnFamilyScheduledExecution(observing,alice,proof.execution_id).created).toBe(true);worker.child.stdin.write('continue\n');expect((await worker.marker()).stage).toBe('cancel-fenced');}
    }finally{observing.close();}
    worker.child.kill('SIGKILL');expect(await boundedExit(worker.child)).not.toBe(0);await worker.drain();
    const errors=await worker.stderr;expect(errors.includes(proof.token)).toBe(false);for(const line of errors.trim().split('\n').filter(Boolean)){expect(['warn','info']).toContain(JSON.parse(line).level);}
  }finally{worker.child.kill('SIGKILL');await boundedExit(worker.child);worker.reader.releaseLock();}
  const reopened=new Database(path);let resultSnapshot:string;
  try{
    expect(unchanged(reopened)).toBe(baseline);expect(recoverExpiredFamilyScheduledExecutions(reopened)).toEqual({recorded:0});
    const state=readOwnFamilyScheduledResult(reopened,alice,proof.execution_id);expect(state.state).toBe(phase==='settled'?'settled':phase==='cancelled'?'cancelled':'unsettled');
    if(phase==='settled')expect(state.result?.text).toBe('deterministic worker result');else expect(state.result).toBeNull();
    if(phase==='hydrate'||phase==='prompt'){
      expect(readFamilyScheduledDispatch(reopened,proof).prompt).toBe(prompt);
      // Live proof still preflights: restart denial is specifically the durable one-start receipt.
      expect(()=>startFamilyScheduledDispatch(reopened,proof)).toThrow('UNIQUE');
    }
    resultSnapshot=JSON.stringify(reopened.query('SELECT * FROM family_scheduled_results').all());
  }finally{reopened.close();}
  const retry=spawn('replay');retry.child.stdin.end();
  try{expect(await retry.marker()).toEqual({stage:'replay-denied',execution_id:proof.execution_id,prompts:0,hydrations:0,network:0});expect(await boundedExit(retry.child)).toBe(0);await retry.drain();expect((await retry.stderr).includes(proof.token)).toBe(false);}
  finally{retry.child.kill('SIGKILL');await boundedExit(retry.child);retry.reader.releaseLock();}
  const final=new Database(path);
  try{
    expect(JSON.stringify(final.query('SELECT * FROM family_scheduled_results').all())).toBe(resultSnapshot!);expect(unchanged(final)).toBe(baseline);
    clock+=900000;expect(recoverExpiredFamilyScheduledExecutions(final)).toEqual({recorded:phase==='hydrate'||phase==='prompt'?1:0});expect(recoverExpiredFamilyScheduledExecutions(final)).toEqual({recorded:0});
    expect(()=>settleFamilyScheduledExecution(final,proof,{status:'success',text:'late'})).toThrow(ChatAccessDenied);expect(()=>startFamilyScheduledDispatch(final,proof)).toThrow(ChatAccessDenied);
    const outcome=readOwnFamilyScheduledResult(final,alice,proof.execution_id);
    expect(outcome.state).toBe(phase==='settled'?'settled':phase==='cancelled'?'cancelled':'expired');
    if(phase==='settled')expect(outcome.result?.text).toBe('deterministic worker result');else expect(outcome.result).toBeNull();
    expect(JSON.stringify(final.query('SELECT * FROM family_scheduled_results').all())).toBe(resultSnapshot!);
    expect(final.query('SELECT count(*) n FROM family_scheduled_dispatches').get()).toEqual({n:1});expect(unchanged(final)).toBe(baseline);expect(final.query('SELECT status FROM scheduled_tasks WHERE id=?').get(ids.task_id)).toEqual({status:'paused'});
  }finally{final.close();assertNoTokenFiles(join(ws.workspace,'logs'),proof.token);}
},45000);
