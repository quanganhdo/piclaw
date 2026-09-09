import type Database from 'bun:sqlite';
import { closeSync, existsSync, lstatSync, mkdirSync, openSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { createHash, randomBytes, randomUUID, timingSafeEqual } from 'node:crypto';
import { dirname, resolve, sep } from 'node:path';
import type { AuthenticatedPrincipal } from '../core/access-types.js';
import { readAccessConfig } from '../core/config-access.js';
import { getDataDir, getStoreDir, getWorkspaceDir } from '../core/config-context.js';
import { getExecutionIdentity } from '../core/execution-context.js';
import { requireAccountActor } from '../db/account-administration.js';
import { getDb } from '../db/connection.js';
import { ChatAccessDenied } from '../db/session-ownership.js';
import { createLogger,debugSuppressedError } from '../utils/logger.js';

const MAX_DAYS=31,MAX_MESSAGES=5000,MAX_MESSAGE_BYTES=100*1024,MAX_TOTAL_BYTES=8*1024*1024;
const log=createLogger('agent-memory.family-dream');
const safeId=(value:string)=>/^[a-zA-Z0-9_-]{1,128}$/.test(value);
const wellFormed=(value:string)=>Buffer.from(value,'utf8').toString('utf8')===value;
const hash=(value:string)=>createHash('sha256').update(value).digest('hex');
const json=(value:unknown)=>JSON.stringify(value).replaceAll('\u2028','\\u2028').replaceAll('\u2029','\\u2029');
interface Row {rowid:number;message_id:string;chat_jid:string;root_chat_jid:string;content:string;timestamp:string;sender_name:string;is_bot_message:number}
export interface FamilyDreamSnapshot {owner_user_id:string;generation:string;root:string;current_path:string;message_count:number;tree_count:number;days:string[]}
export interface FamilyDreamProposalCapability {proposal_id:string;generation:string;token:string}
interface ProposalGrant {owner:string;generation:string;tokenHash:string;baseHash:string|null;expiresAt:number;workspace:string;store:string;data:string;database:Database}
const proposalGrants=new Map<string,ProposalGrant>();
function pruneProposalGrants(now=Date.now()){for(const [id,grant] of proposalGrants)if(grant.expiresAt<=now)proposalGrants.delete(id);}

function ensureDirectory(path:string):void {
  mkdirSync(path,{recursive:true,mode:0o700});
  let current=path;
  while(current!==dirname(current)){
    const stat=lstatSync(current);if(stat.isSymbolicLink()||!stat.isDirectory())throw new ChatAccessDenied();
    if(current===getWorkspaceDir())break;current=dirname(current);
  }
}
function atomic(path:string,content:string,validate:()=>void):void {
  validate();ensureDirectory(dirname(path));const temp=`${path}.tmp-${randomUUID()}`;
  try{writeFileSync(temp,content,{encoding:'utf8',mode:0o600,flag:'wx'});validate();renameSync(temp,path);}
  finally{rmSync(temp,{force:true});}
}
function day(timestamp:string):string {const date=new Date(timestamp);if(!Number.isFinite(date.getTime())||date.toISOString()!==timestamp)throw new ChatAccessDenied();return timestamp.slice(0,10);}
function readText(path:string,max:number):string|null {if(!existsSync(path))return null;const value=readFileSync(path,'utf8');if(!wellFormed(value)||value.includes('\0')||Buffer.byteLength(value)>max)throw new ChatAccessDenied();return value;}
function parseObject(path:string,keys:string[]):Record<string,unknown>{const text=readText(path,64*1024);if(text===null)throw new ChatAccessDenied();let value:unknown;try{value=JSON.parse(text);}catch{throw new ChatAccessDenied();}if(!value||typeof value!=='object'||Array.isArray(value)||Object.keys(value).length!==keys.length||Object.keys(value).some(k=>!keys.includes(k)))throw new ChatAccessDenied();return value as Record<string,unknown>;}
function authority(database:Database,principal:AuthenticatedPrincipal,recent=true){if(readAccessConfig().mode!=='family-shared'||getExecutionIdentity()||database!==getDb())throw new ChatAccessDenied();return requireAccountActor(database,principal,{recent});}
function ownerRoot(workspace:string,owner:string){if(!safeId(owner))throw new ChatAccessDenied();const root=resolve(workspace,'notes','users',owner,'dream');if(!root.startsWith(resolve(workspace,'notes','users')+sep))throw new ChatAccessDenied();return root;}
function currentGeneration(database:Database,principal:AuthenticatedPrincipal){const actor=authority(database,principal),workspace=getWorkspaceDir(),root=ownerRoot(workspace,actor.id),pointer=parseObject(resolve(root,'current.json'),['version','generation','owner_user_id','manifest_sha256','generated_at']);
  if(pointer.version!==1||pointer.owner_user_id!==actor.id||typeof pointer.generation!=='string'||!safeId(pointer.generation)||typeof pointer.manifest_sha256!=='string'||!/^[a-f0-9]{64}$/.test(pointer.manifest_sha256))throw new ChatAccessDenied();
  const generation=resolve(root,'generations',pointer.generation),manifest=readText(resolve(generation,'manifest.json'),64*1024);if(manifest===null||hash(manifest)!==pointer.manifest_sha256)throw new ChatAccessDenied();return {actor,workspace,root,generation:generation,generationId:pointer.generation};}

/** Issue a private short-lived output capability. No bearer material is persisted. */
export function issueOwnFamilyDreamProposalCapability(database:Database,principal:AuthenticatedPrincipal):FamilyDreamProposalCapability{
  pruneProposalGrants();
  const current=currentGeneration(database,principal),proposalId=randomUUID(),token=randomBytes(32).toString('base64url'),memoryPath=resolve(current.workspace,'notes','users',current.actor.id,'MEMORY.md'),base=readText(memoryPath,256*1024);
  proposalGrants.set(proposalId,{owner:current.actor.id,generation:current.generationId,tokenHash:hash(token),baseHash:base===null?null:hash(base),expiresAt:Date.now()+15*60_000,
    workspace:current.workspace,store:getStoreDir(),data:getDataDir(),database});
  return Object.freeze({proposal_id:proposalId,generation:current.generationId,token});
}

/** One-use model-output sink bound to a prepared owner generation. */
export function stageFamilyDreamProposal(database:Database,capability:FamilyDreamProposalCapability,text:string,options:{run_request_id?:string;beforePublish?:()=>void}={}){
  if(!capability||Object.keys(capability).length!==3||!/^[a-f0-9-]{36}$/.test(capability.proposal_id)||!safeId(capability.generation)||typeof capability.token!=='string')throw new ChatAccessDenied();
  pruneProposalGrants();const grant=proposalGrants.get(capability.proposal_id);if(!grant||grant.generation!==capability.generation)throw new ChatAccessDenied();
  const actual=Buffer.from(hash(capability.token),'hex'),expected=Buffer.from(grant.tokenHash,'hex');if(actual.length!==expected.length||!timingSafeEqual(actual,expected))throw new ChatAccessDenied();
  if(typeof text!=='string'||!text.trim()||text.includes('\0')||!wellFormed(text)||Buffer.byteLength(text)>64*1024)throw new ChatAccessDenied();
  const workspace=getWorkspaceDir(),root=ownerRoot(workspace,grant.owner);
  const validate=()=>{if(database!==grant.database||database!==getDb()||workspace!==grant.workspace||getStoreDir()!==grant.store||getDataDir()!==grant.data||getWorkspaceDir()!==grant.workspace||readAccessConfig().mode!=='family-shared')throw new ChatAccessDenied();};validate();
  const lockPath=resolve(root,'.lock'),lockToken=randomUUID();let lockFd:number|undefined;
  const validateCurrent=()=>{validate();const current=parseObject(resolve(root,'current.json'),['version','generation','owner_user_id','manifest_sha256','generated_at']);if(current.owner_user_id!==grant.owner||current.generation!==grant.generation)throw new ChatAccessDenied();};
  try{lockFd=openSync(lockPath,'wx',0o600);writeFileSync(lockFd,JSON.stringify({pid:process.pid,token:lockToken,owner_user_id:grant.owner}));validateCurrent();
  const proposals=resolve(root,'proposals'),proposalRoot=resolve(proposals,capability.proposal_id),stageRoot=resolve(proposals,`.stage-${capability.proposal_id}-${randomUUID()}`);if(existsSync(proposalRoot))throw new ChatAccessDenied();ensureDirectory(stageRoot);
  try{atomic(resolve(stageRoot,'proposal.md'),text,validate);
    if(options.run_request_id!==undefined&&!safeId(options.run_request_id))throw new ChatAccessDenied();
    const record={version:1,proposal_id:capability.proposal_id,owner_user_id:grant.owner,generation:grant.generation,base_hash:grant.baseHash,proposal_hash:hash(text),run_request_id:options.run_request_id??null,created_at:new Date().toISOString()};
    atomic(resolve(stageRoot,'proposal.json'),`${JSON.stringify(record,null,2)}\n`,validateCurrent);validateCurrent();options.beforePublish?.();validateCurrent();renameSync(stageRoot,proposalRoot);proposalGrants.delete(capability.proposal_id);return {proposal_id:capability.proposal_id,owner_user_id:grant.owner,generation:grant.generation,created:true};
  }catch(error){rmSync(stageRoot,{recursive:true,force:true});throw error;}
  }finally{
    if(lockFd!==undefined)try{closeSync(lockFd);}catch(error){debugSuppressedError(log,'failed to close family Dream proposal lock',error,{ownerUserId:grant.owner});}
    try{if(existsSync(lockPath)){const lock=JSON.parse(readFileSync(lockPath,'utf8'));if(lock.token===lockToken&&lock.owner_user_id===grant.owner)rmSync(lockPath,{force:true});}}
    catch(error){debugSuppressedError(log,'failed to release family Dream proposal lock',error,{ownerUserId:grant.owner});}
  }
}

/** Explicit recent-owner promotion with base/output hash recovery after a commit-response gap. */
export function promoteOwnFamilyDreamProposal(database:Database,principal:AuthenticatedPrincipal,proposalId:string,input:{confirm:true}){
  if(!/^[a-f0-9-]{36}$/.test(proposalId)||!input||Object.keys(input).length!==1||input.confirm!==true)throw new ChatAccessDenied();const current=currentGeneration(database,principal),proposalRoot=resolve(current.root,'proposals',proposalId);
  const lockPath=resolve(current.root,'.lock'),lockToken=randomUUID();let lockFd:number|undefined;
  try{lockFd=openSync(lockPath,'wx',0o600);writeFileSync(lockFd,JSON.stringify({pid:process.pid,token:lockToken,owner_user_id:current.actor.id}));
  const record=parseObject(resolve(proposalRoot,'proposal.json'),['version','proposal_id','owner_user_id','generation','base_hash','proposal_hash','run_request_id','created_at']);const text=readText(resolve(proposalRoot,'proposal.md'),64*1024);
  if(text===null||record.version!==1||record.proposal_id!==proposalId||record.owner_user_id!==current.actor.id||record.generation!==current.generationId||record.proposal_hash!==hash(text)
    ||!(record.base_hash===null||typeof record.base_hash==='string'&&/^[a-f0-9]{64}$/.test(record.base_hash as string))||!(record.run_request_id===null||typeof record.run_request_id==='string'&&safeId(record.run_request_id)))throw new ChatAccessDenied();
  if(record.run_request_id!==null){const request=record.run_request_id as string,runRoot=resolve(current.root,'runs',request),start=parseObject(resolve(runRoot,'start.json'),['version','request_id','owner_user_id','generation','proposal_id','source_hash','started_at','recover_after']),run=parseObject(resolve(runRoot,'complete.json'),['version','request_id','owner_user_id','generation','proposal_id','source_hash','completed_at']);
    if(start.version!==1||start.request_id!==request||start.owner_user_id!==current.actor.id||start.generation!==current.generationId||start.proposal_id!==proposalId||typeof start.source_hash!=='string'||!/^[a-f0-9]{64}$/.test(start.source_hash as string)
      ||typeof start.started_at!=='string'||!Number.isFinite(Date.parse(start.started_at as string))||new Date(start.started_at as string).toISOString()!==start.started_at
      ||typeof start.recover_after!=='string'||!Number.isFinite(Date.parse(start.recover_after as string))||new Date(start.recover_after as string).toISOString()!==start.recover_after
      ||run.version!==1||run.request_id!==request||run.owner_user_id!==current.actor.id||run.generation!==start.generation||run.proposal_id!==start.proposal_id||run.source_hash!==start.source_hash||typeof run.completed_at!=='string'||!Number.isFinite(Date.parse(run.completed_at as string))||new Date(run.completed_at as string).toISOString()!==run.completed_at)throw new ChatAccessDenied();}
  const promotionPath=resolve(proposalRoot,'promotion.json'),target=resolve(current.workspace,'notes','users',current.actor.id,'MEMORY.md'),existing=readText(target,256*1024),existingHash=existing===null?null:hash(existing),proposalHash=record.proposal_hash as string;
  if(existsSync(promotionPath)){const receipt=parseObject(promotionPath,['version','proposal_id','owner_user_id','generation','base_hash','proposal_hash','promoted_at']);if(receipt.proposal_hash!==proposalHash||receipt.base_hash!==record.base_hash||existingHash!==proposalHash)throw new ChatAccessDenied();return {proposal_id:proposalId,promoted:true,created:false,memory_path:target};}
  if(existingHash!==record.base_hash&&existingHash!==proposalHash)throw new ChatAccessDenied();
  if(existingHash!==proposalHash)atomic(target,text,()=>{const live=currentGeneration(database,principal),latest=readText(target,256*1024),latestHash=latest===null?null:hash(latest);if(live.generationId!==current.generationId||latestHash!==record.base_hash)throw new ChatAccessDenied();});
  const receipt={version:1,proposal_id:proposalId,owner_user_id:current.actor.id,generation:current.generationId,base_hash:record.base_hash,proposal_hash:proposalHash,promoted_at:new Date().toISOString()};
  atomic(promotionPath,`${JSON.stringify(receipt,null,2)}\n`,()=>{authority(database,principal);const latest=readText(target,256*1024),live=currentGeneration(database,principal);if(live.generationId!==current.generationId||latest===null||hash(latest)!==proposalHash)throw new ChatAccessDenied();});return {proposal_id:proposalId,promoted:true,created:true,memory_path:target};
  }finally{
    if(lockFd!==undefined)try{closeSync(lockFd);}catch(error){debugSuppressedError(log,'failed to close family Dream promotion lock',error,{ownerUserId:current.actor.id});}
    try{if(existsSync(lockPath)){const lock=JSON.parse(readFileSync(lockPath,'utf8'));if(lock.token===lockToken&&lock.owner_user_id===current.actor.id)rmSync(lockPath,{force:true});}}
    catch(error){debugSuppressedError(log,'failed to release family Dream promotion lock',error,{ownerUserId:current.actor.id});}
  }
}

/**
 * Materialise one owner-only Dream source generation. This does not invoke a model,
 * schedule Dream, update legacy notes, or publish family memory.
 */
export function prepareOwnFamilyDreamSnapshot(database:Database,principal:AuthenticatedPrincipal,options:{days?:number}={}):FamilyDreamSnapshot {
  const actor=Object.freeze({...principal,authentication:Object.freeze({...principal.authentication})});
  const mode=readAccessConfig().mode,workspace=getWorkspaceDir(),store=getStoreDir(),data=getDataDir();let denied=false;
  const validate=()=>{
    try{
      if(denied||mode!=='family-shared'||readAccessConfig().mode!==mode||getWorkspaceDir()!==workspace||getStoreDir()!==store||getDataDir()!==data
        ||database!==getDb()||getExecutionIdentity()||!safeId(actor.userId))throw new ChatAccessDenied();
      const live=requireAccountActor(database,actor,{recent:true});if(live.id!==actor.userId||live.role!==actor.role||live.home_chat_jid!==actor.homeChatJid)throw new ChatAccessDenied();
    }catch(error){denied=true;throw error;}
  };
  const requestedDays=options.days??7;if(!Number.isSafeInteger(requestedDays)||requestedDays<1||requestedDays>MAX_DAYS)throw new ChatAccessDenied();const days=requestedDays;
  validate();
  const root=resolve(workspace,'notes','users',actor.userId,'dream');
  if(!root.startsWith(resolve(workspace,'notes','users')+sep))throw new ChatAccessDenied();
  ensureDirectory(root);const lockPath=resolve(root,'.lock'),token=randomUUID();let fd:number|undefined;
  try{
    fd=openSync(lockPath,'wx',0o600);writeFileSync(fd,JSON.stringify({pid:process.pid,token,owner_user_id:actor.userId}));validate();
    const cutoff=new Date(Date.now()-days*86400000).toISOString();
    const rows=database.transaction(()=>{
      validate();const result=database.query(`SELECT m.rowid,m.id message_id,m.chat_jid,b.root_chat_jid,m.content,m.timestamp,m.sender_name,COALESCE(m.is_bot_message,0) is_bot_message
        FROM messages m JOIN chat_branches b ON b.chat_jid=m.chat_jid JOIN chat_branches r ON r.chat_jid=b.root_chat_jid AND r.parent_branch_id IS NULL
        JOIN session_roots o ON o.root_branch_id=r.branch_id WHERE o.owner_user_id=? AND m.chat_jid NOT LIKE 'dream:%' AND r.chat_jid NOT LIKE 'dream:%' AND m.timestamp>=?
        ORDER BY m.timestamp,m.rowid LIMIT ?`).all(actor.userId,cutoff,MAX_MESSAGES+1) as Row[];validate();return result;
    })();
    if(rows.length>MAX_MESSAGES)throw new ChatAccessDenied();let total=0;const byDay=new Map<string,Row[]>(),trees=new Set<string>();
    for(const row of rows){validate();if(!Number.isSafeInteger(row.rowid)||row.rowid<=0||!safeId(row.message_id)||!row.chat_jid||!row.root_chat_jid
        ||typeof row.content!=='string'||row.content.includes('\0')||!wellFormed(row.content)||Buffer.byteLength(row.content)>MAX_MESSAGE_BYTES
        ||typeof row.sender_name!=='string'||row.sender_name.includes('\0')||!wellFormed(row.sender_name)||Buffer.byteLength(row.sender_name)>512
        ||Buffer.byteLength(row.chat_jid)>512||Buffer.byteLength(row.root_chat_jid)>512||![0,1].includes(row.is_bot_message))throw new ChatAccessDenied();
      const emitted=`- ${row.timestamp} · ${row.is_bot_message?'assistant':'user'} · ${json(row.sender_name)} · ${json(row.chat_jid)} · row ${row.rowid} · message ${json(row.message_id)}\n  - ${json(row.content)}`;
      total+=Buffer.byteLength(emitted)+1;if(total>MAX_TOTAL_BYTES)throw new ChatAccessDenied();const key=day(row.timestamp);trees.add(row.root_chat_jid);const list=byDay.get(key)??[];list.push(row);byDay.set(key,list);
    }
    const generatedAt=new Date().toISOString(),generation=`${generatedAt.replace(/[:.]/g,'-')}-${randomUUID()}`;
    const stage=resolve(root,`.stage-${generation}`),final=resolve(root,'generations',generation);ensureDirectory(stage);
    try{
      const dates=[...byDay.keys()].sort();for(const date of dates){validate();const items=byDay.get(date)!;
        const lines=['---',`date: ${date}`,`owner_user_id: ${actor.userId}`,'scope_mode: owner-session-trees',`messages_total: ${items.length}`,`first_message: ${items[0]!.timestamp}`,`last_message: ${items.at(-1)!.timestamp}`,'---','',`# ${date}`,'','## Transcript evidence',''];
        for(const row of items)lines.push(`- ${row.timestamp} · ${row.is_bot_message?'assistant':'user'} · ${json(row.sender_name)} · ${json(row.chat_jid)} · row ${row.rowid} · message ${json(row.message_id)}`,`  - ${json(row.content)}`);
        atomic(resolve(stage,'daily',`${date}.md`),`${lines.join('\n')}\n`,validate);
      }
      const index=['# Owner Dream source index','',`Owner ID: ${json(actor.userId)}`,`Generated: ${generatedAt}`,'','This generation contains only transcript rows from session roots owned by this immutable account ID. It is source material awaiting explicit consolidation.','',...dates.map(date=>`- [${date}](daily/${date}.md)`)];
      atomic(resolve(stage,'MEMORY.md'),`${index.join('\n')}\n`,validate);
      const manifest={version:1,generation,owner_user_id:actor.userId,generated_at:generatedAt,days,source_scope:'owner-session-trees',message_count:rows.length,tree_count:trees.size,total_evidence_bytes:total,dates};
      const manifestText=`${JSON.stringify(manifest,null,2)}\n`;atomic(resolve(stage,'manifest.json'),manifestText,validate);validate();ensureDirectory(dirname(final));renameSync(stage,final);validate();
      const pointer={version:1,generation,owner_user_id:actor.userId,manifest_sha256:hash(manifestText),generated_at:generatedAt};
      atomic(resolve(root,'current.json'),`${JSON.stringify(pointer,null,2)}\n`,validate);
      return {owner_user_id:actor.userId,generation,root:final,current_path:resolve(root,'current.json'),message_count:rows.length,tree_count:trees.size,days:dates};
    }catch(error){rmSync(stage,{recursive:true,force:true});throw error;}
  } finally {
    if(fd!==undefined)try{closeSync(fd);}catch(error){debugSuppressedError(log,'failed to close family Dream owner lock',error,{ownerUserId:actor.userId});}
    try{if(existsSync(lockPath)){const value=JSON.parse(readFileSync(lockPath,'utf8'));if(value.token===token&&value.owner_user_id===actor.userId)rmSync(lockPath,{force:true});}}
    catch(error){debugSuppressedError(log,'failed to release family Dream owner lock',error,{ownerUserId:actor.userId});}
  }
}
