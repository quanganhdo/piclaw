import type { AgentOutput, RunAgentOptions } from "./contracts.js";
import type { FamilySettlementCapability } from "../db/family-scheduled-executions.js";
import { readFamilyScheduledDispatch, startFamilyScheduledDispatch, settleFamilyScheduledExecution } from "../db/family-scheduled-executions.js";
import { getDb } from "../db/connection.js";
import { withChatContext } from "../core/chat-context.js";
import { withExecutionIdentity } from "../core/execution-context.js";
import { ChatAccessDenied } from "../db/session-ownership.js";
import { hasScheduledDispatch, withScheduledDispatch } from "./scheduled-dispatch-context.js";
import { createUuid } from "../utils/ids.js";
import { createLogger, debugSuppressedError } from "../utils/logger.js";

const log=createLogger("agent-pool.scheduled-dispatch");

interface DispatchDeps {
  queue: { enqueue: (run:()=>Promise<void>,id:string,lane:string)=>void };
  agentPool: { runAgent:(prompt:string,chatJid:string,options:RunAgentOptions)=>Promise<AgentOutput> };
}

/** Internal one-shot dispatcher, not wired to polling or HTTP. Settlement never publishes to a conversation. */
export async function dispatchFamilyScheduledExecution(capability:FamilySettlementCapability,deps:DispatchDeps) {
  if(hasScheduledDispatch())throw new ChatAccessDenied();
  if(!capability||typeof capability!=="object"||Reflect.ownKeys(capability).length!==2
    ||Reflect.ownKeys(capability).some(key=>!["execution_id","token"].includes(String(key))||!("value" in Object.getOwnPropertyDescriptor(capability,key)!)))throw new ChatAccessDenied();
  // Copy primitive capability fields once; never give them to AgentPool, prompts or callbacks.
  const proof=Object.freeze({execution_id:capability.execution_id,token:capability.token});
  const initial=readFamilyScheduledDispatch(getDb(),proof);
  return await new Promise<{execution_id:string;settled:true}>((resolve,reject)=>{
    let cancelled=false;
    const timer=setTimeout(()=>{cancelled=true;reject(new Error("Scheduled dispatch queue wait expired."));},30000);
    try {
      deps.queue.enqueue(async()=>{
        if(cancelled)return;
        clearTimeout(timer);
        let outstanding:Promise<AgentOutput>|undefined,expired=false;
        try {
          const descriptor=startFamilyScheduledDispatch(getDb(),proof),identity=descriptor.identity,chat=identity.provenance.chatJid;
          const timeoutMs=Math.min(60000,descriptor.expiresAt-Date.now());
          if(timeoutMs<=0)throw new ChatAccessDenied();
          const deadline=performance.now()+timeoutMs;let valid=true;
          const validate=()=>{
            try {
              if(!valid||performance.now()>=deadline)throw new ChatAccessDenied();
              const live=readFamilyScheduledDispatch(getDb(),proof);
              if(live.prompt!==descriptor.prompt||live.identity.provenance.ownerUserId!==identity.provenance.ownerUserId
                ||live.identity.rootChatJid!==identity.rootChatJid||live.identity.role!==identity.role
                ||JSON.stringify(live.identity.toolPolicy?.allowed)!==JSON.stringify(identity.toolPolicy?.allowed))throw new ChatAccessDenied();
            }catch(error){valid=false;throw error;}
          };
          let expiry:ReturnType<typeof setTimeout>|undefined;
          let output:AgentOutput;
          try {
            output=await withChatContext(chat,"web",()=>withScheduledDispatch(identity,descriptor.prompt,validate,()=>withExecutionIdentity(identity,()=>
              Promise.race([outstanding=deps.agentPool.runAgent(descriptor.prompt,chat,{executionProvenance:identity.provenance,timeoutMs,skipPrePromptCompaction:true,
                scheduleIdleAutoCompaction:false,deferToolEnabledContinuation:true,toolCeilingFilter:name=>identity.toolPolicy!.allowed.includes(name)}),
                new Promise<never>((_,reject)=>{expiry=setTimeout(()=>{expired=true;valid=false;reject(new Error("Scheduled dispatch deadline expired."));},timeoutMs);})]))));
          }finally{if(expiry)clearTimeout(expiry);}
          validate();
          if(!output||!["success","error","tool_complete"].includes(output.status))throw new ChatAccessDenied();
          const text=output.status==="error" ? output.error??"Scheduled model execution failed." : output.result??"";
          if(output.attachments?.length||output.requiresToolEnabledContinuation||typeof text!=="string"||text.includes("\0")||Buffer.byteLength(text,"utf8")>102400)throw new ChatAccessDenied();
          settleFamilyScheduledExecution(getDb(),proof,{status:output.status==="error"?"error":"success",text});
          resolve({execution_id:proof.execution_id,settled:true});
        }catch(error){
          reject(error);
          // A timed-out SDK call may ignore abort. Keep its lane occupied until
          // it settles; the closed scope fences later tools and discards output.
          if(expired&&outstanding)try{await outstanding;}catch(late){debugSuppressedError(log,"Late scheduled call failed after deadline",late,{operation:"scheduled_dispatch.late_failure"});}
        }
      },createUuid("scheduled-dispatch"),`chat:${initial.identity.provenance.chatJid}`);
    }catch(error){clearTimeout(timer);cancelled=true;reject(error);}
  });
}
