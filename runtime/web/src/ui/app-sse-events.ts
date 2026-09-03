import { applyOutputPad, applyThemeFromEvent } from './theme.js';
import { applyMetersFromEvent } from './meters.js';
import {
  applyDraftDeltaBuffer,
  applyThoughtDeltaBuffer,
  buildAuthoritativeAgentPreviewState,
  mergeAgentPreviewSnapshot,
  resolveAgentPlanText,
} from './app-agent-previews.js';
import {
  resolveSteerQueuedTurnId,
  shouldAdoptIncomingTurn,
  shouldIgnoreMismatchedTurn,
} from './app-agent-turn-events.js';
import { readAgentTurnId, resolveAgentPreviewRestoreState } from './app-agent-status-refresh.js';
import { parseStatusLastEventAt } from './status-duration.js';
import { resolveLiveGeneratedWidgetEvent } from './app-generated-widget-events.js';
import {
  appendUniqueTimelinePost,
  isMainTimelineView,
  removeTimelinePostsByIds,
  replaceTimelinePostById,
  shouldAppendRealtimeTimelinePost,
  shouldMutateInteractionTimeline,
} from './app-realtime-timeline.js';
import { appendFollowupQueueItem, removeFollowupQueueRow } from './app-followup-queue.js';
import { resolveFollowupQueueRemovalPlan } from './app-followup-actions.js';
import {
  applyStatusPanelWidgetEvent,
  clearPendingPanelActionPrefix,
  shouldClearPendingPanelActions,
} from './app-extension-status.js';
import {
  applyExtensionUiWorkingState,
  resolveExtensionUiContextUsage,
  resolveExtensionUiToast,
  resolveStatusPanelWidgetEventContext,
} from './app-extension-ui-sse.js';
import { dispatchExtensionUiBrowserEvent, isExtensionUiEventType } from './extension-ui-events.js';
import { clearLiveFloatingWidgetState } from './app-floating-widget.js';
import {
  isNoisyAgentSseEvent,
  resolveSseEventRoutingContext,
} from './app-sse-event-routing.js';
import { isAppChatActivationRecent } from './app-refresh-coordination.js';
import {
  getContextSessionGeneration,
  haveSameContextUsage,
  normalizeContextUsage,
  persistContextUsage,
  reconcileContextUsageForChat,
} from './app-status-refresh-orchestration.js';

type StateSetter<T> = (next: T | ((prev: T) => T)) => void;

interface RefBox<T> {
  current: T;
}

// Preview SSE events can race the reconnect status snapshot. While a snapshot
// is pending, record that newer preview state exists and refetch until one
// snapshot completes without an intervening preview event. This avoids both
// dropped deltas and duplicate replay when the first snapshot already included
// an event that was in flight.
const dirtyPreviewResyncRefs = new WeakSet<object>();

interface PreviewTrailingFlushState {
  generation: number;
  draftTimer: ReturnType<typeof setTimeout> | null;
  thoughtTimer: ReturnType<typeof setTimeout> | null;
  draftSnapshot: { text: string; totalLines: unknown } | null;
  thoughtSnapshot: { text: string; totalLines: unknown } | null;
  draftDeltaActive: boolean;
  thoughtDeltaActive: boolean;
}

const previewTrailingFlushStates = new WeakMap<object, PreviewTrailingFlushState>();

function previewTrailingFlushState(key: object): PreviewTrailingFlushState {
  let state = previewTrailingFlushStates.get(key);
  if (!state) {
    state = {
      generation: 0,
      draftTimer: null,
      thoughtTimer: null,
      draftSnapshot: null,
      thoughtSnapshot: null,
      draftDeltaActive: false,
      thoughtDeltaActive: false,
    };
    previewTrailingFlushStates.set(key, state);
  }
  return state;
}

/** Cancel delayed preview writes when their owning chat/turn lifecycle ends. */
export function invalidateAppPreviewTrailingFlushes(key: object): void {
  const state = previewTrailingFlushState(key);
  state.generation += 1;
  if (state.draftTimer) clearTimeout(state.draftTimer);
  if (state.thoughtTimer) clearTimeout(state.thoughtTimer);
  state.draftTimer = null;
  state.thoughtTimer = null;
  state.draftSnapshot = null;
  state.thoughtSnapshot = null;
  state.draftDeltaActive = false;
  state.thoughtDeltaActive = false;
}

