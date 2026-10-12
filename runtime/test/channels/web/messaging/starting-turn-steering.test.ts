import { expect, test } from 'bun:test';
import { admitWebUserMessage, storeWebMessage } from '../../../../src/channels/web/messaging/message-store.js';
import { handleAgentMessage } from '../../../../src/channels/web/handlers/agent.js';
import { initDatabase, getDb, getDeferredQueuedFollowups, createMedia, getMessagesSince, setChatCursor } from '../../../../src/db.js';
import { selectProcessChatMessage } from '../../../../src/channels/web/runtime/process-chat-control-runtime.js';
import { finalizeSuccessfulProcessChatRun } from '../../../../src/channels/web/runtime/process-chat-finalization-runtime.js';
import { QueuedFollowupLifecycleService } from '../../../../src/channels/web/runtime/queued-followup-lifecycle-service.js';
import { AgentQueue } from '../../../../src/queue.js';
import { withTempWorkspaceEnv } from '../../../helpers.js';

function fixture(queue: AgentQueue) {
  const queued = new QueuedFollowupLifecycleService();
  const db = getDb();
  const state = { active: false, streaming: false, steerAccepted: false, steerCalls: 0, scheduled: 0, wakes: 0, pendingSteering: [] as string[], events: [] as any[] };
  const channel: any = {
    authGateway: { isAuthEnabled: () => false, getPrincipal: () => ({ mode: 'single-user' }) },
    agentPool: {
      isActive: () => state.active,
      isStreaming: () => state.streaming,
      queueStreamingMessage: async () => { state.steerCalls++; return { queued: state.steerAccepted }; },
    },
    json: (body: unknown, status = 200) => Response.json(body, { status }),
    queue: { isLaneBusy: (key: string) => queue.isLaneBusy(key), enqueue: () => { state.scheduled++; } },
    getQueuedFollowupCount: (chat: string) => queued.getQueuedFollowupCount(chat),
    enqueueQueuedFollowupItem: (chat: string, row: number, content: string, thread: number | null, at: string, extra: any) => queued.enqueueQueuedFollowupItem(chat, row, content, thread, at, extra),
    broadcastEvent: (event: string, body: unknown) => state.events.push({ event, body }),
    resumeChat: () => { state.wakes++; },
    queuePendingSteering: (_chat: string, timestamp: string) => state.pendingSteering.push(timestamp),
    admitQueuedFollowupItem: queued.admitQueuedFollowupItem.bind(queued),
    storeMessage: (chat: string, content: string, isBot: boolean, media: number[], options: any) => storeWebMessage(channel, { chatJid: chat, content, isBot, mediaIds: media, agentId: 'default', agentName: 'Fixture', agentAvatar: '', userName: null, userAvatar: '', userAvatarBackground: null }, options),
    admitUserMessage: (chat: string, content: string, media: number[], options: any, validate: () => void, signal: AbortSignal, defer: () => boolean) => admitWebUserMessage(channel, { chatJid: chat, content, isBot: false, mediaIds: media, agentId: 'default', agentName: 'Fixture', agentAvatar: '', userName: null, userAvatar: '', userAvatarBackground: null }, options, validate, signal, defer),
  };
  return { db, state, channel, queued };
}
function request(content = 'Correction during startup', extras: Record<string, unknown> = {}) {
  return new Request('http://fixture/agent/default/message', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ content, mode: 'steer', ...extras }) });
}
function countMessages(db: ReturnType<typeof getDb>, chat: string): number {
  return (db.query('SELECT COUNT(*) AS n FROM messages WHERE chat_jid=?').get(chat) as { n: number }).n;
}
for (const boundary of ['scheduled', 'protected'] as const) test(`steering during ${boundary} starting turn is durably deferred, not cursor-consumable input`, async () => {
  await withTempWorkspaceEnv(`steer-${boundary}-`, {}, async () => {
    initDatabase(); const queue = new AgentQueue(), f = fixture(queue);
    let release!: () => void; const gate = new Promise<void>(resolve => { release = resolve; });
    if (boundary === 'scheduled') queue.enqueue(async () => gate, 'starting', 'chat:web:starting'); else f.state.active = true;
    try {
      const response = await handleAgentMessage(f.channel, request(), '/agent/default/message', 'web:starting', 'default');
      expect(response.status).toBe(201); expect((await response.json()).queued).toBe('followup');
      expect(getDeferredQueuedFollowups('web:starting')).toHaveLength(1);
      expect(getDeferredQueuedFollowups('web:starting')[0].queuedContent).toBe('Correction during startup');
      expect(countMessages(f.db, 'web:starting')).toBe(0);
      expect(f.state.steerCalls).toBe(0); expect(f.state.scheduled).toBe(0); expect(f.state.wakes).toBe(0);
      expect(f.state.events[0].event).toBe('agent_followup_queued');
    } finally { release(); await queue.shutdown(); }
  });
});
for (const idleAfterCommit of [false, true]) test(`steering admission rechecks a newly starting lane; idle after commit ${idleAfterCommit}`, async () => {
  await withTempWorkspaceEnv('steer-admission-race-', {}, async () => {
    initDatabase(); const queue = new AgentQueue(), f = fixture(queue);
    let releaseAdmission!: () => void, entered!: () => void, releaseRun!: () => void;
    const admissionGate = new Promise<void>(resolve => { releaseAdmission = resolve; });
    const enteredGate = new Promise<void>(resolve => { entered = resolve; });
    const runGate = new Promise<void>(resolve => { releaseRun = resolve; });
    const admit = f.channel.admitUserMessage;
    f.channel.admitUserMessage = async (...args: any[]) => {
      entered(); await admissionGate;
      const result = await admit(...args);
      if (idleAfterCommit) { releaseRun(); await queue.shutdown(); }
      return result;
    };
    try {
      const pending = handleAgentMessage(f.channel, request(), '/agent/default/message', 'web:race', 'default');
      await enteredGate;
      queue.enqueue(async () => runGate, 'starting-race', 'chat:web:race');
      releaseAdmission();
      const response = await pending;
      expect(response.status).toBe(201); expect((await response.json()).queued).toBe('followup');
      expect(getDeferredQueuedFollowups('web:race')).toHaveLength(1);
      expect(countMessages(f.db, 'web:race')).toBe(0);
      expect(f.state.scheduled).toBe(0); expect(f.state.steerCalls).toBe(0);
      expect(f.state.wakes).toBe(idleAfterCommit ? 1 : 0);
    } finally { releaseAdmission(); releaseRun(); await queue.shutdown(); }
  });
});
test('a stream ending before steering delivery falls back to durable follow-up with an idle wake', async () => {
  await withTempWorkspaceEnv('steer-ended-', {}, async () => {
    initDatabase(); const queue = new AgentQueue(), f = fixture(queue); f.state.streaming = true;
    f.channel.agentPool.queueStreamingMessage = async () => { f.state.steerCalls++; f.state.streaming = false; return { queued: false }; };
    try {
      const response = await handleAgentMessage(f.channel, request(), '/agent/default/message', 'web:ended', 'default');
      expect(response.status).toBe(201); expect((await response.json()).queued).toBe('followup');
      expect(getDeferredQueuedFollowups('web:ended')).toHaveLength(1); expect(f.state.steerCalls).toBe(1); expect(f.state.wakes).toBe(1);
      expect(countMessages(f.db, 'web:ended')).toBe(0);
    } finally { await queue.shutdown(); }
  });
});
test('stream-ending fallback preserves attachment-only and structured input metadata', async () => {
  await withTempWorkspaceEnv('steer-payload-', {}, async () => {
    initDatabase(); const queue = new AgentQueue(), f = fixture(queue); f.state.streaming = true;
    const mediaId = createMedia('synthetic.png', 'image/png', new Uint8Array([1,2,3]), null, null);
    const blocks = [{ type: 'text', text: 'Synthetic structured correction' }];
    const previews = [{ url: 'https://fixture.invalid', title: 'Fixture' }];
    f.channel.agentPool.queueStreamingMessage = async () => { f.state.streaming = false; return { queued: false }; };
    try {
      const response = await handleAgentMessage(f.channel, request('', { media_ids: [mediaId], content_blocks: blocks, link_previews: previews, screen_hint: 'tablet' }), '/agent/default/message', 'web:payload', 'default');
      expect(response.status).toBe(201); expect((await response.json()).queued).toBe('followup');
      const [item] = getDeferredQueuedFollowups('web:payload');
      expect(item.mediaIds).toEqual([mediaId]); expect(item.contentBlocks).toEqual(blocks);
      expect(item.linkPreviews).toEqual(previews); expect(item.screenHint).toBe('tablet');
      expect(countMessages(f.db, 'web:payload')).toBe(0);
    } finally { await queue.shutdown(); }
  });
});
test('persisted keyboard steering creates one timeline input and excludes it from ordinary replay', async () => {
  await withTempWorkspaceEnv('steer-timeline-', {}, async () => {
    initDatabase(); const queue = new AgentQueue(), f = fixture(queue); f.state.streaming = true; f.state.steerAccepted = true;
    try {
      const response = await handleAgentMessage(f.channel, request('Visible correction', {persist_steer:true}), '/agent/default/message', 'web:persist', 'default');
      expect(response.status).toBe(201);
      const body = await response.json();
      expect(body.queued).toBe('steer'); expect(body.user_message.data.content).toBe('Visible correction');
      expect(countMessages(f.db, 'web:persist')).toBe(1);
      const row = f.db.query('SELECT is_steering_message FROM messages WHERE chat_jid=?').get('web:persist') as any;
      expect(row.is_steering_message).toBe(1);
      expect(getMessagesSince('web:persist','','Fixture')).toHaveLength(0);
      expect(f.state.events.filter(event=>event.event==='new_post')).toHaveLength(1);
      expect(f.state.events.filter(event=>event.event==='new_post')[0].body.id).toBe(body.user_message.id);
      expect(f.state.pendingSteering).toHaveLength(1); expect(f.state.steerCalls).toBe(1);
      expect(f.state.scheduled).toBe(0); expect(getDeferredQueuedFollowups('web:persist')).toHaveLength(0);
    } finally { await queue.shutdown(); }
  });
});
for (const streaming of [false,true]) test(`persisted steering that cannot inject has exactly one delivery path; initial streaming ${streaming}`,  async () => {
  await withTempWorkspaceEnv('steer-persist-fallback-', {}, async () => {
    initDatabase(); const queue = new AgentQueue(), f = fixture(queue); f.state.streaming = streaming; f.state.active = true;
    try {
      const response = await handleAgentMessage(f.channel, request('Starting correction', {persist_steer:true}), '/agent/default/message', 'web:persist-fallback', 'default');
      expect(response.status).toBe(201); const body = await response.json();
      if (!streaming) {
        expect(body.queued).toBe('followup');
        expect(countMessages(f.db,'web:persist-fallback')).toBe(0);
        expect(getDeferredQueuedFollowups('web:persist-fallback')).toHaveLength(1);
      } else {
        expect(countMessages(f.db,'web:persist-fallback')).toBe(1);
        expect(body.user_message.data.content).toBe('Starting correction');
        expect(body.queued).toBeUndefined();
        expect(f.queued.getQueuedFollowupCount('web:persist-fallback')).toBe(0);
        expect(getDeferredQueuedFollowups('web:persist-fallback')).toHaveLength(0);
        expect(f.state.events.filter(event=>event.event==='new_post')).toHaveLength(1);
        f.channel.consumePendingSteering = () => [];
        f.channel.saveState = () => {};
        f.channel.agentPool.getContextUsageForChat = async () => null;
        f.channel.setContextUsage = () => {};
        await finalizeSuccessfulProcessChatRun({channel:f.channel,emitter:{status:()=>{}} as any,chatJid:'web:persist-fallback',agentId:'default',turnId:'current',threadId:null,prevCursor:'',recovery:null});
        expect(f.state.wakes).toBe(1);
        expect(f.queued.getQueuedFollowupCount('web:persist-fallback')).toBe(0);
        const pending = getMessagesSince('web:persist-fallback','','Fixture');
        expect(pending).toHaveLength(1);
        const selection = selectProcessChatMessage({chatJid:'web:persist-fallback',prevCursor:''});
        expect(selection.kind).toBe('message');
        setChatCursor('web:persist-fallback', pending[0].timestamp);
        expect(getMessagesSince('web:persist-fallback',pending[0].timestamp,'Fixture')).toHaveLength(0);
        expect(countMessages(f.db,'web:persist-fallback')).toBe(1);
      }
      expect(f.state.scheduled).toBe(streaming ? 1 : 0);
    } finally { await queue.shutdown(); }
  });
});
test('streaming steering succeeds once without manufacturing a follow-up', async () => {
  await withTempWorkspaceEnv('steer-live-', {}, async () => {
    initDatabase(); const queue = new AgentQueue(), f = fixture(queue); f.state.streaming = true; f.state.steerAccepted = true;
    try {
      const response = await handleAgentMessage(f.channel, request(), '/agent/default/message', 'web:live', 'default');
      expect(response.status).toBe(201); expect((await response.json()).queued).toBe('steer'); expect(f.state.steerCalls).toBe(1);
      expect(getDeferredQueuedFollowups('web:live')).toHaveLength(0); expect(f.state.events[0].event).toBe('agent_steer_queued');
    } finally { await queue.shutdown(); }
  });
});
