import { expect, test } from 'bun:test';
import { convertResponsesMessages } from '@earendil-works/pi-ai/api/openai-responses-shared';
import { prepareCompactionSource } from '../../src/extensions/smart-compaction/source';
import { buildSelectiveMethodPrompt } from '../../src/extensions/smart-compaction/selective-method';
import { streamComplete } from '../../src/extensions/smart-compaction/stream-complete';
import { prependRemoteCompactionPayload, REMOTE_COMPACTION_SUMMARY_SENTINEL } from '../../src/extensions/smart-compaction/remote-compaction';
import { adoptedJsonl } from '../agent-pool/adopted-session-fixture';
import { inspectAdoptedSession } from '../../src/agent-pool/adopted-session';
import { buildSessionContext } from '@earendil-works/pi-coding-agent';
import { createHash } from 'node:crypto';
const model = { provider: 'openai', id: 'gpt-5.1', api: 'openai-responses', baseUrl: 'https://api.openai.com/v1', input: ['text'], reasoning: false } as any;

test('review: local compaction keeps source prompt when the user quotes the marker', async () => {
  const text = `Investigate the literal ${REMOTE_COMPACTION_SUMMARY_SENTINEL} in our logs. KEEP_THIS_USER_INSTRUCTION`;
  const messages = [{ role: 'user', content: text, timestamp: 1 }] as any;
  const fileOps = { read: new Set<string>(), written: new Set<string>(), edited: new Set<string>() };
  const source = prepareCompactionSource({ rawMessages: messages, rawSourceEntryIds: ['user'], modelSafeSourceMessages: messages, modelSafeSourceIndexes: [0], previousSummary: 'Native state is supplied separately.', fileOps });
  const prompt = buildSelectiveMethodPrompt({ source, tokensBefore: 100, fileOps, topicShift: null });
  expect(prompt.text).toContain('KEEP_THIS_USER_INSTRUCTION');
  let before: any, after: any;
  const details = { output: [{ type: 'compaction', encrypted_content: 'opaque' }] } as any;
  await streamComplete({ model, systemPrompt: 'Summarize', userPrompt: prompt.text, signal: new AbortController().signal, onPayload: payload => prependRemoteCompactionPayload(payload, details), streamFn: async (_model, context, options) => {
    before = { input: convertResponsesMessages(model, context as any, new Set<string>(), { includeSystemPrompt: false }) };
    after = await options?.onPayload?.(before, model);
    return { result: async () => ({ role:'assistant', content:[{type:'text',text:'summary'}], stopReason:'stop' }) } as any;
  } });
  console.log('REVIEW_LOCAL_PROMPT', JSON.stringify({ beforeItems: before.input.length, afterItems: after.input.length, beforeHasSource: JSON.stringify(before).includes('KEEP_THIS_USER_INSTRUCTION'), afterHasSource: JSON.stringify(after).includes('KEEP_THIS_USER_INSTRUCTION') }));
  expect(JSON.stringify(after)).toContain('KEEP_THIS_USER_INSTRUCTION');
});

test('review: an SDK-valid content edit can remove tool calls without changing stopReason', () => {
  const {rows}=adoptedJsonl('/tmp/adopt', '/tmp/parent');
  const base = rows.slice(0,4);
  const call = { ...rows[4], id:'call', parentId:'user', message:{...rows[4].message,stopReason:'toolUse',content:[{type:'toolCall',id:'tc',name:'read',arguments:{}}]} };
  const result = {type:'message',id:'result',parentId:'call',timestamp:rows[4].timestamp,message:{role:'toolResult',toolCallId:'tc',toolName:'read',content:[{type:'text',text:'result'}],isError:false,timestamp:2}};
  const final = {...rows[4],id:'final',parentId:'result'};
  const entries = [...base,call,result,final,{type:'context_edit',id:'replace',parentId:'final',timestamp:rows[4].timestamp,targetId:'call',replacement:{content:[{type:'text',text:'Tool call summarised'}]}},{type:'context_edit',id:'omit',parentId:'replace',timestamp:rows[4].timestamp,targetId:'result',replacement:null}];
  const sdk=buildSessionContext(entries.slice(1) as any);
  expect(sdk.messages.some(m=>m.role==='assistant' && m.stopReason==='toolUse' && !m.content.some(p=>p.type==='toolCall'))).toBe(true);
  const jsonl=entries.map(r=>JSON.stringify(r)).join('\n')+'\n';
  expect(()=>inspectAdoptedSession(jsonl,createHash('sha256').update(jsonl).digest('hex'))).not.toThrow();
});
