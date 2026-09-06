import type Database from 'bun:sqlite';
import { constants, closeSync, fstatSync, lstatSync, openSync, readFileSync, realpathSync } from 'node:fs';
import { dirname, isAbsolute, join, resolve } from 'node:path';
import { createHash } from 'node:crypto';
import { inspectAdoptedSession, MAX_ADOPTED_SESSION_BYTES, type AdoptedSessionSeed } from '../agent-pool/adopted-session.js';

export interface ChildAdoptionInput { chat_jid:string; file:string; sha256:string }
export interface ChildAdoptionSnapshot { chatJid:string; parentBranchId:string; seed:AdoptedSessionSeed; sessionId:string; entryCount:number }
const safeJid=(jid:string)=>jid.replace(/[^a-zA-Z0-9._-]/g,'_');

/** Files are explicit, bounded, hashed and physically in the expected child directory. Never mutate sources. */
export function captureChildAdoptions(database:Database,input:unknown,workspace:string,sessionsDir:string):ChildAdoptionSnapshot[] {
  if(!Array.isArray(input)||input.length>100) throw new Error('Adopt at most 100 explicit children per copy.');
  const branches=database.query('SELECT branch_id,chat_jid,parent_branch_id,root_chat_jid FROM chat_branches').all() as {branch_id:string;chat_jid:string;parent_branch_id:string|null;root_chat_jid:string}[];
  const seen=new Set<string>();let total=0;
  return input.map(item=>{
    if(!item||typeof item!=='object'||Object.keys(item).length!==3||Object.keys(item).some(key=>!['chat_jid','file','sha256'].includes(key))
      ||typeof item.chat_jid!=='string'||typeof item.file!=='string'||!isAbsolute(item.file)||typeof item.sha256!=='string'||seen.has(item.chat_jid)) throw new Error('Invalid or duplicate child adoption.');
    seen.add(item.chat_jid);
    const child=branches.find(row=>row.chat_jid===item.chat_jid),parent=branches.find(row=>row.branch_id===child?.parent_branch_id);
    if(!child?.parent_branch_id||!parent||parent.root_chat_jid!==child.root_chat_jid) throw new Error('Adoption requires a registered child and matching parent.');
    if(database.query('SELECT 1 FROM owned_fork_operations WHERE target_branch_id=?').get(child.branch_id)) throw new Error('Child already has fork provenance.');
    if(branches.filter(row=>safeJid(row.chat_jid)===safeJid(child.chat_jid)).length!==1) throw new Error('Ambiguous legacy session directory.');
    const expected=resolve(sessionsDir,safeJid(child.chat_jid)),path=resolve(item.file);
    if(dirname(path)!==expected||!path.endsWith('.jsonl')||realpathSync(expected)!==expected) throw new Error('Session file is outside the expected child directory.');
    for(const name of ['.branch-seed.json','.branch-seed.claimed.json']) {
      try {lstatSync(join(expected,name));} catch(error) {if((error as NodeJS.ErrnoException).code==='ENOENT') continue;throw error;}
      throw new Error('Pending legacy file seed must be resolved before adoption.');
    }
    const fd=openSync(path,constants.O_RDONLY|constants.O_NOFOLLOW|constants.O_NONBLOCK);
    let jsonl:string;
    try {const stat=fstatSync(fd);if(!stat.isFile()||stat.size>MAX_ADOPTED_SESSION_BYTES||(total+=stat.size)>32*1024*1024) throw new Error('Session adoption exceeds file/batch bounds.');jsonl=readFileSync(fd,'utf8');}finally{closeSync(fd);}
    const parsed=inspectAdoptedSession(jsonl,item.sha256);
    if(realpathSync(parsed.header.cwd)!==realpathSync(workspace)) throw new Error('Session workspace does not match the migration source.');
    const parentPath=resolve(parsed.header.parentSession),parentDir=resolve(sessionsDir,safeJid(parent.chat_jid));
    if(dirname(parentPath)!==parentDir||realpathSync(parentDir)!==parentDir||!parentPath.endsWith('.jsonl')||!lstatSync(parentPath).isFile()) throw new Error('Session header parent does not match the registered parent directory.');
    return {chatJid:child.chat_jid,parentBranchId:parent.branch_id,sessionId:parsed.sessionId,entryCount:parsed.entryCount,seed:{version:1,mode:'adopted_jsonl',sha256:item.sha256,jsonl}};
  });
}

/** Called inside preparation transaction after ownership/namespace validation, never at startup. */
export function commitChildAdoptions(database:Database,snapshots:ChildAdoptionSnapshot[]):void {
  for(const snapshot of snapshots) {
    const child=database.query('SELECT branch_id,parent_branch_id,handle_owner_id FROM chat_branches WHERE chat_jid=?').get(snapshot.chatJid) as {branch_id:string;parent_branch_id:string;handle_owner_id:string}|null;
    if(!child?.handle_owner_id||child.parent_branch_id!==snapshot.parentBranchId) throw new Error('Child topology changed during adoption.');
    inspectAdoptedSession(snapshot.seed.jsonl,snapshot.seed.sha256);
    const requestId='adopt-'+createHash('sha256').update(child.branch_id+'\0'+snapshot.seed.sha256).digest('hex');
    database.query('INSERT INTO owned_fork_operations(owner_user_id,request_id,source_branch_id,target_branch_id,seed_json,created_at) VALUES (?,?,?,?,?,?)')
      .run(child.handle_owner_id,requestId,snapshot.parentBranchId,child.branch_id,JSON.stringify(snapshot.seed),new Date().toISOString());
  }
}
