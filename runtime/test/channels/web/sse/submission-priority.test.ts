import { expect, test } from 'bun:test';
import { Database } from 'bun:sqlite';
import { SseHub } from '../../../../src/channels/web/sse/sse-hub.js';
import { createNativeTurnView } from '../../../../src/channels/web/agent/native-turn-view.js';

test('accepted inputs and new native working feedback publish synchronously without a legacy display scheduler', () => {
  const database = new Database(':memory:');
  const hub = new SseHub();
  const frames: string[] = [];
  const heartbeat = setInterval(() => {}, 60_000);
  hub.clients.add({
    chatJid: 'web:latency', heartbeat,
    controller: { enqueue: (bytes: Uint8Array) => frames.push(new TextDecoder().decode(bytes)), close() {} } as any,
  });
  try {
    database.exec(`CREATE TABLE piclaw_durable_bindings_v1(operation_id,source_seq,source_id,chat_jid,conversation_id,submission_id);
      CREATE TABLE piclaw_durable_intent_bindings_v1(operation_id,chat_jid,conversation_id,submission_id);
      CREATE TABLE service_effect_s01_operations(operation_id,primary_source_seq);
      CREATE TABLE messages(id,chat_jid,thread_id);
      INSERT INTO service_effect_s01_operations VALUES('old',1),('next',2);
      INSERT INTO messages(rowid,id,chat_jid,thread_id) VALUES(1,'old-input','web:latency',NULL),(42,'next-input','web:latency',NULL);
      INSERT INTO piclaw_durable_bindings_v1 VALUES('old',1,'old-input','web:latency',2,3),('next',2,'next-input','web:latency',2,4);`);
    const render = createNativeTurnView(database, { broadcastEvent: (type, data) => hub.broadcast(type, data) }, 'web:latency');
    render({ conversation: { id: 2 }, entries: [], docs: { 'pi.live': {
      run: { taskId: 1, inputs: [3] }, generation: { message: { content: [{ type: 'text', text: 'prior display text' }] } },
    } } });
    const before = frames.length;
    hub.broadcast('new_post', { chat_jid: 'web:latency', id: 42, data: { content: 'accepted input' } });
    render({ conversation: { id: 2 }, entries: [], docs: { 'pi.live': { run: { taskId: 2, inputs: [4] } } } });
    expect(frames.slice(before).map(frame => frame.split('\n')[0])).toEqual(['event: new_post', 'event: agent_status']);
    expect(frames.slice(before).join('\n')).not.toContain('prior display text');
    expect(frames.at(-1)).toContain('Thinking...');
    expect(frames.at(-1)).toContain('durable:42');
  } finally {
    hub.closeAll();
    database.close();
  }
});
