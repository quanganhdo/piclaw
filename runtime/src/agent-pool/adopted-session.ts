import { createHash } from 'node:crypto';
import { buildSessionContext, type SessionEntry } from '@earendil-works/pi-coding-agent';

export const MAX_ADOPTED_SESSION_BYTES = 8 * 1024 * 1024;
export interface AdoptedSessionSeed { version:1; mode:'adopted_jsonl'; sha256:string; jsonl:string }

/** Strict complete v3 trees only. No SDK file loading/migration or silent repair. */
export function inspectAdoptedSession(jsonl: string, expectedHash: string) {
  if (typeof jsonl !== 'string' || Buffer.byteLength(jsonl) > MAX_ADOPTED_SESSION_BYTES || !/^[0-9a-f]{64}$/.test(expectedHash)
    || createHash('sha256').update(jsonl).digest('hex') !== expectedHash) throw new Error('Session snapshot hash or size mismatch.');
  const lines=jsonl.trimEnd().split('\n');
  if(lines.length<2||lines.length>25001) throw new Error('Session must contain a bounded complete entry tree.');
  const header=JSON.parse(lines[0]!);
  if(header?.type!=='session'||header.version!==3||typeof header.id!=='string'||!header.id||typeof header.cwd!=='string'||!header.cwd
    ||typeof header.parentSession!=='string'||!header.parentSession||!Number.isFinite(Date.parse(header.timestamp))) throw new Error('Adoption requires a v3 child-session header.');
  const entries:SessionEntry[]=[],byId=new Map<string,any>();
  const types=['message','model_change','thinking_level_change','compaction','branch_summary','custom','custom_message','label','session_info'];
  for(const line of lines.slice(1)) {
    const entry=JSON.parse(line);
    if(!entry||!types.includes(entry.type)||typeof entry.id!=='string'||!entry.id||byId.has(entry.id)||!Number.isFinite(Date.parse(entry.timestamp))
      ||(entry.parentId!==null&&(!byId.has(entry.parentId)||typeof entry.parentId!=='string'))) throw new Error('Invalid, duplicate or orphan session entry.');
    if(entry.type==='message'&&(!entry.message||!['user','assistant','toolResult','custom','bashExecution'].includes(entry.message.role))) throw new Error('Unsupported session message.');
    if(entry.type==='model_change'&&(typeof entry.provider!=='string'||!entry.provider||typeof entry.modelId!=='string'||!entry.modelId)) throw new Error('Invalid stored model.');
    if(entry.type==='thinking_level_change'&&!['off','minimal','low','medium','high','xhigh','max'].includes(entry.thinkingLevel)) throw new Error('Invalid stored thinking level.');
    if(entry.type==='compaction'&&(typeof entry.summary!=='string'||(!Array.isArray(entry.retainedTail)&&!byId.has(entry.firstKeptEntryId)))) throw new Error('Incomplete compaction tree.');
    if(entry.type==='branch_summary'&&(typeof entry.summary!=='string'||!byId.has(entry.fromId))) throw new Error('Incomplete branch summary.');
    if(entry.type==='label'&&!byId.has(entry.targetId)) throw new Error('Invalid label target.');
    byId.set(entry.id,entry);entries.push(entry);
  }
  const context=buildSessionContext(entries);
  if(!context.messages.length||!context.model) throw new Error('Session has no usable persisted conversation/model.');
  const pending=new Set<string>();
  for(const message of context.messages) {
    if(message.role==='assistant') {
      if(!['stop','length','toolUse'].includes(message.stopReason)||!(Array.isArray(message.content))) throw new Error('Incomplete assistant turn.');
      for(const part of message.content) if(part.type==='toolCall') {if(pending.has(part.id)) throw new Error('Duplicate pending tool call.');pending.add(part.id);}
    } else if(message.role==='toolResult') {
      if(!pending.delete(message.toolCallId)) throw new Error('Unmatched tool result.');
    } else if(message.role==='user'&&pending.size) throw new Error('Unfinished tool turn.');
  }
  const last=context.messages.at(-1);
  if(pending.size||last?.role!=='assistant'||!['stop','length'].includes(last.stopReason)) throw new Error('Adoption requires a completed assistant boundary.');
  return {header,entries,context,entryCount:entries.length,sessionId:header.id as string};
}
