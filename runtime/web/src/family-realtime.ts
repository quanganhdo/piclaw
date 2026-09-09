import { handleAppSseEvent } from './ui/app-sse-events.js';

type Ref<T> = { current: T };
const ref = <T>(value: T): Ref<T> => ({ current: value });

export interface FamilyRealtimeSnapshot {
  agentStatus: any;
  agentDraft: any;
  agentPlan: any;
  agentThought: any;
  currentTurnId: string | null;
  queueItems: any[];
  connectionStatus: string;
}

/** Owner-pinned adapter around the shared production SSE reducer. */
export class FamilyRealtime {
  private source: EventSource | null = null;
  private stopped = false;
  private generation = 0;
  private eventRevision = 0;
  private state: FamilyRealtimeSnapshot = {
    agentStatus: null, agentDraft: { text: '', totalLines: 0 }, agentPlan: '', agentThought: { text: '', totalLines: 0 },
    currentTurnId: null, queueItems: [], connectionStatus: 'disconnected',
  };
  private readonly activeChatJidRef = ref('');
  private readonly currentTurnIdRef = ref<string | null>(null);
  private readonly pendingRequestRef = ref<any>(null);
  private readonly draftBufferRef = ref('');
  private readonly thoughtBufferRef = ref('');
  private readonly previewResyncPendingRef = ref(false);
  private readonly previewResyncGenerationRef = ref(0);
  private readonly steerQueuedTurnIdRef = ref<string | null>(null);
  private readonly thoughtExpandedRef = ref(false);
  private readonly draftExpandedRef = ref(false);
  private readonly draftThrottleRef = ref<any>(0);
  private readonly thoughtThrottleRef = ref<any>(0);
  private readonly viewStateRef = ref({});
  private readonly followupQueueItemsRef = ref<any[]>([]);
  private readonly dismissedQueueRowIdsRef = ref(new Set<string | number>());
  private readonly scrollToBottomRef = ref<(() => void) | null>(null);
  private readonly hasMoreRef = ref(false);
  private readonly loadMoreRef = ref<any>(null);
  private readonly lastAgentResponseRef = ref<any>(null);
  private readonly wasAgentActiveRef = ref(false);

  constructor(private readonly options: {
    sseUrl: (chatJid: string) => string;
    getStatus: (chatJid: string) => Promise<any>;
    getContext: (chatJid: string) => Promise<any>;
    refreshTimeline: () => Promise<void> | void;
    refreshQueue: () => Promise<void> | void;
    refreshDirectory: () => Promise<void> | void;
    setPosts: (next: any) => void;
    setContextUsage: (next: any) => void;
    applyModelState: (payload: any) => void;
    changed: (snapshot: FamilyRealtimeSnapshot) => void;
    invalidated: () => void;
    revalidate: (chatJid: string) => Promise<void>;
  }) {}

  start(chatJid: string): void {
    this.close(); this.stopped = false;
    this.state = { agentStatus: null, agentDraft: { text: '', totalLines: 0 }, agentPlan: '', agentThought: { text: '', totalLines: 0 }, currentTurnId: null, queueItems: [], connectionStatus: 'disconnected' };
    this.eventRevision += 1;
    this.draftBufferRef.current = ''; this.thoughtBufferRef.current = ''; this.currentTurnIdRef.current = null; this.followupQueueItemsRef.current = [];
    this.activeChatJidRef.current = chatJid;
    const generation = ++this.generation;
    const source = new EventSource(this.options.sseUrl(chatJid));
    this.source = source;
    source.onopen = () => {
      if (!this.current(source, generation)) return;
      this.patch({ connectionStatus: 'connected' });
      void this.options.revalidate(chatJid).catch((error: any) => {
        if (this.current(source, generation) && [401, 403, 409].includes(Number(error?.status))) this.options.invalidated();
      });
    };
    source.onerror = () => {
      if (!this.current(source, generation)) return;
      this.patch({ connectionStatus: 'disconnected' });
      void this.options.revalidate(chatJid).catch((error: any) => {
        if (this.current(source, generation) && [401, 403, 409].includes(Number(error?.status))) this.options.invalidated();
      });
    };
    for (const type of [
      'connected', 'new_post', 'new_reply', 'agent_response', 'interaction_updated', 'interaction_deleted',
      'agent_status', 'agent_steer_queued', 'agent_followup_queued', 'agent_followup_consumed',
      'agent_followup_removed', 'agent_draft', 'agent_draft_delta', 'agent_thought', 'agent_thought_delta',
      'agent_preview_consumed', 'model_changed',
    ]) source.addEventListener(type, event => {
      if (!this.current(source, generation)) return;
      let data: any; try { data = JSON.parse((event as MessageEvent).data); } catch { this.options.invalidated(); return; }
      if (data?.chat_jid !== chatJid) { this.options.invalidated(); return; }
      this.handle(type, data, chatJid);
    });
  }

