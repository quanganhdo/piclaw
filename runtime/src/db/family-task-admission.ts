import type Database from "bun:sqlite";
import { createHash } from "node:crypto";
import type { AuthenticatedPrincipal } from "../core/access-types.js";
import { readAccessConfig } from "../core/config-access.js";
import { FAMILY_WEB_TOOLS } from "../core/family-workspace-policy.js";
import { requireAccountActor } from "./account-administration.js";
import { ChatAccessDenied,resolveAuthorisedChat } from "./session-ownership.js";
import { createFamilyScheduledTask,inspectFamilyScheduledGrant } from "./family-scheduled-grants.js";

export interface FamilyTaskPreparation { request_id:string; chat_jid:string; prompt:string; scheduled_for:string; allowed_tools:string[] }
interface GrantMetadata {id:string;task_id:string;chat_jid:string;target_branch_id:string;root_branch_id:string;created_at:string;revoked:number}

function owner(database:Database,actor:AuthenticatedPrincipal,recent=false):void {
  if(readAccessConfig().mode!=="family-shared")throw new ChatAccessDenied();
  requireAccountActor(database,actor,{recent});
}
function id(value:unknown):asserts value is string {if(typeof value!=="string"||!/^[a-zA-Z0-9_-]{1,128}$/.test(value))throw new ChatAccessDenied();}
function preparation(value:FamilyTaskPreparation):FamilyTaskPreparation {
  const keys=["request_id","chat_jid","prompt","scheduled_for","allowed_tools"];
  if(!value||typeof value!=="object"||Array.isArray(value)||Reflect.ownKeys(value).length!==keys.length
    ||Reflect.ownKeys(value).some(key=>typeof key!=="string"||!keys.includes(key)||!("value" in Object.getOwnPropertyDescriptor(value,key)!)))throw new ChatAccessDenied();
  id(value.request_id);
  if(typeof value.chat_jid!=="string"||!value.chat_jid.trim()||value.chat_jid!==value.chat_jid.trim()||value.chat_jid.length>512
    ||typeof value.prompt!=="string"||!value.prompt.trim()||value.prompt.includes("\0")||Buffer.byteLength(value.prompt,"utf8")>102400
    ||typeof value.scheduled_for!=="string"||!Number.isFinite(Date.parse(value.scheduled_for))||new Date(value.scheduled_for).toISOString()!==value.scheduled_for
    ||!Array.isArray(value.allowed_tools)||value.allowed_tools.length>FAMILY_WEB_TOOLS.length||new Set(value.allowed_tools).size!==value.allowed_tools.length
    ||value.allowed_tools.some(name=>!(FAMILY_WEB_TOOLS as readonly unknown[]).includes(name)))throw new ChatAccessDenied();
  return {request_id:value.request_id,chat_jid:value.chat_jid,prompt:value.prompt,scheduled_for:value.scheduled_for,allowed_tools:FAMILY_WEB_TOOLS.filter(name=>value.allowed_tools.includes(name))};
}

