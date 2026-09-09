import { join } from 'node:path';
import { initDatabase,getDb,closeDatabase } from '../../src/db/connection.js';
import { dispatchFamilyScheduledExecution } from '../../src/agent-pool/scheduled-dispatch.js';
import { runAgentPrompt,type RunAgentOrchestratorOptions } from '../../src/agent-pool/run-agent-orchestrator.js';
import { AgentTurnCoordinator } from '../../src/agent-pool/turn-coordinator.js';
import { requireOwnedSessionExecution } from '../../src/agent-pool/owned-session-access.js';
import { requireFamilyToolAccess } from '../../src/agent-pool/family-tool-access.js';
import { getExecutionIdentity } from '../../src/core/execution-context.js';
import { getChatJid } from '../../src/core/chat-context.js';
import { ChatAccessDenied } from '../../src/db/session-ownership.js';

const [phase,clock,replaySource]=process.argv.slice(2);
if(!['hydrate','prompt','settled','cancelled','replay'].includes(phase!)||!Number.isSafeInteger(Number(clock)))throw Error('Invalid worker fixture');
Date.now=()=>Number(clock);
const input=Bun.stdin.stream().getReader(),decoder=new TextDecoder();let buffered='';
async function line():Promise<string>{
  for(;;){const end=buffered.indexOf('\n');if(end>=0){const value=buffered.slice(0,end);buffered=buffered.slice(end+1);return value;}
    const chunk=await input.read();if(chunk.done)throw Error('Missing fixture input');buffered+=decoder.decode(chunk.value,{stream:true});}
}
// Proof is delivered through stdin only, never argv/environment or an on-disk fixture.
const {proof,owner,chat,prompt:expectedPrompt}=JSON.parse(await line());
let prompts=0,hydrations=0,network=0;
globalThis.fetch=async()=>{network++;throw Error('Network forbidden in deterministic worker fixture');};
initDatabase();getDb().exec('PRAGMA journal_mode=WAL; PRAGMA synchronous=FULL');
const notify=(stage:string)=>new Promise<void>((resolve,reject)=>process.stdout.write(JSON.stringify({stage,execution_id:proof.execution_id,prompts,hydrations,network})+'\n',error=>error?reject(error):resolve()));
const hold=async(stage:string)=>{await notify(stage);await new Promise<void>(()=>{setInterval(()=>{},60000);});};
const listeners=new Set<(event:any)=>void>();let active=['read','messages','bash'];
const checkIdentity=()=>{
  const identity=getExecutionIdentity();
  if(identity?.provenance.ownerUserId!==owner||identity.provenance.actorUserId!==owner||identity.provenance.chatJid!==chat||getChatJid()!==chat)throw Error('Wrong fixture identity');
};
const session={sessionManager:{getLeafId:()=>'leaf'},model:{provider:'fixture',id:'deterministic',contextWindow:100000},isStreaming:false,isCompacting:false,isRetrying:false,
  settingsManager:{getRetrySettings:()=>({enabled:true,maxRetries:3})},getActiveToolNames:()=>active,setActiveToolsByName:(names:string[])=>{active=names;},
  subscribe:(fn:(event:any)=>void)=>{listeners.add(fn);return()=>listeners.delete(fn);},abort:async()=>{},
  prompt:async(text:string)=>{
    prompts++;checkIdentity();if(text!==expectedPrompt||prompts!==1||JSON.stringify(active)!==JSON.stringify(['read','messages']))throw Error('Unexpected fixture prompt/tools');
    requireFamilyToolAccess('read');
    if(phase==='prompt')await hold('prompt');
    if(phase==='cancelled'){
      await notify('prompt');if(await line()!=='continue')throw Error('Invalid fixture continuation');
      let denied=false;try{requireFamilyToolAccess('read');}catch(error){if(!(error instanceof ChatAccessDenied))throw Error('Unexpected cancellation error');denied=true;}
      if(!denied)throw Error('Cancellation failed to fence stale worker');await hold('cancel-fenced');
    }
    const message={role:'assistant',content:[{type:'text',text:'deterministic worker result'}],provider:'fixture',model:'deterministic',stopReason:'stop',timestamp:Date.now()};
    for(const fn of listeners){fn({type:'message_update',assistantMessageEvent:{type:'text_delta',delta:'deterministic worker result'}});fn({type:'message_update',assistantMessageEvent:{type:'message_end',message}});}
  }};
const options:RunAgentOrchestratorOptions={getOrCreateRuntime:async()=>{
  hydrations++;checkIdentity();requireOwnedSessionExecution(chat);if(phase==='hydrate')await hold('hydrate');
  return {session,services:{settingsManager:session.settingsManager},dispose:async()=>{}} as any;
},turnCoordinator:new AgentTurnCoordinator({takeAttachments:()=>[],touchSession:()=>{},recordMessageUsage:()=>{}}),clearAttachments:()=>{},takeAttachments:()=>[],logsDir:join(process.env.PICLAW_WORKSPACE!,'logs'),setActiveForkBaseLeaf:()=>{},clearActiveForkBaseLeaf:()=>{}};
let run:(()=>Promise<void>)|undefined;
try{
  const outcome=dispatchFamilyScheduledExecution(proof,{queue:{enqueue:callback=>{run=callback;}},agentPool:{runAgent:(p,c,o)=>runAgentPrompt(p,c,o,options)}}).then(()=>({ok:true,error:null}),error=>({ok:false,error}));
  if(run)await run();const {ok:succeeded,error}=await outcome;
  if(phase==='replay'){
    const expected=(replaySource==='hydrate'||replaySource==='prompt')
      ? error?.code==='SQLITE_CONSTRAINT_PRIMARYKEY' && String(error?.message).includes('family_scheduled_dispatches.execution_id') && !!run
      : ['settled','cancelled'].includes(replaySource!) && error instanceof ChatAccessDenied && !run;
    if(succeeded||prompts||hydrations||network||!expected)throw Error('Restart replay did not hit expected durable fence');await notify('replay-denied');closeDatabase();input.releaseLock();
  }else{
    if(phase!=='settled'||!succeeded||prompts!==1||hydrations!==1||network)throw Error('Fixture dispatch did not reach requested stage');await hold('settled');
  }
}catch{
  // Never print proof-bearing errors or stack values from child fixture state.
  process.stderr.write('WORKER_CRASH_FIXTURE_FAILED\n');process.exitCode=1;
}
