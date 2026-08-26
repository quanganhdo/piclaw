import { expect, test } from 'bun:test';

import {
  hasRenderableContextUsage,
  haveSameContextUsage,
  normalizeContextUsage,
  refreshAutoresearchStatusForChat,
  refreshContextUsageForChat,
  refreshCurrentView,
  refreshModelAndQueueState,
  refreshQueueStateForChat,
} from '../../web/src/ui/app-status-refresh-orchestration.js';

type QueueRow = { row_id: string | number; content?: string };

test('normalizeContextUsage preserves prompt cache-hit telemetry', () => {
  expect(normalizeContextUsage({
    tokens: null,
    contextWindow: null,
    percent: null,
    cacheUsage: {
      latest: {
        inputTokens: '1000',
        outputTokens: 300,
        reasoningTokens: 40,
        cacheReadTokens: 3000,
        cacheWriteTokens: 1000,
        cacheReadReported: true,
        cacheWriteReported: false,
        totalTokens: 5300,
        costTotal: 0.012,
        providerCostTotal: 0.012,
        catalogueCostTotal: 0.02,
        costProvenance: 'provider_reported',
        runs: 1,
        cacheHitRate: 60,
        provider: 'anthropic',
        runAt: '2026-06-08T12:00:00.000Z',
      },
      totals: {
        totalTokens: 5300,
        costTotal: 0.012,
        runs: 1,
        costCoverage: {
          providerReportedRuns: 1,
          catalogueEstimateRuns: 0,
          unavailableRuns: 0,
          legacyRuns: 0,
        },
      },
    },
  })).toEqual({
    tokens: null,
    contextWindow: null,
    percent: null,
    cacheUsage: {
      latest: {
        inputTokens: 1000,
        outputTokens: 300,
        reasoningTokens: 40,
        cacheReadTokens: 3000,
        cacheWriteTokens: 1000,
        cacheReadReported: true,
        cacheWriteReported: false,
        totalTokens: 5300,
        costTotal: 0.012,
        providerCostTotal: 0.012,
        catalogueCostTotal: 0.02,
        costProvenance: 'provider_reported',
        runs: 1,
        cacheHitRate: 60,
        model: null,
        responseModel: null,
        provider: 'anthropic',
        api: null,
        turns: null,
        runAt: '2026-06-08T12:00:00.000Z',
      },
      totals: {
        inputTokens: null,
        outputTokens: null,
        reasoningTokens: null,
        cacheReadTokens: null,
        cacheWriteTokens: null,
        cacheReadReported: null,
        cacheWriteReported: null,
        totalTokens: 5300,
        costTotal: 0.012,
        providerCostTotal: null,
        catalogueCostTotal: null,
        costProvenance: null,
        runs: 1,
        cacheHitRate: null,
        model: null,
        responseModel: null,
        provider: null,
        api: null,
        turns: null,
        runAt: null,
        costCoverage: {
          providerReportedRuns: 1,
          catalogueEstimateRuns: 0,
          unavailableRuns: 0,
          legacyRuns: 0,
        },
      },
    },
  });
  const omitted = normalizeContextUsage({
    tokens: null,
    contextWindow: null,
    percent: null,
    cacheUsage: { latest: { inputTokens: 100, cacheReadTokens: 0, cacheReadReported: false } },
  });
  expect((omitted?.cacheUsage as any)?.latest?.cacheReadReported).toBe(false);
  expect((omitted?.cacheUsage as any)?.latest?.providerCostTotal).toBeNull();
  expect((omitted?.cacheUsage as any)?.latest?.costProvenance).toBeNull();

  expect(hasRenderableContextUsage({ tokens: null, contextWindow: null, percent: null })).toBe(false);
  expect(hasRenderableContextUsage({ tokens: null, contextWindow: null, percent: null, cacheUsage: { latest: { cacheHitRate: 50 } } })).toBe(true);
});