/** Owner/key idempotency and owner quota commit in the same transaction as the paused task and grant. */
export function prepareOwnFamilyTask(database:Database,actor:AuthenticatedPrincipal,input:FamilyTaskPreparation) {
  return database.transaction(()=>{
    owner(database,actor,true);const next=preparation(input);
    resolveAuthorisedChat(database,actor,next.chat_jid,"session.write");
    const inputHash=createHash("sha256").update(JSON.stringify([next.chat_jid,next.prompt,next.scheduled_for,next.allowed_tools])).digest("hex");
    const previous=database.query("SELECT grant_id,input_hash FROM family_task_admissions WHERE owner_user_id=? AND request_id=?").get(actor.userId,next.request_id) as {grant_id:string;input_hash:string}|null;
    if(previous){
      if(previous.input_hash!==inputHash)throw new ChatAccessDenied();
      const grant=inspectFamilyScheduledGrant(database,previous.grant_id);
      const issued=database.query("SELECT allowed_tools FROM family_scheduled_grants WHERE id=?").get(previous.grant_id) as {allowed_tools:string}|null;
      if(grant.ownerUserId!==actor.userId||grant.chatJid!==next.chat_jid||grant.prompt!==next.prompt||grant.scheduledFor!==next.scheduled_for)throw new ChatAccessDenied();
      // Compare the immutable issued set, not the current effective intersection:
      // a later policy restriction must not make an identical retry create work.
      if(!issued||issued.allowed_tools!==JSON.stringify(next.allowed_tools))throw new ChatAccessDenied();
      return {task_id:grant.taskId,grant_id:grant.grantId,created:false,state:"paused" as const};
    }
    const count=database.query(`SELECT count(*) n FROM family_scheduled_grants g WHERE g.owner_user_id=? AND NOT EXISTS
      (SELECT 1 FROM family_scheduled_grant_revocations r WHERE r.grant_id=g.id)`).get(actor.userId) as {n:number};
    if(count.n>=100)throw new ChatAccessDenied();
    const created=createFamilyScheduledTask(database,actor,next.chat_jid,{prompt:next.prompt,scheduled_for:next.scheduled_for,allowed_tools:next.allowed_tools});
    database.query("INSERT INTO family_task_admissions(owner_user_id,request_id,grant_id,input_hash,login_session_id,created_at) VALUES (?,?,?,?,?,?)")
      .run(actor.userId,next.request_id,created.grant_id,inputHash,actor.authentication.sessionId!,new Date().toISOString());
    return {...created,created:true,state:"paused" as const};
  }).immediate();
}

function validateTarget(database:Database,actor:AuthenticatedPrincipal,row:GrantMetadata):void {
  const target=resolveAuthorisedChat(database,actor,row.chat_jid,"session.read");
  const branch=database.query("SELECT branch_id FROM chat_branches WHERE chat_jid=? AND handle_owner_id=?").get(row.chat_jid,actor.userId) as {branch_id:string}|null;
  if(target.rootBranchId!==row.root_branch_id||branch?.branch_id!==row.target_branch_id)throw new ChatAccessDenied();
}
const metadataSql=`SELECT g.id,g.task_id,g.chat_jid,g.target_branch_id,g.root_branch_id,g.created_at,
  EXISTS(SELECT 1 FROM family_scheduled_grant_revocations r WHERE r.grant_id=g.id) AS revoked FROM family_scheduled_grants g`;

/** No prompt/token data; limited before per-target validation, without filling from older entries. */
export function listOwnFamilyTasks(database:Database,actor:AuthenticatedPrincipal) {
  return database.transaction(()=>{
    owner(database,actor);
    const rows=database.query(`${metadataSql} WHERE g.owner_user_id=? ORDER BY g.created_at DESC,g.id DESC LIMIT 50`).all(actor.userId) as GrantMetadata[];
    const items=rows.flatMap(row=>{try{validateTarget(database,actor,row);return [{grant_id:row.id,task_id:row.task_id,chat_jid:row.chat_jid,created_at:row.created_at,revoked:row.revoked===1}];}
      catch(error){if(error instanceof ChatAccessDenied)return [];throw error;}});
    return {owner_user_id:actor.userId,window_size:50,activation_available:false,items};
  })();
}

export function readOwnFamilyTask(database:Database,actor:AuthenticatedPrincipal,grantId:string) {
  return database.transaction(()=>{
    owner(database,actor);id(grantId);
    const row=database.query(`${metadataSql} WHERE g.id=? AND g.owner_user_id=?`).get(grantId,actor.userId) as GrantMetadata|null;
    if(!row)throw new ChatAccessDenied();validateTarget(database,actor,row);
    const grant=row.revoked?null:inspectFamilyScheduledGrant(database,grantId);
    return {grant_id:row.id,task_id:row.task_id,chat_jid:row.chat_jid,revoked:row.revoked===1,activation_available:false,
      preparation:grant?{prompt:grant.prompt,scheduled_for:grant.scheduledFor,allowed_tools:grant.toolPolicy.allowed,state:"paused"}:null};
  })();
}
