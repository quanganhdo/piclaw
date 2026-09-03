import { afterEach, expect, test } from 'bun:test';

import { handleAppSseEvent, type HandleAppSseEventDependencies } from '../../web/src/ui/app-sse-events.js';
import {
  noteAppChatActivation,
  resetAppRefreshCoordination,
} from '../../web/src/ui/app-refresh-coordination.js';
import {
  reconcileContextUsageForChat,
  resetContextSessionGenerationsForTests,
} from '../../web/src/ui/app-status-refresh-orchestration.js';

afterEach(() => {
  resetAppRefreshCoordination();
  resetContextSessionGenerationsForTests();
});

function applyUpdate<T>(current: T, next: T | ((prev: T) => T)): T {
  return typeof next === 'function' ? (next as (prev: T) => T)(current) : next;
}

function createDeps() {
  let extensionPanels = new Map<string, any>();
  let pendingPanelActions = new Set<string>(['panel-a:run', 'autoresearch:stop']);
  let extensionWorkingState: any = { message: null, indicator: null };
  let followupQueueItems: Array<{ row_id: string; content?: string }> = [
    { row_id: 'row-1', content: 'first' },
    { row_id: 'row-2', content: 'second' },
  ];
  const toastCalls: Array<[string, string | null | undefined, string | undefined, number | undefined]> = [];
  const clearQueueCalls: number[] = [];
  let refreshQueueCalls = 0;
  let agentStatus: any = null;
  let agentDraft: any = { text: '', totalLines: 0 };
  let agentThought: any = { text: '', totalLines: 0 };
  let contextUsage: any = null;

  const deps: HandleAppSseEventDependencies = {
    currentChatJid: 'chat:alpha',
    updateAgentProfile: () => undefined,
    updateUserProfile: () => undefined,

    currentTurnIdRef: { current: null },
    activeChatJidRef: { current: 'chat:alpha' },
    pendingRequestRef: { current: null },
    draftBufferRef: { current: '' },
    thoughtBufferRef: { current: '' },
    previewResyncPendingRef: { current: false },
    previewResyncGenerationRef: { current: 0 },
    steerQueuedTurnIdRef: { current: null },
    thoughtExpandedRef: { current: false },
    draftExpandedRef: { current: false },
    draftThrottleRef: { current: 0 },
    thoughtThrottleRef: { current: 0 },
    viewStateRef: { current: { currentHashtag: null, searchQuery: null, searchOpen: false } },
    followupQueueItemsRef: { current: followupQueueItems },
    dismissedQueueRowIdsRef: { current: new Set<string | number>() },
    scrollToBottomRef: { current: null },
    hasMoreRef: { current: false },
    loadMoreRef: { current: null },
    lastAgentResponseRef: { current: null },
    wasAgentActiveRef: { current: false },

    setActiveTurn: () => undefined,
    applyLiveGeneratedWidgetUpdate: () => undefined,
    setFloatingWidget: () => undefined,
    clearLastActivityFlag: () => undefined,
    handleUiVersionDrift: () => false,
    setAgentStatus: (next) => {
      agentStatus = applyUpdate(agentStatus, next);
    },
    setAgentDraft: (next) => {
      agentDraft = applyUpdate(agentDraft, next);
    },
    setAgentPlan: () => undefined,
    setAgentThought: (next) => {
      agentThought = applyUpdate(agentThought, next);
    },
    setPendingRequest: () => undefined,
    clearAgentRunState: () => undefined,
    getAgentStatus: async () => null,
    noteAgentActivity: () => undefined,
    showLastActivity: () => undefined,
    refreshTimeline: () => undefined,
    refreshModelAndQueueState: () => undefined,
    refreshActiveChatAgents: () => undefined,
    refreshCurrentChatBranches: () => undefined,
    notifyForFinalResponse: () => undefined,
    setContextUsage: (next) => {
      contextUsage = applyUpdate(contextUsage, next);
    },
    refreshContextUsage: () => undefined,
    refreshQueueState: () => {
      refreshQueueCalls += 1;
    },
    setFollowupQueueItems: (next) => {
      followupQueueItems = applyUpdate(followupQueueItems, next);
      deps.followupQueueItemsRef.current = followupQueueItems;
    },
    clearQueuedSteerStateIfStale: (remainingQueueCount) => {
      clearQueueCalls.push(remainingQueueCount);
    },
    setSteerQueuedTurnId: () => undefined,
    applyModelState: () => undefined,
    getAgentContext: async () => null,
    setExtensionStatusPanels: (next) => {
      extensionPanels = applyUpdate(extensionPanels, next);
    },
    setPendingExtensionPanelActions: (next) => {
      pendingPanelActions = applyUpdate(pendingPanelActions, next);
    },
    setExtensionWorkingState: (next) => {
      extensionWorkingState = applyUpdate(extensionWorkingState, next);
    },
    refreshActiveEditorFromWorkspace: () => undefined,
    showIntentToast: (title, detail, kind, durationMs) => {
      toastCalls.push([title, detail, kind, durationMs]);
    },
    removeStalledPost: () => undefined,
    setPosts: () => undefined,
    preserveTimelineScrollTop: (mutate) => mutate(),
  };

  return {
    deps,
    getExtensionPanels: () => extensionPanels,
    getPendingPanelActions: () => pendingPanelActions,
    getExtensionWorkingState: () => extensionWorkingState,
    getFollowupQueueItems: () => followupQueueItems,
    getToastCalls: () => toastCalls,
    getClearQueueCalls: () => clearQueueCalls,
    getRefreshQueueCalls: () => refreshQueueCalls,
    getAgentStatusState: () => agentStatus,
    getAgentDraftState: () => agentDraft,
    getAgentThoughtState: () => agentThought,
    getContextUsageState: () => contextUsage,
    setContextUsageState: (next: any) => { contextUsage = next; },
  };
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

test('handleAppSseEvent routes status-panel widget events and clears finished pending actions', () => {
  const state = createDeps();

  handleAppSseEvent('extension_ui_widget', {
    key: 'panel-a',
    chat_jid: 'chat:alpha',
    options: { surface: 'status-panel' },
    content: [{ type: 'status_panel', panel: { state: 'done', title: 'Complete' } }],
  }, state.deps);

  expect(state.getExtensionPanels().get('panel-a')).toEqual({ state: 'done', title: 'Complete' });
  expect(Array.from(state.getPendingPanelActions())).toEqual(['autoresearch:stop']);
});

test('handleAppSseEvent preserves snapshot-only preview panes without treating bounded text as authoritative', () => {
  const state = createDeps();

  handleAppSseEvent('agent_thought', {
    chat_jid: 'chat:alpha',
    text: 'reasoning before the tool',
    total_lines: 1,
  }, state.deps);
  handleAppSseEvent('agent_draft', {
    chat_jid: 'chat:alpha',
    text: 'commentary before the tool',
    total_lines: 1,
    kind: 'draft',
    mode: 'replace',
  }, state.deps);

  handleAppSseEvent('agent_status', {
    chat_jid: 'chat:alpha',
    type: 'thinking',
    phase: 'post_tool_model',
    title: 'Continuing after tools...',
  }, state.deps);

  expect(state.getAgentThoughtState()).toMatchObject({ text: 'reasoning before the tool', totalLines: 1 });
  expect(state.getAgentDraftState()).toMatchObject({ text: 'commentary before the tool', totalLines: 1 });
  expect(state.deps.thoughtBufferRef.current).toBe('');
  expect(state.deps.draftBufferRef.current).toBe('');
  expect(state.getAgentStatusState()).toMatchObject({ phase: 'post_tool_model' });
});

test('handleAppSseEvent tracks extension working messages and indicators for the active chat', () => {
  const state = createDeps();

  handleAppSseEvent('extension_ui_working', {
    chat_jid: 'chat:alpha',
    message: 'Compacting context…',
  }, state.deps);

  expect(state.getExtensionWorkingState()).toEqual({
    message: 'Compacting context…',
    indicator: null,
  });

  handleAppSseEvent('extension_ui_working_indicator', {
    chat_jid: 'chat:alpha',
    frames: ['⠋', '⠙'],
    interval_ms: 90,
  }, state.deps);

  expect(state.getExtensionWorkingState()).toEqual({
    message: 'Compacting context…',
    indicator: {
      mode: 'custom',
      frames: ['⠋', '⠙'],
      intervalMs: 90,
    },
  });

  handleAppSseEvent('extension_ui_working', {
    chat_jid: 'chat:beta',
    message: 'Ignore other chats',
  }, state.deps);

  expect(state.getExtensionWorkingState()).toEqual({
    message: 'Compacting context…',
    indicator: {
      mode: 'custom',
      frames: ['⠋', '⠙'],
      intervalMs: 90,
    },
  });
});

test('handleAppSseEvent clears extension working state when the turn completes', () => {
  const state = createDeps();

  handleAppSseEvent('extension_ui_working', {
    chat_jid: 'chat:alpha',
    message: 'Compacting context…',
  }, state.deps);
  handleAppSseEvent('extension_ui_working_indicator', {
    chat_jid: 'chat:alpha',
    frames: ['⠋', '⠙'],
    interval_ms: 90,
  }, state.deps);

  handleAppSseEvent('agent_response', {
    chat_jid: 'chat:alpha',
    content: 'done',
  }, state.deps);

  expect(state.getExtensionWorkingState()).toEqual({ message: null, indicator: null, visible: true });
});

test('handleAppSseEvent removes followup rows on removal events and schedules queue refresh', () => {
  const state = createDeps();

  handleAppSseEvent('agent_followup_removed', {
    chat_jid: 'chat:alpha',
    row_id: 'row-1',
  }, state.deps);

  expect(state.deps.dismissedQueueRowIdsRef.current.has('row-1')).toBe(true);
  expect(state.getFollowupQueueItems().map((item) => item.row_id)).toEqual(['row-2']);
  expect(state.getClearQueueCalls()).toEqual([1]);
  expect(state.getRefreshQueueCalls()).toBe(1);
});

test('handleAppSseEvent restores active agent status on reconnect', async () => {
  const state = createDeps();
  state.deps.getAgentStatus = async () => ({
    status: 'active',
    data: {
      chat_jid: 'chat:alpha',
      type: 'intent',
      title: 'Compacting context',
      intent_key: 'compaction',
      turn_id: 'turn-42',
      started_at: '2026-03-30T21:00:00.000Z',
    },
    thought: { text: 'thought preview', totalLines: 2 },
    draft: { text: 'draft preview', totalLines: 3 },
  });

  state.deps.draftBufferRef.current = 'visible draft during reconnect';
  state.deps.setAgentDraft({ text: 'visible draft during reconnect', totalLines: 1 });

  handleAppSseEvent('connected', { app_asset_version: 'test' }, state.deps);
  expect(state.getAgentDraftState()).toMatchObject({ text: 'visible draft during reconnect' });
  await Promise.resolve();

  expect(state.getAgentStatusState()).toEqual({
    chat_jid: 'chat:alpha',
    type: 'intent',
    title: 'Compacting context',
    intent_key: 'compaction',
    turn_id: 'turn-42',
    started_at: '2026-03-30T21:00:00.000Z',
  });
});

test('handleAppSseEvent applies explicit empty preview snapshots during reconnect', async () => {
  const state = createDeps();
  state.deps.currentTurnIdRef.current = 'turn-42';
  state.deps.draftBufferRef.current = 'stale draft';
  state.deps.thoughtBufferRef.current = 'stale thought';
  state.deps.setAgentDraft({ text: 'stale draft', totalLines: 1 });
  state.deps.setAgentThought({ text: 'stale thought', totalLines: 1 });
  state.deps.getAgentStatus = async () => ({
    status: 'active',
    data: { chat_jid: 'chat:alpha', type: 'thinking', turn_id: 'turn-42' },
    draft: { text: '', totalLines: 0 },
    thought: { text: '', totalLines: 0 },
  });

  handleAppSseEvent('connected', { app_asset_version: 'test' }, state.deps);
  await Promise.resolve();

  expect(state.deps.draftBufferRef.current).toBe('');
  expect(state.deps.thoughtBufferRef.current).toBe('');
  expect(state.getAgentDraftState()).toEqual({ text: '', totalLines: 0 });
  expect(state.getAgentThoughtState()).toEqual({ text: '', totalLines: 0 });
});

test('handleAppSseEvent applies terminal status context after reconnect', async () => {
  const state = createDeps();
  let contextRefreshes = 0;
  state.deps.getAgentStatus = async () => ({
    status: 'idle',
    data: { type: 'done', title: 'Completed /session-rotate', turn_id: 'turn-rotate' },
  });
  state.deps.refreshContextUsage = async () => {
    contextRefreshes += 1;
  };

  state.deps.draftBufferRef.current = 'visible draft until terminal snapshot';
  state.deps.setAgentDraft({ text: 'visible draft until terminal snapshot', totalLines: 1 });

  handleAppSseEvent('connected', { app_asset_version: 'test' }, state.deps);
  expect(state.getAgentDraftState()).toMatchObject({ text: 'visible draft until terminal snapshot' });
  await Promise.resolve();

  expect(contextRefreshes).toBe(1);
  expect(state.getAgentStatusState()).toBeNull();
  expect(state.getAgentDraftState()).toEqual({ text: '', totalLines: 0 });
});

test('handleAppSseEvent refetches preview state when updates race reconnect restore', async () => {
  const state = createDeps();
  const firstStatusRequest = deferred<any>();
  const secondStatusRequest = deferred<any>();
  let statusCalls = 0;
  state.deps.draftBufferRef.current = 'stale draft';
  state.deps.thoughtBufferRef.current = 'stale thought';
  state.deps.getAgentStatus = async () => {
    statusCalls += 1;
    return statusCalls === 1 ? firstStatusRequest.promise : secondStatusRequest.promise;
  };

  state.deps.setAgentDraft({ text: 'stale draft', totalLines: 1 });
  state.deps.setAgentThought({ text: 'stale thought', totalLines: 1 });

  handleAppSseEvent('connected', { app_asset_version: 'test' }, state.deps);

  expect(state.deps.previewResyncPendingRef.current).toBe(true);
  expect(state.deps.draftBufferRef.current).toBe('stale draft');
  expect(state.deps.thoughtBufferRef.current).toBe('stale thought');
  expect(state.getAgentDraftState()).toMatchObject({ text: 'stale draft' });
  expect(state.getAgentThoughtState()).toMatchObject({ text: 'stale thought' });

  handleAppSseEvent('agent_draft_delta', {
    chat_jid: 'chat:alpha',
    delta: ' arrived during restore',
  }, state.deps);
  handleAppSseEvent('agent_thought', {
    chat_jid: 'chat:alpha',
    text: 'thought arrived during restore',
    total_lines: 1,
  }, state.deps);

  firstStatusRequest.resolve({
    status: 'active',
    data: {
      chat_jid: 'chat:alpha',
      type: 'intent',
      title: 'Restoring preview',
      turn_id: 'turn-99',
    },
    draft: { text: 'snapshot before racing draft', totalLines: 1 },
    thought: { text: 'snapshot before racing thought', totalLines: 1 },
  });
  await firstStatusRequest.promise;
  await new Promise((resolve) => setTimeout(resolve, 0));

  expect(statusCalls).toBe(2);
  expect(state.deps.previewResyncPendingRef.current).toBe(true);

  secondStatusRequest.resolve({
    status: 'active',
    data: {
      chat_jid: 'chat:alpha',
      type: 'intent',
      title: 'Restoring preview',
      turn_id: 'turn-99',
    },
    draft: { text: 'snapshot including racing draft', totalLines: 1 },
    thought: { text: 'snapshot including racing thought', totalLines: 1 },
  });
  await secondStatusRequest.promise;
  await new Promise((resolve) => setTimeout(resolve, 0));

  expect(state.deps.previewResyncPendingRef.current).toBe(false);
  expect(state.deps.draftBufferRef.current).toBe('snapshot including racing draft');
  expect(state.deps.thoughtBufferRef.current).toBe('snapshot including racing thought');
});

test('handleAppSseEvent refetches when preview consumption races reconnect restore', async () => {
  const state = createDeps();
  const firstStatusRequest = deferred<any>();
  const secondStatusRequest = deferred<any>();
  let statusCalls = 0;
  state.deps.currentTurnIdRef.current = 'turn-99';
  state.deps.getAgentStatus = async () => {
    statusCalls += 1;
    return statusCalls === 1 ? firstStatusRequest.promise : secondStatusRequest.promise;
  };
  state.deps.draftBufferRef.current = 'visible draft';
  state.deps.thoughtBufferRef.current = 'visible thought';
  state.deps.setAgentDraft({ text: 'visible draft', totalLines: 1 });
  state.deps.setAgentThought({ text: 'visible thought', totalLines: 1 });

  handleAppSseEvent('connected', { app_asset_version: 'test' }, state.deps);
  handleAppSseEvent('agent_preview_consumed', {
    chat_jid: 'chat:alpha', turn_id: 'turn-99', row_id: 42,
  }, state.deps);

  expect(state.getAgentDraftState()).toEqual({ text: '', totalLines: 0 });
  expect(state.getAgentThoughtState()).toEqual({ text: '', totalLines: 0 });

  firstStatusRequest.resolve({
    status: 'active',
    data: { chat_jid: 'chat:alpha', type: 'thinking', turn_id: 'turn-99' },
    draft: { text: 'stale draft', totalLines: 1 },
    thought: { text: 'stale thought', totalLines: 1 },
  });
  await firstStatusRequest.promise;
  await new Promise((resolve) => setTimeout(resolve, 0));
  expect(statusCalls).toBe(2);

  secondStatusRequest.resolve({
    status: 'active',
    data: { chat_jid: 'chat:alpha', type: 'thinking', turn_id: 'turn-99' },
    draft: { text: '', totalLines: 0 },
    thought: { text: '', totalLines: 0 },
  });
  await secondStatusRequest.promise;
  await new Promise((resolve) => setTimeout(resolve, 0));

  expect(state.deps.previewResyncPendingRef.current).toBe(false);
  expect(state.getAgentDraftState()).toEqual({ text: '', totalLines: 0 });
  expect(state.getAgentThoughtState()).toEqual({ text: '', totalLines: 0 });
});

test('handleAppSseEvent skips duplicate reconnect recovery during a fresh cold-open activation', async () => {
  noteAppChatActivation({ chatJid: 'chat:alpha' });
  const state = createDeps();
  let agentStatusCalls = 0;
  let timelineCalls = 0;
  let bundleCalls = 0;
  const resetCalls: string[] = [];
  state.deps.getAgentStatus = async () => {
    agentStatusCalls += 1;
    return null;
  };
  state.deps.setAgentStatus = () => {
    resetCalls.push('status');
  };
  state.deps.setAgentDraft = () => {
    resetCalls.push('draft');
  };
  state.deps.setAgentPlan = () => {
    resetCalls.push('plan');
  };
  state.deps.setAgentThought = () => {
    resetCalls.push('thought');
  };
  state.deps.setPendingRequest = () => {
    resetCalls.push('pending');
  };
  state.deps.clearAgentRunState = () => {
    resetCalls.push('clear');
  };
  state.deps.refreshTimeline = () => {
    timelineCalls += 1;
  };
  state.deps.refreshModelAndQueueState = () => {
    bundleCalls += 1;
  };

  handleAppSseEvent('connected', { app_asset_version: 'test' }, state.deps);
  await Promise.resolve();

  expect(agentStatusCalls).toBe(0);
  expect(timelineCalls).toBe(0);
  expect(bundleCalls).toBe(0);
  expect(resetCalls).toEqual(['status', 'pending']);
});

test('handleAppSseEvent refreshes compaction status metadata even when title stays the same', () => {
  const state = createDeps();

  handleAppSseEvent('agent_status', {
    chat_jid: 'chat:alpha',
    type: 'intent',
    title: 'Compacting context',
    intent_key: 'compaction',
    turn_id: 'turn-1',
    started_at: '2026-04-02T13:00:00.000Z',
  }, state.deps);

  handleAppSseEvent('agent_status', {
    chat_jid: 'chat:alpha',
    type: 'intent',
    title: 'Compacting context',
    intent_key: 'compaction',
    turn_id: 'turn-2',
    started_at: '2026-04-02T13:05:00.000Z',
    detail: 'Shrinking recent context before continuing the turn.',
  }, state.deps);

  expect(state.getAgentStatusState()).toEqual({
    chat_jid: 'chat:alpha',
    type: 'intent',
    title: 'Compacting context',
    intent_key: 'compaction',
    turn_id: 'turn-2',
    started_at: '2026-04-02T13:05:00.000Z',
    detail: 'Shrinking recent context before continuing the turn.',
  });
});

test('handleAppSseEvent applies a chat-scoped provider usage refresh without resetting model state', () => {
  const state = createDeps();
  const modelPayloads: unknown[] = [];
  state.deps.applyModelState = (payload) => modelPayloads.push(payload);

  handleAppSseEvent('model_changed', {
    chat_jid: 'chat:alpha',
    current: 'zai/glm-4',
    provider_usage: { provider: 'zai', plan: 'pro' },
  }, state.deps);
  handleAppSseEvent('model_changed', {
    chat_jid: 'chat:beta',
    current: 'zai/glm-4',
    provider_usage: { provider: 'zai', plan: 'enterprise' },
  }, state.deps);

  expect(modelPayloads).toEqual([{
    chat_jid: 'chat:alpha',
    current: 'zai/glm-4',
    provider_usage: { provider: 'zai', plan: 'pro' },
  }]);
});

test('handleAppSseEvent preserves cached context usage when model context refresh fails', async () => {
  const state = createDeps();
  const updates: any[] = [];
  state.deps.setContextUsage = (next) => {
    updates.push(typeof next === 'function' ? next(updates.at(-1)) : next);
  };
  state.deps.getAgentContext = async () => {
    throw new Error('network');
  };

  handleAppSseEvent('model_changed', {
    chat_jid: 'chat:alpha',
    current: 'gpt-5.4',
  }, state.deps);

  await new Promise((resolve) => setTimeout(resolve, 0));
  expect(updates).toEqual([]);
});

test('handleAppSseEvent maps extension notify events into intent toasts', () => {
  const state = createDeps();

  handleAppSseEvent('extension_ui_notify', {
    chat_jid: 'chat:alpha',
    message: 'Widget synced',
    type: 'success',
  }, state.deps);

  expect(state.getToastCalls()).toEqual([
    ['Widget synced', null, 'success', undefined],
  ]);
});

test('handleAppSseEvent resets context on a new session generation and rejects stale usage events', () => {
  const state = createDeps();
  const oldUsage = reconcileContextUsageForChat('chat:alpha', null, {
    tokens: 95000,
    contextWindow: 100000,
    percent: 95,
    sessionGeneration: 'session-old',
  }, { authoritative: true });
  state.setContextUsageState(oldUsage);

  handleAppSseEvent('agent_status', {
    chat_jid: 'chat:alpha',
    type: 'context_usage',
    context_reset: true,
    context_usage: {
      tokens: null,
      contextWindow: 100000,
      percent: null,
      sessionGeneration: 'session-new',
    },
  }, state.deps);
  expect(state.getContextUsageState()).toMatchObject({
    tokens: null,
    sessionGeneration: 'session-new',
  });

  handleAppSseEvent('agent_status', {
    chat_jid: 'chat:alpha',
    type: 'context_usage',
    context_usage: {
      tokens: 99000,
      contextWindow: 100000,
      percent: 99,
      sessionGeneration: 'session-old',
    },
  }, state.deps);
  expect(state.getContextUsageState()).toMatchObject({
    tokens: null,
    sessionGeneration: 'session-new',
  });
});

test('handleAppSseEvent accepts current-generation compaction context updates', () => {
  const state = createDeps();
  state.setContextUsageState(reconcileContextUsageForChat('chat:alpha', null, {
    tokens: 80000,
    contextWindow: 100000,
    percent: 80,
    sessionGeneration: 'session-current',
  }, { authoritative: true }));

  handleAppSseEvent('agent_status', {
    chat_jid: 'chat:alpha',
    type: 'context_usage',
    context_usage: {
      tokens: 25000,
      contextWindow: 100000,
      percent: 25,
      sessionGeneration: 'session-current',
      phase: 'after_manual_compaction',
    },
  }, state.deps);

  expect(state.getContextUsageState()).toMatchObject({
    tokens: 25000,
    percent: 25,
    sessionGeneration: 'session-current',
  });
});