  close(): void { this.generation++; this.source?.close(); this.source = null; }
  stop(): void {
    this.stopped = true; this.close(); this.clearRunState();
    this.state = { agentStatus: null, agentDraft: { text: '', totalLines: 0 }, agentPlan: '', agentThought: { text: '', totalLines: 0 }, currentTurnId: null, queueItems: [], connectionStatus: 'disconnected' };
    this.options.changed(this.state);
  }
  snapshot(): FamilyRealtimeSnapshot { return this.state; }
  revision(): number { return this.eventRevision; }
  applyServerSnapshot(agentState: any, queueItems: any[], expectedRevision = this.eventRevision): FamilyRealtimeSnapshot {
    if (expectedRevision !== this.eventRevision) return this.state;
    const active = agentState?.status === 'active' && agentState?.data ? agentState : null;
    this.state = {
      ...this.state,
      agentStatus: active?.data ?? (agentState?.data?.type === 'error' ? agentState.data : null),
      agentDraft: active?.draft ?? { text: '', totalLines: 0 },
      agentThought: active?.thought ?? { text: '', totalLines: 0 },
      currentTurnId: typeof active?.data?.turn_id === 'string' ? active.data.turn_id : null,
      queueItems: Array.isArray(queueItems) ? queueItems : [],
    };
    this.draftBufferRef.current = typeof this.state.agentDraft?.text === 'string' ? this.state.agentDraft.text : '';
    this.thoughtBufferRef.current = typeof this.state.agentThought?.text === 'string' ? this.state.agentThought.text : '';
    this.currentTurnIdRef.current = this.state.currentTurnId;
    this.followupQueueItemsRef.current = this.state.queueItems;
    this.options.changed(this.state);
    return this.state;
  }
  private current(source: EventSource, generation: number) { return !this.stopped && this.source === source && this.generation === generation; }
  private patch(value: Partial<FamilyRealtimeSnapshot>) {
    this.state = { ...this.state, ...value }; this.followupQueueItemsRef.current = this.state.queueItems;
    this.currentTurnIdRef.current = this.state.currentTurnId; this.options.changed(this.state);
  }
  private clearRunState = () => {
    this.currentTurnIdRef.current = null; this.pendingRequestRef.current = null;
    this.wasAgentActiveRef.current = false;
  };
  private handle(eventType: string, data: any, chatJid: string): void {
    this.eventRevision += 1;
    handleAppSseEvent(eventType, data, {
      currentChatJid: chatJid, updateAgentProfile: () => {}, updateUserProfile: () => {},
      currentTurnIdRef: this.currentTurnIdRef, activeChatJidRef: this.activeChatJidRef, pendingRequestRef: this.pendingRequestRef,
      draftBufferRef: this.draftBufferRef, thoughtBufferRef: this.thoughtBufferRef,
      previewResyncPendingRef: this.previewResyncPendingRef, previewResyncGenerationRef: this.previewResyncGenerationRef,
      steerQueuedTurnIdRef: this.steerQueuedTurnIdRef, thoughtExpandedRef: this.thoughtExpandedRef, draftExpandedRef: this.draftExpandedRef,
      draftThrottleRef: this.draftThrottleRef, thoughtThrottleRef: this.thoughtThrottleRef, viewStateRef: this.viewStateRef,
      followupQueueItemsRef: this.followupQueueItemsRef, dismissedQueueRowIdsRef: this.dismissedQueueRowIdsRef,
      scrollToBottomRef: this.scrollToBottomRef, hasMoreRef: this.hasMoreRef, loadMoreRef: this.loadMoreRef,
      lastAgentResponseRef: this.lastAgentResponseRef, wasAgentActiveRef: this.wasAgentActiveRef,
      setActiveTurn: value => this.patch({ currentTurnId: typeof value === 'string' ? value : null }),
      applyLiveGeneratedWidgetUpdate: () => {}, setFloatingWidget: () => {}, clearLastActivityFlag: () => {}, handleUiVersionDrift: () => false,
      setAgentStatus: value => this.setValue('agentStatus', value), setAgentDraft: value => this.setValue('agentDraft', value),
      setAgentPlan: value => this.setValue('agentPlan', value), setAgentThought: value => this.setValue('agentThought', value),
      setPendingRequest: () => {}, clearAgentRunState: this.clearRunState, getAgentStatus: this.options.getStatus,
      noteAgentActivity: () => {}, showLastActivity: () => {}, refreshTimeline: this.options.refreshTimeline,
      refreshModelAndQueueState: () => { void this.options.refreshQueue(); }, refreshActiveChatAgents: this.options.refreshDirectory,
      refreshCurrentChatBranches: this.options.refreshDirectory, notifyForFinalResponse: () => {}, setContextUsage: this.options.setContextUsage,
      refreshContextUsage: async () => { await this.options.getContext(chatJid); }, refreshQueueState: async () => { await this.options.refreshQueue(); },
      setFollowupQueueItems: value => this.setValue('queueItems', value), clearQueuedSteerStateIfStale: () => {}, setSteerQueuedTurnId: () => {},
      applyModelState: this.options.applyModelState, getAgentContext: this.options.getContext, setExtensionStatusPanels: () => {}, setPendingExtensionPanelActions: () => {},
      setExtensionWorkingState: () => {}, refreshActiveEditorFromWorkspace: async () => {}, showIntentToast: () => {}, removeStalledPost: () => {},
      setPosts: this.options.setPosts, preserveTimelineScrollTop: mutate => mutate(),
    });
    this.options.changed(this.state);
  }
  private setValue(key: keyof FamilyRealtimeSnapshot, value: any) {
    const previous = this.state[key]; const next = typeof value === 'function' ? value(previous) : value;
    this.patch({ [key]: next } as Partial<FamilyRealtimeSnapshot>);
  }
}
