import type Database from "bun:sqlite";
import type { AuthenticatedPrincipal } from "../core/access-types.js";
import { readAccessConfig } from "../core/config-access.js";
import { ChatAccessDenied,resolveAuthorisedChat } from "./session-ownership.js";
import { requireAccountActor } from "./account-administration.js";
import { readOwnFamilyTask } from "./family-task-admission.js";
import { claimFamilyScheduledOccurrence } from "./family-scheduled-occurrences.js";
import { beginFamilyScheduledExecution,readOwnFamilyScheduledResult,type FamilySettlementCapability } from "./family-scheduled-executions.js";

const identifier=(value:unknown):value is string=>typeof value==='string'&&/^[a-zA-Z0-9_-]{1,128}$/.test(value);
interface Receipt {grant_id:string;execution_id:string;login_session_id:string;created_at:number}

/** Standalone owner admission. Only first creation returns a private capability; never send it to a browser. */
export function admitOwnFamilyScheduledExecution(database:Database,actor:AuthenticatedPrincipal,grantId:string,requestId:string):{
  receipt:{request_id:string;grant_id:string;execution_id:string;created:boolean;state:'admitted'};
  capability:FamilySettlementCapability|null;
} {
  if(database.inTransaction)throw new ChatAccessDenied();
  return database.transaction(()=>{
    if(readAccessConfig().mode!=='family-shared'||!identifier(grantId)||!identifier(requestId))throw new ChatAccessDenied();
    requireAccountActor(database,actor,{recent:true});
    const previous=database.query('SELECT grant_id,execution_id,login_session_id,created_at FROM family_execution_admissions WHERE owner_user_id=? AND request_id=?')
      .get(actor.userId,requestId) as Receipt|null;
    const receipt=(executionId:string,created:boolean)=>({request_id:requestId,grant_id:grantId,execution_id:executionId,created,state:'admitted' as const});
    if(previous){
      if(previous.grant_id!==grantId||!identifier(previous.execution_id)||!identifier(previous.login_session_id)||!Number.isSafeInteger(previous.created_at))throw new ChatAccessDenied();
      // Reauthenticated owners may acknowledge a cancelled/revoked/completed handoff, but never get its token back.
      const source=readOwnFamilyScheduledResult(database,actor,previous.execution_id);
      const binding=database.query(`SELECT e.grant_id,e.created_at,o.worker_id FROM family_scheduled_executions e
        JOIN family_scheduled_occurrences o ON o.id=e.occurrence_id WHERE e.id=? AND e.owner_user_id=?`).get(previous.execution_id,actor.userId) as {grant_id:string;created_at:number;worker_id:string}|null;
      if(!binding||binding.grant_id!==grantId||binding.created_at!==previous.created_at||binding.worker_id!=='owner-request'||source.owner_user_id!==actor.userId)throw new ChatAccessDenied();
      return {receipt:receipt(previous.execution_id,false),capability:null};
    }
    // A changed request key must not reclaim or recreate authority already admitted for this grant.
    if(database.query('SELECT 1 FROM family_execution_admissions WHERE grant_id=?').get(grantId))throw new ChatAccessDenied();
    const task=readOwnFamilyTask(database,actor,grantId);
    if(task.revoked||!task.preparation)throw new ChatAccessDenied();
    resolveAuthorisedChat(database,actor,task.chat_jid,'session.write');
    const lease=claimFamilyScheduledOccurrence(database,grantId,'owner-request');
    const capability=beginFamilyScheduledExecution(database,lease);
    const execution=database.query('SELECT created_at FROM family_scheduled_executions WHERE id=?').get(capability.execution_id) as {created_at:number};
    if(!identifier(actor.authentication.sessionId))throw new ChatAccessDenied();
    database.query('INSERT INTO family_execution_admissions(owner_user_id,request_id,grant_id,execution_id,login_session_id,created_at) VALUES (?,?,?,?,?,?)')
      .run(actor.userId,requestId,grantId,capability.execution_id,actor.authentication.sessionId,execution.created_at);
    return {receipt:receipt(capability.execution_id,true),capability};
  }).immediate();
}