export interface HandleAppSseEventDependencies {
  currentChatJid: string;
  updateAgentProfile: (payload: any) => void;
  updateUserProfile: (payload: any) => void;

  currentTurnIdRef: RefBox<string | null>;
  activeChatJidRef: RefBox<string>;
  pendingRequestRef: RefBox<any>;
  draftBufferRef: RefBox<string>;
  thoughtBufferRef: RefBox<string>;
  previewResyncPendingRef: RefBox<boolean>;
  previewResyncGenerationRef: RefBox<number>;
  steerQueuedTurnIdRef: RefBox<string | null>;
  thoughtExpandedRef: RefBox<boolean>;
  draftExpandedRef: RefBox<boolean>;
  draftThrottleRef: RefBox<number>;
  thoughtThrottleRef: RefBox<number>;
  viewStateRef: RefBox<Record<string, unknown> | null | undefined>;
  followupQueueItemsRef: RefBox<any[]>;
  dismissedQueueRowIdsRef: RefBox<Set<string | number>>;
  scrollToBottomRef: RefBox<(() => void) | null>;
  hasMoreRef: RefBox<boolean>;
  loadMoreRef: RefBox<((options?: Record<string, unknown>) => void) | null>;
  lastAgentResponseRef: RefBox<{ post: any; turnId: string | null } | null>;
  wasAgentActiveRef: RefBox<boolean>;

  setActiveTurn: (turnId: string | null | undefined) => void;
  applyLiveGeneratedWidgetUpdate: (payload: any, fallbackStatus?: string) => void;
  setFloatingWidget: StateSetter<any>;
  clearLastActivityFlag: () => void;
  handleUiVersionDrift: (serverVersion: any) => boolean;
  setAgentStatus: StateSetter<any>;
  setAgentDraft: StateSetter<any>;
  setAgentPlan: StateSetter<any>;
  setAgentThought: StateSetter<any>;
  setPendingRequest: StateSetter<any>;
  clearAgentRunState: () => void;
  getAgentStatus: (chatJid: string) => Promise<any>;
  noteAgentActivity: (options?: Record<string, unknown>) => void;
  showLastActivity: (payload: any) => void;
  refreshTimeline: () => Promise<void> | void;
  refreshModelAndQueueState: () => void;
  refreshActiveChatAgents: () => Promise<unknown> | void;
  refreshCurrentChatBranches: () => Promise<unknown> | void;
  notifyForFinalResponse: (turnId: string | null | undefined) => void;
  setContextUsage: StateSetter<any>;
  refreshContextUsage: () => Promise<void> | void;
  refreshQueueState: () => Promise<void> | void;
  setFollowupQueueItems: StateSetter<any[]>;
  clearQueuedSteerStateIfStale: (remainingQueueCount: number) => void;
  setSteerQueuedTurnId: StateSetter<string | null>;
  applyModelState: (payload: any) => void;
  getAgentContext: (chatJid: string) => Promise<any>;
  setExtensionStatusPanels: StateSetter<Map<string, any>>;
  setPendingExtensionPanelActions: StateSetter<Set<string>>;
  setExtensionWorkingState: StateSetter<{ message: string | null; indicator: unknown | null }>;
  refreshActiveEditorFromWorkspace: (updates: any) => Promise<void> | void;
  showIntentToast: (title: string, detail?: string | null, kind?: string, durationMs?: number) => void;
  removeStalledPost: () => void;
  setPosts: StateSetter<any[] | null>;
  preserveTimelineScrollTop: (mutate: () => void) => void;
  openEditor?: (path: string, options?: { label?: string }) => void;
}

/**
 * Handles authenticated shell SSE events while keeping routing and payload semantics stable.
 */
