import { readAccessConfig } from "./config-access.js";
import { getExecutionIdentity } from "./execution-context.js";
import { getDb } from '../db/connection.js';
import { getRootOwnership, ChatAccessDenied } from '../db/session-ownership.js';
import { requireOwnedSessionExecution } from '../agent-pool/owned-session-access.js';
import { getChatJid } from './chat-context.js';

export class ToolOutputAccessDenied extends Error {
  constructor() { super("Tool output access denied."); }
}

export interface ToolOutputScope {ownerUserId:string;rootBranchId:string;sourceBranchId:string;chatJid:string;executionKind:string}
export interface ToolOutputAccessGuard {():void;readonly scope:ToolOutputScope|null;readonly cacheKey:string}

function resolveScope():{identity:ReturnType<typeof getExecutionIdentity>;scope:ToolOutputScope|null;cacheKey:string} {
  let mode;const identity=getExecutionIdentity();try{mode=readAccessConfig().mode;}catch{throw new ToolOutputAccessDenied();}
  if(mode==='single-user'&&(!identity||identity.mode==='single-user'))return {identity,scope:null,cacheKey:'legacy'};
  if(mode!=='family-shared'||identity?.mode!==mode||identity.provenance.actorUserId!==identity.provenance.ownerUserId)throw new ToolOutputAccessDenied();
  try {
    if(getChatJid('')!==identity.provenance.chatJid)throw new ChatAccessDenied();
    const db=getDb(),actor=requireOwnedSessionExecution(identity.provenance.chatJid),root=getRootOwnership(db,identity.provenance.chatJid),source=db.query('SELECT branch_id FROM chat_branches WHERE chat_jid=? AND archived_at IS NULL').get(identity.provenance.chatJid) as {branch_id:string}|null;
    if(!actor||actor.userId!==identity.provenance.ownerUserId||!root||!source||root.ownerUserId!==actor.userId||root.rootChatJid!==identity.rootChatJid)throw new ChatAccessDenied();
    const scope=Object.freeze({ownerUserId:actor.userId,rootBranchId:root.rootBranchId,sourceBranchId:source.branch_id,chatJid:identity.provenance.chatJid,executionKind:identity.provenance.kind});
    return {identity,scope,cacheKey:`${scope.ownerUserId}\0${scope.rootBranchId}\0${scope.sourceBranchId}\0${scope.executionKind}`};
  } catch { throw new ToolOutputAccessDenied(); }
}

export function canUseToolOutput(): boolean {
  try { resolveScope(); return true; } catch { return false; }
}

/** Compatibility predicate retained for callers that specifically require unowned legacy rows. */
export function canUseLegacyToolOutput(): boolean {
  try {
    const identity = getExecutionIdentity();
    return readAccessConfig().mode === "single-user" && (!identity || identity.mode === "single-user");
  } catch {
    return false;
  }
}

export function createToolOutputAccessGuard(): ToolOutputAccessGuard {
  const initial=resolveScope();let allowed=true;
  const check = () => {
    try {const current=resolveScope();allowed=allowed&&current.identity===initial.identity&&current.cacheKey===initial.cacheKey;}catch{allowed=false;}
    if (!allowed) throw new ToolOutputAccessDenied();
  };
  Object.defineProperties(check,{scope:{value:initial.scope},cacheKey:{value:initial.cacheKey}});check();return check as ToolOutputAccessGuard;
}
