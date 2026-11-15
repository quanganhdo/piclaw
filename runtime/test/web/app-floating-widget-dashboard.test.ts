import { expect, test } from 'bun:test';

import {
  buildFloatingWidgetDashboardSnapshot,
  readFulfilledResult,
} from '../../web/src/ui/app-floating-widget-dashboard.js';

test('readFulfilledResult returns fulfilled values and null for rejected results', () => {
  expect(readFulfilledResult({ status: 'fulfilled', value: { ok: true } })).toEqual({ ok: true });
  expect(readFulfilledResult({ status: 'rejected', reason: new Error('boom') })).toBeNull();
});

test('buildFloatingWidgetDashboardSnapshot prefers server payloads and computes bars/counters', () => {
  const snapshot = buildFloatingWidgetDashboardSnapshot({
    generatedAt: '2026-03-29T00:00:00.000Z',
    request: { source: 'test' },
    currentChatJid: 'chat:1',
    currentRootChatJid: 'chat:root',
    statusPayload: { status: 'active', data: { type: 'thinking' } },
    contextPayload: { percent: 27.8, tokens: 123, contextWindow: 4096 },
    queuePayload: { count: 3 },
    modelsPayload: { current: 'gpt-5', thinking_level: 'high', supports_thinking: 1 },
    activeChatsPayload: { chats: [{}, {}, {}] },
    branchesPayload: { chats: [{}, {}] },
    timelinePayload: {
      posts: [
        { id: 'u1', timestamp: '2026-03-29T00:00:01.000Z', data: { is_bot_message: false } },
        { id: 'b1', timestamp: '2026-03-29T00:00:02.000Z', data: { is_bot_message: true } },
      ],
    },
    isAgentTurnActive: true,
  });

  expect(snapshot).toMatchObject({
    generatedAt: '2026-03-29T00:00:00.000Z',
    chat: { currentChatJid: 'chat:1', rootChatJid: 'chat:root', activeChats: 3, branches: 2 },
    agent: { status: 'active', phase: 'thinking', running: true },
    model: { current: 'gpt-5', thinkingLevel: 'high', supportsThinking: true },
    context: { tokens: 123, contextWindow: 4096, percent: 27.8 },
    queue: { count: 3 },
    timeline: { loadedPosts: 2, botPosts: 1, userPosts: 1, latestPostId: 'b1', latestTimestamp: '2026-03-29T00:00:02.000Z' },
  });

  expect(snapshot.bars).toEqual([
    { key: 'context', label: 'Context', value: 28 },
    { key: 'queue', label: 'Queue', value: 54 },
    { key: 'activeChats', label: 'Active chats', value: 36 },
    { key: 'posts', label: 'Timeline load', value: 10 },
  ]);
});

test('buildFloatingWidgetDashboardSnapshot falls back to in-memory state and clamps bars', () => {
  const snapshot = buildFloatingWidgetDashboardSnapshot({
    generatedAt: '2026-03-29T00:00:00.000Z',
    request: null,
    currentChatJid: 'chat:1',
    currentRootChatJid: null,
    contextUsage: { percent: 180, tokens: 999, contextWindow: 8192 },
    followupQueueItems: new Array(10).fill({ row_id: 'x' }),
    activeChatAgents: new Array(20).fill({}),
    currentChatBranches: new Array(9).fill({}),
    rawPosts: new Array(30).fill(null).map((_, index) => ({ id: `p${index}`, data: { is_bot_message: index % 2 === 0 } })),
    activeModel: 'fallback-model',
    activeThinkingLevel: 'medium',
    supportsThinking: false,
    isAgentTurnActive: false,
  });

  expect(snapshot).toMatchObject({
    agent: { status: 'idle', phase: null, running: false },
    model: { current: 'fallback-model', thinkingLevel: 'medium', supportsThinking: false },
    context: { tokens: 999, contextWindow: 8192, percent: 180 },
    queue: { count: 10 },
    timeline: { loadedPosts: 30, latestPostId: 'p29' },
    chat: { activeChats: 20, branches: 9 },
  });

  expect(snapshot.bars).toEqual([
    { key: 'context', label: 'Context', value: 100 },
    { key: 'queue', label: 'Queue', value: 100 },
    { key: 'activeChats', label: 'Active chats', value: 100 },
    { key: 'posts', label: 'Timeline load', value: 100 },
  ]);
});


test('authoritative unknown dashboard snapshots cannot revive captured counts or turn unknown into zero', () => {
  const snapshot = buildFloatingWidgetDashboardSnapshot({ generatedAt: 'test', request: {}, currentChatJid: 'chat:1', currentRootChatJid: null,
    contextUsage: { tokens: 777, contextWindow: 10000, percent: 7.77, sessionGeneration: 'stable' },
    contextPayload: { tokens: null, contextWindow: null, percent: null, sessionGeneration: 'stable', contextUpdate: 'replace' },
  });
  expect(snapshot.context).toEqual({ tokens: null, contextWindow: null, percent: null });
  expect((snapshot.bars as any[])[0].value).toBeNull();
});