test('haveSameContextUsage includes cache telemetry in equality checks', () => {
  expect(haveSameContextUsage(
    { tokens: 100, contextWindow: 1000, percent: 10, cacheUsage: { latest: { cacheHitRate: 50 } } },
    { tokens: 100, contextWindow: 1000, percent: 10, cacheUsage: { latest: { cacheHitRate: 50 } } },
  )).toBe(true);
  expect(haveSameContextUsage(
    { tokens: 100, contextWindow: 1000, percent: 10, cacheUsage: { latest: { cacheHitRate: 50 } } },
    { tokens: 100, contextWindow: 1000, percent: 10, cacheUsage: { latest: { cacheHitRate: 60 } } },
  )).toBe(false);
});

test('refreshQueueStateForChat keeps only newest non-dismissed queue rows', async () => {
  const queueRefreshGenRef = { current: 0 };
  const activeChatJidRef = { current: 'chat:alpha' };
  const dismissedQueueRowIdsRef = { current: new Set<string | number>(['row-dismissed']) };
  const clearCounts: number[] = [];

  let queueRows: QueueRow[] = [{ row_id: 'row-old' }];
  refreshQueueStateForChat<QueueRow>({
    currentChatJid: 'chat:alpha',
    queueRefreshGenRef,
    activeChatJidRef,
    dismissedQueueRowIdsRef,
    getAgentQueueState: async () => ({
      items: [
        { row_id: 'row-dismissed', content: 'hidden' },
        { row_id: 'row-visible', content: 'keep' },
      ],
    }),
    setFollowupQueueItems: (next) => {
      queueRows = typeof next === 'function' ? next(queueRows) : next;
    },
    clearQueuedSteerStateIfStale: (remainingQueueCount) => {
      clearCounts.push(remainingQueueCount);
    },
  });

  await Promise.resolve();

  expect(queueRows).toEqual([{ row_id: 'row-visible', content: 'keep' }]);
  expect(clearCounts).toEqual([]);
});

test('refreshQueueStateForChat drops stale refresh generations and clears queue on empty payload', async () => {
  const queueRefreshGenRef = { current: 0 };
  const activeChatJidRef = { current: 'chat:alpha' };
  const dismissedQueueRowIdsRef = { current: new Set<string | number>(['row-dismissed']) };
  const clearCounts: number[] = [];

  let resolvePayload: ((value: { items: QueueRow[] }) => void) | null = null;
  let queueRows: QueueRow[] = [{ row_id: 'row-old' }];

  refreshQueueStateForChat<QueueRow>({
    currentChatJid: 'chat:alpha',
    queueRefreshGenRef,
    activeChatJidRef,
    dismissedQueueRowIdsRef,
    getAgentQueueState: () => new Promise((resolve) => {
      resolvePayload = resolve;
    }),
    setFollowupQueueItems: (next) => {
      queueRows = typeof next === 'function' ? next(queueRows) : next;
    },
    clearQueuedSteerStateIfStale: (remainingQueueCount) => {
      clearCounts.push(remainingQueueCount);
    },
  });

  // Simulate a newer refresh issued before this request resolves.
  queueRefreshGenRef.current += 1;
  resolvePayload?.({ items: [{ row_id: 'row-new' }] });
  await Promise.resolve();
  expect(queueRows).toEqual([{ row_id: 'row-old' }]);

  // Now run a non-stale refresh with no rows.
  refreshQueueStateForChat<QueueRow>({
    currentChatJid: 'chat:alpha',
    queueRefreshGenRef,
    activeChatJidRef,
    dismissedQueueRowIdsRef,
    getAgentQueueState: async () => ({ items: [] }),
    setFollowupQueueItems: (next) => {
      queueRows = typeof next === 'function' ? next(queueRows) : next;
    },
    clearQueuedSteerStateIfStale: (remainingQueueCount) => {
      clearCounts.push(remainingQueueCount);
    },
  });

  await Promise.resolve();

  expect(queueRows).toEqual([]);
  expect(dismissedQueueRowIdsRef.current.size).toBe(0);
  expect(clearCounts[clearCounts.length - 1]).toBe(0);
});

