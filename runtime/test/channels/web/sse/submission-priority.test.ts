import { expect, test } from 'bun:test';
import { SseHub } from '../../../../src/channels/web/sse/sse-hub.js';
import { createAgentEventEmitter, createStreamingEventHandler } from '../../../../src/channels/web/sse/agent-events.js';

test('accepted inputs and initial working feedback bypass a pending display throttle', () => {
  const hub = new SseHub();
  const frames: string[] = [];
  const heartbeat = setInterval(() => {}, 60_000);
  hub.clients.add({
    chatJid: 'web:latency', heartbeat,
    controller: { enqueue: (bytes: Uint8Array) => frames.push(new TextDecoder().decode(bytes)), close() {} } as any,
  });
  const emitter = createAgentEventEmitter({ broadcastEvent: (type: string, data: unknown) => hub.broadcast(type, data) } as any,
    payload => ({ ...payload, chat_jid: 'web:latency' }));
  const stream = createStreamingEventHandler({ emitter, agentId: 'default', threadId: 't', turnId: 'turn', displayUpdateIntervalMs: 60_000 });
  try {
    stream({ type: 'message_update', assistantMessageEvent: { type: 'text_start' } } as any);
    stream({ type: 'message_update', assistantMessageEvent: { type: 'text_delta', delta: 'pending display text' } } as any);
    const before = frames.length;
    // User messages go directly to the SSE hub, not the display coalescer.
    hub.broadcast('new_post', { chat_jid: 'web:latency', id: 42, data: { content: 'accepted input' } });
    emitter.status({ type: 'thinking', title: 'Thinking...', turn_id: 'next-turn' });
    expect(frames.slice(before).map(frame => frame.split('\n')[0])).toEqual(['event: new_post', 'event: agent_status']);
    expect(frames.slice(before).join('\n')).not.toContain('pending display text');
  } finally {
    stream.flushDisplayUpdates();
    hub.closeAll();
  }
});
