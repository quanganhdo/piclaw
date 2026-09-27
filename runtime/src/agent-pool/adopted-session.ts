import { createHash } from 'node:crypto';
import { buildContextEntries, buildSessionContext, sessionEntryToContextMessages, type SessionEntry } from '@earendil-works/pi-coding-agent';

export const MAX_ADOPTED_SESSION_BYTES = 8 * 1024 * 1024;
export interface AdoptedSessionSeed { version:1; mode:'adopted_jsonl'; sha256:string; jsonl:string }

function validContent(content: unknown): boolean {
  return typeof content === 'string' || (Array.isArray(content) && content.every((part) => {
    if (!part || typeof part !== 'object') return false;
    if (part.type === 'text') return typeof part.text === 'string';
    if (part.type === 'image') return typeof part.data === 'string' && typeof part.mimeType === 'string';
    if (part.type === 'thinking') return typeof part.thinking === 'string';
    if (part.type === 'toolCall') return typeof part.id === 'string' && typeof part.name === 'string'
      && part.arguments !== null && typeof part.arguments === 'object' && !Array.isArray(part.arguments);
    return false;
  }));
}

function validUsage(usage: any): boolean {
  const values = ['input','output','cacheRead','cacheWrite','totalTokens'];
  const costs = ['input','output','cacheRead','cacheWrite','total'];
  return usage && values.every((key) => Number.isFinite(usage[key]) && usage[key] >= 0)
    && usage.cost && costs.every((key) => Number.isFinite(usage.cost[key]) && usage.cost[key] >= 0);
}

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
  const types=['message','model_change','thinking_level_change','usage','compaction','branch_summary','custom','custom_message','context_edit','label','session_info'];
  for(const line of lines.slice(1)) {
    const entry=JSON.parse(line);
    if(!entry||!types.includes(entry.type)||typeof entry.id!=='string'||!entry.id||byId.has(entry.id)||!Number.isFinite(Date.parse(entry.timestamp))
      ||(entry.parentId!==null&&(!byId.has(entry.parentId)||typeof entry.parentId!=='string'))) throw new Error('Invalid, duplicate or orphan session entry.');
    if(entry.type==='message'&&(!entry.message||!['user','assistant','toolResult','custom','bashExecution'].includes(entry.message.role))) throw new Error('Unsupported session message.');
    if(entry.type==='message'&&entry.message.role==='assistant') {
      const assistant=entry.message;
      if(!['stop','length','toolUse'].includes(assistant.stopReason)||!Array.isArray(assistant.content)) throw new Error('Incomplete assistant turn.');
      const hasToolCall=assistant.content.some((part: {type?:string})=>part?.type==='toolCall');
      if((assistant.stopReason==='toolUse')!==hasToolCall) throw new Error('Assistant tool stop reason does not match tool calls.');
    }
    if(entry.type==='model_change'&&(typeof entry.provider!=='string'||!entry.provider||typeof entry.modelId!=='string'||!entry.modelId)) throw new Error('Invalid stored model.');
    if(entry.type==='thinking_level_change'&&!['off','minimal','low','medium','high','xhigh','max'].includes(entry.thinkingLevel)) throw new Error('Invalid stored thinking level.');
    if(entry.type==='usage'&&(typeof entry.kind!=='string'||!entry.kind||typeof entry.provider!=='string'||!entry.provider
      ||typeof entry.model!=='string'||!entry.model||!validUsage(entry.usage)
      ||(entry.note!==undefined&&typeof entry.note!=='string'))) throw new Error('Invalid usage entry.');
    if(entry.type==='compaction'&&(typeof entry.summary!=='string'||(entry.firstKeptEntryId!==null
      && !Array.isArray(entry.retainedTail) && !byId.has(entry.firstKeptEntryId)))) throw new Error('Incomplete compaction tree.');
    if(entry.type==='context_edit') {
      const target=byId.get(entry.targetId);
      if(!target||!(target.type==='custom_message'||(target.type==='message'&&['user','assistant','toolResult'].includes(target.message?.role)))
        || !(entry.replacement===null||(entry.replacement&&typeof entry.replacement==='object'
          && Object.keys(entry.replacement).length===1 && validContent(entry.replacement.content)))) throw new Error('Invalid context edit.');
      let ancestor=entry.parentId;
      while(ancestor!==null&&ancestor!==entry.targetId) ancestor=byId.get(ancestor)?.parentId??null;
      if(ancestor!==entry.targetId) throw new Error('Context edit target is not on this branch.');
    }
    if(entry.type==='branch_summary'&&(typeof entry.summary!=='string'||!byId.has(entry.fromId))) throw new Error('Incomplete branch summary.');
    if(entry.type==='label'&&!byId.has(entry.targetId)) throw new Error('Invalid label target.');
    byId.set(entry.id,entry);entries.push(entry);
  }
  // Validate the projected context independently of the installed manager's
  // version, including context edits and the completed assistant boundary.
  const edits=new Map<string, any>();
  const selected=buildContextEntries(entries);
  for(const entry of selected) {
    const candidate=entry as {type:string;targetId?:string};
    if(candidate.type==='context_edit'&&candidate.targetId) edits.set(candidate.targetId,entry);
  }
  const context={...buildSessionContext(entries),messages:selected.flatMap((entry, index) => {
    // The newest compaction checkpoint is the only one that contributes a summary.
    if(entry.type==='compaction'&&index>0) return [];
    const messages=sessionEntryToContextMessages(entry);
    const edit=edits.get(entry.id);
    if(!edit) return messages;
    if(edit.replacement===null) return [];
    return messages.map((message) => {
      const replacement=edit.replacement.content;
      const content=(message.role==='assistant'||message.role==='toolResult')&&typeof replacement==='string'
        ? [{type:'text',text:replacement}] : replacement;
      return {...message,content};
    });
  })};
  if(!context.messages.length||!context.model) throw new Error('Session has no usable persisted conversation/model.');
  const pending=new Set<string>();
  for(const message of context.messages) {
    if(message.role==='assistant') {
      if(!['stop','length','toolUse'].includes(message.stopReason)||!(Array.isArray(message.content))) throw new Error('Incomplete assistant turn.');
      const calls=message.content.filter((part): part is Extract<typeof part,{type:'toolCall'}>=>part?.type==='toolCall');
      for(const part of calls) {if(pending.has(part.id)) throw new Error('Duplicate pending tool call.');pending.add(part.id);}
    } else if(message.role==='toolResult') {
      if(!pending.delete(message.toolCallId)) throw new Error('Unmatched tool result.');
    } else if(message.role==='user'&&pending.size) throw new Error('Unfinished tool turn.');
  }
  const last=context.messages.at(-1);
  if(pending.size||last?.role!=='assistant'||!['stop','length'].includes(last.stopReason)) throw new Error('Adoption requires a completed assistant boundary.');
  return {header,entries,context,entryCount:entries.length,sessionId:header.id as string};
}