test('refreshQueueStateForChat preserves optimistic rows when the backend only returns dismissed ids', async () => {
  const queueRefreshGenRef = { current: 0 };
  const activeChatJidRef = { current: 'chat:alpha' };
  const dismissedQueueRowIdsRef = { current: new Set<string | number>([-1]) };
  const clearCounts: number[] = [];
  let queueRows: QueueRow[] = [{ row_id: -1, content: 'queued now' }];

  refreshQueueStateForChat<any>({
    currentChatJid: 'chat:alpha',
    queueRefreshGenRef,
    activeChatJidRef,
    dismissedQueueRowIdsRef,
    getAgentQueueState: async () => ({ items: [{ row_id: -1, content: 'queued now' }] }),
    setFollowupQueueItems: (next) => {
      queueRows = typeof next === 'function' ? next(queueRows) : next;
    },
    clearQueuedSteerStateIfStale: (remainingQueueCount) => {
      clearCounts.push(remainingQueueCount);
    },
  });

  await Promise.resolve();

  expect(queueRows).toEqual([{ row_id: -1, content: 'queued now' }]);
  expect(Array.from(dismissedQueueRowIdsRef.current)).toEqual([-1]);
  expect(clearCounts).toEqual([]);
});

test('refreshContextUsageForChat ignores stale chat responses', async () => {
  const activeChatJidRef = { current: 'chat:alpha' };
  let contextState: any = null;

  const pending = refreshContextUsageForChat({
    currentChatJid: 'chat:alpha',
    activeChatJidRef,
    getAgentContext: async () => ({ usage: 42 }),
    setContextUsage: (next) => {
      contextState = typeof next === 'function' ? next(contextState) : next;
    },
  });

  activeChatJidRef.current = 'chat:beta';
  await pending;

  expect(contextState).toBeNull();
});

test('refreshContextUsageForChat does not overwrite cached state with null-percent API response', async () => {
  const activeChatJidRef = { current: 'chat:alpha' };
  let contextState: any = { tokens: 5000, contextWindow: 128000, percent: 3.9 };

  await refreshContextUsageForChat({
    currentChatJid: 'chat:alpha',
    activeChatJidRef,
    getAgentContext: async () => ({ tokens: null, contextWindow: null, percent: null }),
    setContextUsage: (next) => {
      contextState = typeof next === 'function' ? next(contextState) : next;
    },
  });

  // The null-percent response from inactive pools must not overwrite
  // the previously cached/restored context usage.
  expect(contextState).toEqual({ tokens: 5000, contextWindow: 128000, percent: 3.9 });
});

test('refreshContextUsageForChat updates state when API returns real data', async () => {
  const activeChatJidRef = { current: 'chat:alpha' };
  let contextState: any = null;

  await refreshContextUsageForChat({
    currentChatJid: 'chat:alpha',
    activeChatJidRef,
    getAgentContext: async () => ({ tokens: 8000, contextWindow: 128000, percent: 6.25 }),
    setContextUsage: (next) => {
      contextState = typeof next === 'function' ? next(contextState) : next;
    },
  });

  expect(contextState).toEqual({ tokens: 8000, contextWindow: 128000, percent: 6.25, cacheUsage: null });
});

test('refreshContextUsageForChat merges cache-only telemetry into existing context metrics', async () => {
  const activeChatJidRef = { current: 'chat:alpha' };
  let contextState: any = { tokens: 5000, contextWindow: 128000, percent: 3.9 };

  await refreshContextUsageForChat({
    currentChatJid: 'chat:alpha',
    activeChatJidRef,
    getAgentContext: async () => ({
      tokens: null,
      contextWindow: null,
      percent: null,
      cacheUsage: { latest: { cacheHitRate: 87.3, cacheReadTokens: 873, inputTokens: 100, cacheWriteTokens: 27 } },
    }),
    setContextUsage: (next) => {
      contextState = typeof next === 'function' ? next(contextState) : next;
    },
  });

  expect(contextState).toEqual({
    tokens: 5000,
    contextWindow: 128000,
    percent: 3.9,
    cacheUsage: {
      latest: {
        inputTokens: 100,
        outputTokens: null,
        reasoningTokens: null,
        cacheReadTokens: 873,
        cacheWriteTokens: 27,
        cacheReadReported: null,
        cacheWriteReported: null,
        totalTokens: null,
        costTotal: null,
        providerCostTotal: null,
        catalogueCostTotal: null,
        costProvenance: null,
        runs: null,
        cacheHitRate: 87.3,
        model: null,
        responseModel: null,
        provider: null,
        api: null,
        turns: null,
        runAt: null,
      },
      totals: null,
    },
  });
});