export function handleAppSseEvent(
  eventType: string,
  data: any,
  deps: HandleAppSseEventDependencies,
): void {
  const {
    currentChatJid,
    updateAgentProfile,
    updateUserProfile,

    currentTurnIdRef,
    activeChatJidRef,
    pendingRequestRef,
    draftBufferRef,
    thoughtBufferRef,
    previewResyncPendingRef,
    previewResyncGenerationRef,
    steerQueuedTurnIdRef,
    thoughtExpandedRef,
    draftExpandedRef,
    draftThrottleRef,
    thoughtThrottleRef,
    viewStateRef,
    followupQueueItemsRef,
    dismissedQueueRowIdsRef,
    scrollToBottomRef,
    hasMoreRef,
    loadMoreRef,
    lastAgentResponseRef,
    wasAgentActiveRef,

    setActiveTurn,
    applyLiveGeneratedWidgetUpdate,
    setFloatingWidget,
    clearLastActivityFlag,
    handleUiVersionDrift,
    setAgentStatus,
    setAgentDraft,
    setAgentPlan,
    setAgentThought,
    setPendingRequest,
    clearAgentRunState,
    getAgentStatus,
    noteAgentActivity,
    showLastActivity,
    refreshTimeline,
    refreshModelAndQueueState,
    refreshActiveChatAgents,
    refreshCurrentChatBranches,
    notifyForFinalResponse,
    setContextUsage,
    refreshContextUsage,
    refreshQueueState,
    setFollowupQueueItems,
    clearQueuedSteerStateIfStale,
    setSteerQueuedTurnId,
    applyModelState,
    getAgentContext,
    setExtensionStatusPanels,
    setPendingExtensionPanelActions,
    setExtensionWorkingState,
    refreshActiveEditorFromWorkspace,
    showIntentToast,
    removeStalledPost,
    setPosts,
    preserveTimelineScrollTop,
    openEditor,
  } = deps;

  const cancelPanelTrailingFlush = (panel: 'draft' | 'thought') => {
    const state = previewTrailingFlushState(previewResyncGenerationRef);
    const timerKey = panel === 'draft' ? 'draftTimer' : 'thoughtTimer';
    if (state[timerKey]) clearTimeout(state[timerKey]);
    state[timerKey] = null;
  };

  const scheduleTrailingPreviewFlush = (
    panel: 'draft' | 'thought',
    lastRenderedAt: number,
    bufferRef: RefBox<string>,
    setter: StateSetter<any>,
  ) => {
    const state = previewTrailingFlushState(previewResyncGenerationRef);
    const timerKey = panel === 'draft' ? 'draftTimer' : 'thoughtTimer';
    if (state[timerKey]) clearTimeout(state[timerKey]);
    const generation = state.generation;
    const targetChatJid = currentChatJid;
    const targetTurnId = turnId || currentTurnIdRef.current;
    const delay = Math.max(0, 100 - Math.max(0, Date.now() - lastRenderedAt));
    state[timerKey] = setTimeout(() => {
      state[timerKey] = null;
      if (state.generation !== generation) return;
      if (activeChatJidRef.current !== targetChatJid) return;
      if (currentTurnIdRef.current !== targetTurnId) return;
      const fullText = bufferRef.current;
      const snapshotKey = panel === 'draft' ? 'draftSnapshot' : 'thoughtSnapshot';
      const snapshot = state[snapshotKey];
      state[snapshotKey] = null;
      setter((previous) => buildAuthoritativeAgentPreviewState(fullText, previous, snapshot
        ? { previewText: snapshot.text, totalLines: snapshot.totalLines }
        : undefined));
      if (panel === 'draft') draftThrottleRef.current = Date.now();
      else thoughtThrottleRef.current = Date.now();
    }, delay);
  };

  const flushAuthoritativePreviews = () => {
    cancelPanelTrailingFlush('draft');
    cancelPanelTrailingFlush('thought');
    const trailingState = previewTrailingFlushState(previewResyncGenerationRef);
    if (draftBufferRef.current) {
      const fullText = draftBufferRef.current;
      const snapshot = trailingState.draftSnapshot;
      trailingState.draftSnapshot = null;
      setAgentDraft((previous) => buildAuthoritativeAgentPreviewState(fullText, previous, snapshot
        ? { previewText: snapshot.text, totalLines: snapshot.totalLines }
        : undefined));
    }
    if (thoughtBufferRef.current) {
      const fullText = thoughtBufferRef.current;
      const snapshot = trailingState.thoughtSnapshot;
      trailingState.thoughtSnapshot = null;
      setAgentThought((previous) => buildAuthoritativeAgentPreviewState(fullText, previous, snapshot
        ? { previewText: snapshot.text, totalLines: snapshot.totalLines }
        : undefined));
    }
  };

  const clearPreviewState = () => {
    invalidateAppPreviewTrailingFlushes(previewResyncGenerationRef);
    draftBufferRef.current = '';
    thoughtBufferRef.current = '';
    setAgentDraft({ text: '', totalLines: 0 });
    setAgentPlan('');
    setAgentThought({ text: '', totalLines: 0 });
  };

  const consumeTextPreviews = () => {
    invalidateAppPreviewTrailingFlushes(previewResyncGenerationRef);
    draftBufferRef.current = '';
    thoughtBufferRef.current = '';
    setAgentDraft({ text: '', totalLines: 0 });
    setAgentThought({ text: '', totalLines: 0 });
  };

  const { turnId, isCurrentChatEvent } = resolveSseEventRoutingContext(eventType, data, currentChatJid);

  if (isCurrentChatEvent) {
    updateAgentProfile(data);
    updateUserProfile(data);
  }

  if (eventType === 'ui_theme') {
    applyThemeFromEvent(data);
    return;
  }

  if (eventType === 'ui_meters') {
    applyMetersFromEvent(data);
    return;
  }

  if (eventType === 'ui_open_tab') {
    const path = typeof data?.path === 'string' ? data.path.trim() : '';
    const label = typeof data?.label === 'string' ? data.label.trim() : undefined;
    if (path === 'piclaw://settings') {
      const section = typeof data?.section === 'string' ? data.section.trim() : '';
      window.dispatchEvent(new CustomEvent('piclaw:open-settings', {
        detail: section ? { section } : undefined,
      }));
      return;
    }
    if (path && typeof openEditor === 'function') {
      openEditor(path, label ? { label } : undefined);
    }
    return;
  }

  const liveWidgetEvent = resolveLiveGeneratedWidgetEvent(eventType);
  if (liveWidgetEvent.kind === 'update') {
    if (!isCurrentChatEvent) return;
    if (liveWidgetEvent.shouldAdoptTurn && shouldAdoptIncomingTurn(turnId, currentTurnIdRef.current)) {
      setActiveTurn(turnId);
    }
    applyLiveGeneratedWidgetUpdate(data, liveWidgetEvent.fallbackStatus || 'streaming');
    return;
  }

  if (liveWidgetEvent.kind === 'close') {
    if (!isCurrentChatEvent) return;
    setFloatingWidget((current) => clearLiveFloatingWidgetState(current, data));
    return;
  }

  if (eventType?.startsWith('agent_') && !isNoisyAgentSseEvent(eventType)) {
    clearLastActivityFlag();
  }

  if (eventType === 'connected') {
    invalidateAppPreviewTrailingFlushes(previewResyncGenerationRef);
    if (handleUiVersionDrift(data?.app_asset_version)) {
      return;
    }
    // Apply server-persisted theme on connect (instance-wide setting)
    if (data?.ui_theme) {
      const serverTheme = data.ui_theme.theme || 'default';
      const serverTint = data.ui_theme.tint || null;
      applyThemeFromEvent({ theme: serverTheme, tint: serverTint, outputPad: data?.ui_output?.outputPad ?? data?.ui_output?.output_pad });
    } else if (data?.ui_output) {
      applyOutputPad(data.ui_output.outputPad ?? data.ui_output.output_pad);
    }
    if (data?.ui_meters) {
      applyMetersFromEvent(data.ui_meters);
    }
    const resyncGeneration = previewResyncGenerationRef.current + 1;
    previewResyncGenerationRef.current = resyncGeneration;
    previewResyncPendingRef.current = true;
    dirtyPreviewResyncRefs.delete(previewResyncPendingRef);
    setAgentStatus(null);
    setExtensionWorkingState({ message: null, indicator: null, visible: true });
    setPendingRequest(null);
    pendingRequestRef.current = null;
    if (isAppChatActivationRecent(currentChatJid)) {
      if (previewResyncGenerationRef.current === resyncGeneration) {
        previewResyncPendingRef.current = false;
      }
      return;
    }

    const targetChatJid = currentChatJid;
    const applyStatusSnapshot = (response) => {
      if (activeChatJidRef.current !== targetChatJid) return;
      if (!response?.data) {
        clearPreviewState();
        clearAgentRunState();
        return;
      }

      const payload = response.data;
      if (payload.type === 'done' || payload.type === 'error') {
        // A terminal event may have landed while SSE was disconnected. The
        // connected handler already refreshes timeline/model state; refresh
        // context explicitly so session rotation completion is fully applied.
        clearPreviewState();
        clearAgentRunState();
        void refreshContextUsage();
        return;
      }
      if (response.status !== 'active') {
        clearPreviewState();
        clearAgentRunState();
        return;
      }
      const activeTurn = readAgentTurnId(payload);
      if (activeTurn) setActiveTurn(activeTurn);
      setAgentStatus(payload);
      noteAgentActivity({
        clearSilence: true,
        atMs: parseStatusLastEventAt(payload) ?? Date.now(),
      });
      showLastActivity(payload);

      const thoughtRestore = resolveAgentPreviewRestoreState(response.thought);
      if (thoughtRestore) {
        thoughtBufferRef.current = thoughtRestore.text;
        setAgentThought(thoughtRestore);
      }
      const draftRestore = resolveAgentPreviewRestoreState(response.draft);
      if (draftRestore) {
        draftBufferRef.current = draftRestore.text;
        setAgentDraft(draftRestore);
      }
    };
    void (async () => {
      try {
        do {
          dirtyPreviewResyncRefs.delete(previewResyncPendingRef);
          const response = await getAgentStatus(targetChatJid);
          if (previewResyncGenerationRef.current !== resyncGeneration) return;
          applyStatusSnapshot(response);
        } while (dirtyPreviewResyncRefs.has(previewResyncPendingRef));
      } catch (error) {
        console.warn('Failed to fetch agent status:', error);
      } finally {
        if (previewResyncGenerationRef.current === resyncGeneration) {
          previewResyncPendingRef.current = false;
          dirtyPreviewResyncRefs.delete(previewResyncPendingRef);
        }
      }
    })();

    if (isMainTimelineView(viewStateRef.current)) {
      void refreshTimeline();
    }
    refreshModelAndQueueState();
    return;
  }

  if (eventType === 'agent_status') {
    if (!isCurrentChatEvent) {
      const eventChatJid = typeof data?.chat_jid === 'string' ? data.chat_jid.trim() : '';
      const inactiveContextUsage = normalizeContextUsage(data?.context_usage);
      if (eventChatJid && data?.context_reset === true && inactiveContextUsage?.sessionGeneration) {
        const resetUsage = reconcileContextUsageForChat(eventChatJid, null, inactiveContextUsage, { reset: true });
        persistContextUsage(eventChatJid, resetUsage);
      }
      if (data?.type === 'done' || data?.type === 'error') {
        void refreshActiveChatAgents();
        void refreshCurrentChatBranches();
      }
      return;
    }

    const liveContextUsage = normalizeContextUsage(data.context_usage);
    if (liveContextUsage) {
      setContextUsage((prev) => {
        const merged = reconcileContextUsageForChat(currentChatJid, prev, liveContextUsage, {
          reset: data.context_reset === true,
        });
        if (haveSameContextUsage(prev, merged)) return prev;
        persistContextUsage(currentChatJid, merged);
        return merged;
      });
    }
    if (data.type === 'context_usage') {
      return;
    }

    if (data.type === 'done' || data.type === 'error') {
      if (shouldIgnoreMismatchedTurn(turnId, currentTurnIdRef.current)) {
        return;
      }
      flushAuthoritativePreviews();
      invalidateAppPreviewTrailingFlushes(previewResyncGenerationRef);
      if (data.type === 'done') {
        notifyForFinalResponse(turnId || currentTurnIdRef.current);
        if (isMainTimelineView(viewStateRef.current)) {
          void refreshTimeline();
        }
      }
      void refreshContextUsage();
      wasAgentActiveRef.current = false;
      clearAgentRunState();
      dismissedQueueRowIdsRef.current.clear();
      void refreshActiveChatAgents();
      refreshModelAndQueueState();
      setAgentDraft({ text: '', totalLines: 0 });
      setAgentPlan('');
      setAgentThought({ text: '', totalLines: 0 });
      setExtensionWorkingState({ message: null, indicator: null, visible: true });
      setPendingRequest(null);
      if (data.type === 'error') {
        setAgentStatus({ type: 'error', title: data.title || 'Agent error' });
        setTimeout(() => setAgentStatus(null), 8000);
      } else {
        setAgentStatus(null);
      }
    } else {
      if (turnId) setActiveTurn(turnId);
      noteAgentActivity({
        running: true,
        clearSilence: true,
        atMs: parseStatusLastEventAt(data) ?? Date.now(),
      });
      // Only the turn-opening status owns preview reset. Intra-turn model
      // phases (post-tool waiting, fresh reasoning, and drafting) must preserve
      // the accumulated panes until their typed preview events update them.
      if (data.type === 'thinking' && !data.phase) {
        invalidateAppPreviewTrailingFlushes(previewResyncGenerationRef);
        draftBufferRef.current = '';
        thoughtBufferRef.current = '';
        setAgentDraft({ text: '', totalLines: 0 });
        setAgentPlan('');
        setAgentThought({ text: '', totalLines: 0 });
      }
      setAgentStatus(data);
    }
    return;
  }

  if (eventType === 'agent_steer_queued') {
    if (!isCurrentChatEvent) return;
    if (shouldIgnoreMismatchedTurn(turnId, currentTurnIdRef.current)) {
      return;
    }
    const targetTurn = resolveSteerQueuedTurnId(turnId, currentTurnIdRef.current);
    if (!targetTurn) return;
    steerQueuedTurnIdRef.current = targetTurn;
    setSteerQueuedTurnId(targetTurn);
    return;
  }

  if (eventType === 'agent_followup_queued') {
    if (!isCurrentChatEvent) return;
    setFollowupQueueItems((current) => appendFollowupQueueItem(current, data));
    void refreshQueueState();
    return;
  }

  if (eventType === 'agent_followup_consumed') {
    if (!isCurrentChatEvent) return;
    const optimisticRemoval = resolveFollowupQueueRemovalPlan(followupQueueItemsRef.current, data);
    if (optimisticRemoval) {
      clearQueuedSteerStateIfStale(optimisticRemoval.remainingQueueCount);
      setFollowupQueueItems((current) => removeFollowupQueueRow(current, optimisticRemoval.rowId).items);
    }
    void refreshQueueState();
    if (isMainTimelineView(viewStateRef.current)) {
      void refreshTimeline();
    }
    return;
  }

  if (eventType === 'agent_followup_removed') {
    if (!isCurrentChatEvent) return;
    const optimisticRemoval = resolveFollowupQueueRemovalPlan(followupQueueItemsRef.current, data);
    if (optimisticRemoval) {
      dismissedQueueRowIdsRef.current.add(optimisticRemoval.rowId);
      clearQueuedSteerStateIfStale(optimisticRemoval.remainingQueueCount);
      setFollowupQueueItems((current) => removeFollowupQueueRow(current, optimisticRemoval.rowId).items);
    }
    void refreshQueueState();
    return;
  }

  if (eventType === 'agent_preview_consumed') {
    if (!isCurrentChatEvent) return;
    if (shouldIgnoreMismatchedTurn(turnId, currentTurnIdRef.current)) return;
    if (previewResyncPendingRef.current) {
      dirtyPreviewResyncRefs.add(previewResyncPendingRef);
    }
    consumeTextPreviews();
    return;
  }

  if (eventType === 'agent_draft_delta') {
    if (!isCurrentChatEvent) return;
    if (previewResyncPendingRef.current) {
      dirtyPreviewResyncRefs.add(previewResyncPendingRef);
      return;
    }
    if (shouldIgnoreMismatchedTurn(turnId, currentTurnIdRef.current)) {
      return;
    }
    if (shouldAdoptIncomingTurn(turnId, currentTurnIdRef.current)) {
      setActiveTurn(turnId);
    }
    noteAgentActivity({ running: true, clearSilence: true });
    draftBufferRef.current = applyDraftDeltaBuffer(draftBufferRef.current, data);
    const now = Date.now();
    const trailingState = previewTrailingFlushState(previewResyncGenerationRef);
    if (data.reset) {
      cancelPanelTrailingFlush('draft');
      trailingState.draftSnapshot = null;
    }
    trailingState.draftDeltaActive = true;
    if (data.reset || !draftThrottleRef.current || now - draftThrottleRef.current >= 100) {
      cancelPanelTrailingFlush('draft');
      draftThrottleRef.current = now;
      const fullText = draftBufferRef.current;
      const snapshot = trailingState.draftSnapshot;
      trailingState.draftSnapshot = null;
      setAgentDraft((previous) => buildAuthoritativeAgentPreviewState(fullText, previous, snapshot
        ? { previewText: snapshot.text, totalLines: snapshot.totalLines }
        : undefined));
    } else {
      scheduleTrailingPreviewFlush('draft', draftThrottleRef.current, draftBufferRef, setAgentDraft);
    }
    return;
  }

  if (eventType === 'agent_draft') {
    if (!isCurrentChatEvent) return;
    if (previewResyncPendingRef.current) {
      dirtyPreviewResyncRefs.add(previewResyncPendingRef);
      return;
    }
    if (shouldIgnoreMismatchedTurn(turnId, currentTurnIdRef.current)) {
      return;
    }
    if (shouldAdoptIncomingTurn(turnId, currentTurnIdRef.current)) {
      setActiveTurn(turnId);
    }
    noteAgentActivity({ running: true, clearSilence: true });
    const text = data.text || '';
    const mode = data.mode || (data.kind === 'plan' ? 'replace' : 'append');

    if (data.kind === 'plan') {
      setAgentPlan((prev) => resolveAgentPlanText(prev, text, mode));
    } else if (!draftExpandedRef.current) {
      const trailingState = previewTrailingFlushState(previewResyncGenerationRef);
      if (trailingState.draftDeltaActive) {
        trailingState.draftSnapshot = { text, totalLines: data.total_lines };
      } else {
        // Snapshot-only/legacy delivery still renders immediately.
        setAgentDraft((previous) => mergeAgentPreviewSnapshot(text, data.total_lines, '', previous));
      }
    }
    return;
  }

  if (eventType === 'agent_thought_delta') {
    if (!isCurrentChatEvent) return;
    if (previewResyncPendingRef.current) {
      dirtyPreviewResyncRefs.add(previewResyncPendingRef);
      return;
    }
    if (shouldIgnoreMismatchedTurn(turnId, currentTurnIdRef.current)) {
      return;
    }
    if (shouldAdoptIncomingTurn(turnId, currentTurnIdRef.current)) {
      setActiveTurn(turnId);
    }
    noteAgentActivity({ running: true, clearSilence: true });
    thoughtBufferRef.current = applyThoughtDeltaBuffer(thoughtBufferRef.current, data);
    const now = Date.now();
    const trailingState = previewTrailingFlushState(previewResyncGenerationRef);
    if (data.reset) {
      cancelPanelTrailingFlush('thought');
      trailingState.thoughtSnapshot = null;
    }
    trailingState.thoughtDeltaActive = true;
    if (data.reset || !thoughtThrottleRef.current || now - thoughtThrottleRef.current >= 100) {
      cancelPanelTrailingFlush('thought');
      thoughtThrottleRef.current = now;
      const fullText = thoughtBufferRef.current;
      const snapshot = trailingState.thoughtSnapshot;
      trailingState.thoughtSnapshot = null;
      setAgentThought((previous) => buildAuthoritativeAgentPreviewState(fullText, previous, snapshot
        ? { previewText: snapshot.text, totalLines: snapshot.totalLines }
        : undefined));
    } else {
      scheduleTrailingPreviewFlush('thought', thoughtThrottleRef.current, thoughtBufferRef, setAgentThought);
    }
    return;
  }

  if (eventType === 'agent_thought') {
    if (!isCurrentChatEvent) return;
    if (previewResyncPendingRef.current) {
      dirtyPreviewResyncRefs.add(previewResyncPendingRef);
      return;
    }
    if (shouldIgnoreMismatchedTurn(turnId, currentTurnIdRef.current)) {
      return;
    }
    if (shouldAdoptIncomingTurn(turnId, currentTurnIdRef.current)) {
      setActiveTurn(turnId);
    }
    noteAgentActivity({ running: true, clearSilence: true });
    const text = data.text || '';
    if (!thoughtExpandedRef.current) {
      const trailingState = previewTrailingFlushState(previewResyncGenerationRef);
      if (trailingState.thoughtDeltaActive) {
        trailingState.thoughtSnapshot = { text, totalLines: data.total_lines };
      } else {
        setAgentThought((previous) => mergeAgentPreviewSnapshot(text, data.total_lines, '', previous));
      }
    }
    return;
  }

  if (eventType === 'model_changed') {
    if (!isCurrentChatEvent) return;
    applyModelState(data);
    const targetChatJid = currentChatJid;
    const expectedSessionGeneration = getContextSessionGeneration(targetChatJid);
    getAgentContext(targetChatJid)
      .then((contextPayload) => {
        if (activeChatJidRef.current !== targetChatJid) return;
        const nextContextUsage = normalizeContextUsage(contextPayload);
        setContextUsage((prev) => {
          const merged = reconcileContextUsageForChat(targetChatJid, prev, nextContextUsage, {
            authoritative: true,
            expectedSessionGeneration,
          });
          if (haveSameContextUsage(prev, merged)) return prev;
          persistContextUsage(targetChatJid, merged);
          return merged;
        });
      })
      .catch(() => {
        if (activeChatJidRef.current !== targetChatJid) return;
      });
    return;
  }

  const statusPanelWidgetEvent = resolveStatusPanelWidgetEventContext(eventType, data, currentChatJid);
  if (statusPanelWidgetEvent.isStatusPanelWidgetEvent) {
    if (statusPanelWidgetEvent.eventChatJid !== currentChatJid) return;
    if (!statusPanelWidgetEvent.panelKey) return;
    setExtensionStatusPanels((prev) => applyStatusPanelWidgetEvent(prev, data));
    if (shouldClearPendingPanelActions(data)) {
      setPendingExtensionPanelActions((prev) => clearPendingPanelActionPrefix(prev, statusPanelWidgetEvent.panelKey));
    }
    dispatchExtensionUiBrowserEvent(eventType, data);
    return;
  }

  if (eventType === 'workspace_update') {
    if (typeof window !== 'undefined') {
      window.dispatchEvent(new CustomEvent('workspace-update', { detail: data }));
    }
    void refreshActiveEditorFromWorkspace(data?.updates);
    return;
  }

  if (isExtensionUiEventType(eventType)) {
    // Session/branch name changes should refresh lists for ALL clients,
    // not just the one viewing that specific chat.
    if (eventType === 'extension_ui_title') {
      void refreshActiveChatAgents();
      void refreshCurrentChatBranches();
      dispatchExtensionUiBrowserEvent(eventType, data);
      return;
    }

    if (!isCurrentChatEvent) return;

    const extensionContextUsage = resolveExtensionUiContextUsage(eventType, data);
    if (extensionContextUsage) {
      setContextUsage((prev) => {
        const merged = reconcileContextUsageForChat(currentChatJid, prev, extensionContextUsage);
        return haveSameContextUsage(prev, merged) ? prev : merged;
      });
    }

    setExtensionWorkingState((previous) => {
      const next = applyExtensionUiWorkingState(previous, eventType, data);
      return next ?? previous;
    });

    dispatchExtensionUiBrowserEvent(eventType, data);
    const toast = resolveExtensionUiToast(eventType, data);
    if (toast) {
      showIntentToast(toast.title, toast.detail, toast.kind, toast.durationMs);
    }
    return;
  }

  const onMainTimeline = isMainTimelineView(viewStateRef.current);
  if (eventType === 'agent_response') {
    if (!isCurrentChatEvent) return;
    flushAuthoritativePreviews();
    invalidateAppPreviewTrailingFlushes(previewResyncGenerationRef);
    setExtensionWorkingState({ message: null, indicator: null, visible: true });
    removeStalledPost();
    lastAgentResponseRef.current = {
      post: data,
      turnId: currentTurnIdRef.current,
    };
  }
  if (shouldAppendRealtimeTimelinePost(eventType, isCurrentChatEvent, onMainTimeline)) {
    setPosts((prev) => appendUniqueTimelinePost(prev, data));
    scrollToBottomRef.current?.();
  }
  if (eventType === 'interaction_updated') {
    if (!shouldMutateInteractionTimeline(isCurrentChatEvent, onMainTimeline)) return;
    setPosts((prev) => replaceTimelinePostById(prev, data));
  }
  if (eventType === 'interaction_deleted') {
    if (!shouldMutateInteractionTimeline(isCurrentChatEvent, onMainTimeline)) return;
    const ids = data?.ids || [];
    if (ids.length) {
      preserveTimelineScrollTop(() => {
        setPosts((prev) => removeTimelinePostsByIds(prev, ids));
      });
      if (hasMoreRef.current) {
        loadMoreRef.current?.({ preserveScroll: true, preserveMode: 'top' });
      }
    }
  }
}
