import { expect, test } from "bun:test";
import { Database } from "bun:sqlite";
import { createNativeTurnView } from "../../../src/channels/web/agent/native-turn-view.js";
import { readNativeDelegateProgress } from "../../../src/agent-pool/delegate-progress.js";
const progress = (id: number, phase = "generating") => ({ kind: "native_delegate_progress", conversationId: id,
  model: "qualification/synthetic", phase, tools: [], responseChars: id, elapsedSeconds: 2 });
function fixture() {
  const db = new Database(":memory:");
  db.exec(`CREATE TABLE piclaw_durable_bindings_v1(operation_id,source_seq,source_id,chat_jid,conversation_id,submission_id);
    CREATE TABLE piclaw_durable_intent_bindings_v1(operation_id,chat_jid,conversation_id,submission_id);
      CREATE TABLE service_effect_s01_operations(operation_id,primary_source_seq); CREATE TABLE messages(id,chat_jid,thread_id);
    INSERT INTO service_effect_s01_operations VALUES('op',1); INSERT INTO messages VALUES('input','chat',NULL);
    INSERT INTO piclaw_durable_bindings_v1 VALUES('op',1,'input','chat',2,3);`);
  const events: any[] = [], entries: any[] = [{ kind: 'host.accepted', data: { operationId: 'op' } },
    { kind: 'pi.assistant', model: [{ role: 'assistant', content: ['A','B'].map(id => ({ type: 'toolCall', id, name: 'delegate', arguments: { prompt: 'PRIVATE_PROMPT' } })) }] }];
  const render = createNativeTurnView(db, { broadcastEvent(event, data) { events.push({event,data}); } }, 'chat');
  const frame = (tools: any[], taskId = 4) => render({ conversation: { id: 2 }, entries, docs: { 'pi.live': { run: { taskId, inputs: [3] }, tools } } });
  return { db, events, entries, frame, last: () => events.filter(e => e.event === 'agent_status').at(-1)?.data };
}
test('parallel native delegates retain separate progress, stable labels, real output and completed siblings', () => {
  const f = fixture();
  try {
    const a = { callId: 'A', name: 'delegate', status: 'running', details: progress(10) };
    const b = { callId: 'B', name: 'delegate', status: 'running', details: progress(11,'tool') };
    f.frame([b,a]);
    expect(f.last().delegate_progress.map((p: any) => p.tool_call_id)).toEqual(['A','B']);
    expect(f.last().output_preview).toContain('Delegate 1/2'); expect(f.last().output_preview).toContain('Delegate 2/2');
    expect(f.last().active_tool_count).toBe(2);
    expect(f.last().output_preview).not.toContain('PRIVATE');
    expect(f.events.some(e => e.event === 'agent_draft')).toBe(false);
    const n = f.events.length; f.frame([b,a]); expect(f.events).toHaveLength(n);
    f.entries.push({ kind: 'pi.tool-result', model: [{ role: 'toolResult', toolCallId: 'A', toolName: 'delegate', details: progress(10,'done'), content: [{type:'text',text:'ACTUAL_CHILD_ANSWER'}] }] });
    f.frame([{...b,details:{...progress(11),responseChars:32}}]);
    expect(f.last().delegate_progress).toMatchObject([{tool_call_id:'A',phase:'done'},{tool_call_id:'B',phase:'generating',responseChars:32}]);
    expect(f.last().output_preview).toContain('Completed'); expect(f.last().active_tool_count).toBe(1);
    expect(f.events.some(e => e.data.output_preview?.includes('ACTUAL_CHILD_ANSWER'))).toBe(true);
    f.frame([],5);
    expect(f.last().delegate_progress).toHaveLength(1); // Only committed A is reconstructed; B cache is cleared.
  } finally { f.db.close(); }
});
test('coalesced result details reconstruct per-child completion and failure without a live slot', () => {
  const f = fixture();
  try {
    for (const [id,n] of [['A',10],['B',11]] as const) f.entries.push({kind:'pi.tool-result',model:[{role:'toolResult',toolCallId:id,toolName:'delegate',isError:id==='B',details:progress(n),content:[{type:'text',text:id==='A'?'answer':'failed'}]}]});
    f.frame([]);
    expect(f.last().delegate_progress).toMatchObject([{tool_call_id:'A',phase:'done'},{tool_call_id:'B',phase:'failed'}]);
    expect(f.last().output_preview).toContain('Delegate 2/2'); expect(f.last().output_preview).toContain('Failed');
    expect(f.last().active_tool_count).toBe(0);
  } finally { f.db.close(); }
});
test('native progress rejects malformed/private/unbounded values and projects only whitelisted fields', () => {
  const valid = progress(1);
  expect(readNativeDelegateProgress({...valid,secret:'PRIVATE_TEXT'})).toEqual(valid);
  for (const bad of [null,{}, {...valid,conversationId:0},{...valid,model:'private model text'}, {...valid,tools:['unapproved']},
    {...valid,elapsedSeconds:-1},{...valid,responseChars:1.2},{...valid,phase:'private'},{...valid,responseChars:1e10}, {...valid,tools:Array(9).fill('read')}]) expect(readNativeDelegateProgress(bad)).toBeNull();
});