test('refreshContextUsageForChat preserves cache telemetry when context metrics update', async () => {
  const activeChatJidRef = { current: 'chat:alpha' };
  const cacheUsage = {
    latest: {
      inputTokens: 100,
      outputTokens: null,
      reasoningTokens: null,
      cacheReadTokens: 873,
      cacheWriteTokens: 27,
      cacheReadReported: null,
      cacheWriteReported: null,
      totalTokens: null,
      costTotal: null,
      providerCostTotal: null,
      catalogueCostTotal: null,
      costProvenance: null,
      runs: null,
      cacheHitRate: 87.3,
      model: null,
      responseModel: null,
      provider: null,
      api: null,
      turns: null,
      runAt: null,
    },
    totals: null,
  };
  let contextState: any = {
    tokens: 5000,
    contextWindow: 128000,
    percent: 3.9,
    cacheUsage,
  };

  await refreshContextUsageForChat({
    currentChatJid: 'chat:alpha',
    activeChatJidRef,
    getAgentContext: async () => ({ tokens: 8000, contextWindow: 128000, percent: 6.25 }),
    setContextUsage: (next) => {
      contextState = typeof next === 'function' ? next(contextState) : next;
    },
  });

  expect(contextState).toEqual({
    tokens: 8000,
    contextWindow: 128000,
    percent: 6.25,
    cacheUsage,
  });
});

test('refreshAutoresearchStatusForChat updates panels and clears autoresearch pending actions', async () => {
  const activeChatJidRef = { current: 'chat:alpha' };
  let panelState = new Map<string, any>();
  let pendingActions = new Set<string>(['autoresearch:stop', 'custom:keep']);

  await refreshAutoresearchStatusForChat({
    currentChatJid: 'chat:alpha',
    activeChatJidRef,
    getAutoresearchStatus: async () => ({
      key: 'autoresearch',
      content: [{ type: 'status_panel', panel: { state: 'running', title: 'Auto' } }],
    }),
    setExtensionStatusPanels: (next) => {
      panelState = typeof next === 'function' ? next(panelState) : next;
    },
    setPendingExtensionPanelActions: (next) => {
      pendingActions = typeof next === 'function' ? next(pendingActions) : next;
    },
  });

  expect(panelState.get('autoresearch')).toEqual({ state: 'running', title: 'Auto' });
  expect(Array.from(pendingActions)).toEqual(['custom:keep']);
});

test('refreshCurrentView refreshes timeline only on main view and always refreshes model/queue bundle', () => {
  let timelineCalls = 0;
  let bundleCalls = 0;

  refreshCurrentView({
    viewStateRef: { current: { currentHashtag: null, searchQuery: null, searchOpen: false } },
    refreshTimeline: () => { timelineCalls += 1; },
    refreshModelAndQueueState: () => { bundleCalls += 1; },
  });

  refreshCurrentView({
    viewStateRef: { current: { currentHashtag: 'tag', searchQuery: null, searchOpen: false } },
    refreshTimeline: () => { timelineCalls += 1; },
    refreshModelAndQueueState: () => { bundleCalls += 1; },
  });

  expect(timelineCalls).toBe(1);
  expect(bundleCalls).toBe(2);

  const calls: string[] = [];
  refreshModelAndQueueState({
    refreshModelState: () => calls.push('model'),
    refreshActiveChatAgents: () => calls.push('active'),
    refreshCurrentChatBranches: () => calls.push('branches'),
    refreshQueueState: () => calls.push('queue'),
    refreshContextUsage: () => calls.push('context'),
    refreshAutoresearchStatus: () => calls.push('autoresearch'),
  });
  expect(calls).toEqual(['model', 'active', 'branches', 'queue', 'context', 'autoresearch']);
});
