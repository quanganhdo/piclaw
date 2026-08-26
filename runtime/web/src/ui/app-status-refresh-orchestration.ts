import {
  applyAutoresearchStatusPayload,
  clearPendingPanelActionPrefix,
} from './app-extension-status.js';
import {
  haveSameFollowupQueueRows,
  normalizeFollowupQueueItems,
  type FollowupQueueItemLike,
} from './app-followup-queue.js';
import { isMainTimelineView } from './app-realtime-timeline.js';
import { getLocalStorageJSON, setLocalStorageItem } from '../utils/storage.js';

type StateSetter<T> = (next: T | ((prev: T) => T)) => void;

const CONTEXT_STORAGE_PREFIX = 'piclaw:ctx:';

function finiteOrNull(value: unknown): number | null {
  if (value == null) return null;
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : null;
}

function stringOrNull(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}

function booleanOrNull(value: unknown): boolean | null {
  return typeof value === 'boolean' ? value : null;
}

function normalizeCostCoverage(payload: unknown): Record<string, number | null> | null {
  if (!payload || typeof payload !== 'object') return null;
  const data = payload as Record<string, unknown>;
  return {
    providerReportedRuns: finiteOrNull(data.providerReportedRuns),
    catalogueEstimateRuns: finiteOrNull(data.catalogueEstimateRuns),
    unavailableRuns: finiteOrNull(data.unavailableRuns),
    legacyRuns: finiteOrNull(data.legacyRuns),
  };
}

function normalizeTokenUsageRecord(payload: unknown): Record<string, unknown> | null {
  if (!payload || typeof payload !== 'object') return null;
  const data = payload as Record<string, unknown>;
  const costCoverage = normalizeCostCoverage(data.costCoverage);
  return {
    inputTokens: finiteOrNull(data.inputTokens),
    outputTokens: finiteOrNull(data.outputTokens),
    reasoningTokens: finiteOrNull(data.reasoningTokens),
    cacheReadTokens: finiteOrNull(data.cacheReadTokens),
    cacheWriteTokens: finiteOrNull(data.cacheWriteTokens),
    cacheReadReported: booleanOrNull(data.cacheReadReported),
    cacheWriteReported: booleanOrNull(data.cacheWriteReported),
    totalTokens: finiteOrNull(data.totalTokens),
    costTotal: finiteOrNull(data.costTotal),
    providerCostTotal: finiteOrNull(data.providerCostTotal),
    catalogueCostTotal: finiteOrNull(data.catalogueCostTotal),
    costProvenance: stringOrNull(data.costProvenance),
    runs: finiteOrNull(data.runs),
    cacheHitRate: finiteOrNull(data.cacheHitRate),
    model: stringOrNull(data.model),
    responseModel: stringOrNull(data.responseModel),
    provider: stringOrNull(data.provider),
    api: stringOrNull(data.api),
    turns: finiteOrNull(data.turns),
    runAt: stringOrNull(data.runAt),
    ...(costCoverage ? { costCoverage } : {}),
  };
}

function normalizeCacheUsage(payload: unknown): Record<string, unknown> | null {
  if (!payload || typeof payload !== 'object') return null;
  const data = payload as Record<string, unknown>;
  const latest = normalizeTokenUsageRecord(data.latest);
  const totals = normalizeTokenUsageRecord(data.totals);
  return latest || totals ? { latest, totals } : null;
}

export function normalizeContextUsage(payload: unknown): Record<string, unknown> | null {
  if (!payload || typeof payload !== 'object') return null;
  const data = payload as Record<string, unknown>;
  const tokens = finiteOrNull(data.tokens);
  const contextWindow = finiteOrNull(data.contextWindow);
  const percent = finiteOrNull(data.percent);
  const cacheUsage = normalizeCacheUsage(data.cacheUsage);
  return {
    tokens,
    contextWindow,
    percent,
    cacheUsage,
  };
}

export function mergeContextUsage(previous: unknown, incoming: unknown): Record<string, unknown> | null {
  const next = normalizeContextUsage(incoming);
  if (!next) return normalizeContextUsage(previous);
  const prev = normalizeContextUsage(previous);
  return {
    tokens: next.tokens ?? prev?.tokens ?? null,
    contextWindow: next.contextWindow ?? prev?.contextWindow ?? null,
    percent: next.percent ?? prev?.percent ?? null,
    cacheUsage: next.cacheUsage ?? prev?.cacheUsage ?? null,
  };
}

export function haveSameContextUsage(a: unknown, b: unknown): boolean {
  const left = normalizeContextUsage(a);
  const right = normalizeContextUsage(b);
  if (!left && !right) return true;
  if (!left || !right) return false;
  return left.tokens === right.tokens
    && left.contextWindow === right.contextWindow
    && left.percent === right.percent
    && JSON.stringify(left.cacheUsage ?? null) === JSON.stringify(right.cacheUsage ?? null);
}

export function hasRenderableContextUsage(payload: unknown): boolean {
  const normalized = normalizeContextUsage(payload);
  return Boolean(normalized && (normalized.percent != null || normalized.cacheUsage != null));
}

export function persistContextUsage(chatJid: string, payload: unknown): void {
  if (!chatJid || !payload || typeof payload !== 'object') return;
  const data = payload as Record<string, unknown>;
  if (data.percent == null && data.cacheUsage == null) return;
  try {
    setLocalStorageItem(CONTEXT_STORAGE_PREFIX + chatJid, JSON.stringify(payload));
  } catch (error) {
    console.debug('[app-status-refresh] Ignoring best-effort context usage persistence failure.', error, {
      chatJid,
    });
  }
}

export function restoreContextUsage(chatJid: string): Record<string, unknown> | null {
  if (!chatJid) return null;
  return getLocalStorageJSON<Record<string, unknown>>(CONTEXT_STORAGE_PREFIX + chatJid);
}


interface RefBox<T> {
  current: T;
}

export interface RefreshQueueStateForChatOptions<TItem extends FollowupQueueItemLike = FollowupQueueItemLike> {
  currentChatJid: string;
  queueRefreshGenRef: RefBox<number>;
  activeChatJidRef: RefBox<string>;
  dismissedQueueRowIdsRef: RefBox<Set<string | number>>;
  getAgentQueueState: (chatJid: string) => Promise<{ items?: TItem[] | null | undefined }>;
  setFollowupQueueItems: StateSetter<TItem[]>;
  clearQueuedSteerStateIfStale: (remainingQueueCount: number) => void;
}

/**
 * Refresh follow-up queue state for the active chat, dropping stale responses.
 */
export async function refreshQueueStateForChat<TItem extends FollowupQueueItemLike = FollowupQueueItemLike>(
  options: RefreshQueueStateForChatOptions<TItem>,
): Promise<void> {
  const {
    currentChatJid,
    queueRefreshGenRef,
    activeChatJidRef,
    dismissedQueueRowIdsRef,
    getAgentQueueState,
    setFollowupQueueItems,
    clearQueuedSteerStateIfStale,
  } = options;

  const gen = ++queueRefreshGenRef.current;
  const targetChatJid = currentChatJid;

  try {
    const payload = await getAgentQueueState(targetChatJid);
    if (gen !== queueRefreshGenRef.current) return;
    if (activeChatJidRef.current !== targetChatJid) return;

    const dismissed = dismissedQueueRowIdsRef.current;
    const rawItems = Array.isArray(payload?.items) ? payload.items : [];
    const items = normalizeFollowupQueueItems(rawItems, dismissed);
    if (items.length) {
      setFollowupQueueItems((prev) => (haveSameFollowupQueueRows(prev, items) ? prev : items));
      return;
    }

    if (rawItems.length > 0) {
      return;
    }

    dismissed.clear();
    clearQueuedSteerStateIfStale(0);
    setFollowupQueueItems((prev) => (prev.length === 0 ? prev : []));
  } catch {
    if (gen !== queueRefreshGenRef.current) return;
    if (activeChatJidRef.current !== targetChatJid) return;
    setFollowupQueueItems((prev) => (prev.length === 0 ? prev : []));
  }
}

export interface RefreshContextUsageForChatOptions {
  currentChatJid: string;
  activeChatJidRef: RefBox<string>;
  getAgentContext: (chatJid: string) => Promise<any>;
  setContextUsage: StateSetter<any>;
}

/** Best-effort context usage refresh tied to the currently active chat. */
export async function refreshContextUsageForChat(options: RefreshContextUsageForChatOptions): Promise<void> {
  const {
    currentChatJid,
    activeChatJidRef,
    getAgentContext,
    setContextUsage,
  } = options;

  const targetChatJid = currentChatJid;
  try {
    const contextPayload = normalizeContextUsage(await getAgentContext(targetChatJid));
    if (activeChatJidRef.current !== targetChatJid) return;
    // Only update state when the server returns meaningful context/cache data.
    // After a reload or for inactive chats, the API may return empty context
    // metrics; keep restored localStorage values unless token cache telemetry
    // is available.
    if (hasRenderableContextUsage(contextPayload)) {
      setContextUsage((prev: unknown) => {
        const merged = mergeContextUsage(prev, contextPayload);
        if (!hasRenderableContextUsage(merged) || haveSameContextUsage(prev, merged)) return prev;
        persistContextUsage(targetChatJid, merged);
        return merged;
      });
    }
  } catch (error) {
    if (activeChatJidRef.current !== targetChatJid) return;
    console.warn('Failed to fetch agent context:', error);
  }
}

export interface RefreshAutoresearchStatusForChatOptions {
  currentChatJid: string;
  activeChatJidRef: RefBox<string>;
  getAutoresearchStatus: (chatJid: string) => Promise<any>;
  setExtensionStatusPanels: StateSetter<Map<any, any>>;
  setPendingExtensionPanelActions: StateSetter<Set<string>>;
}

/** Best-effort autoresearch panel refresh tied to the currently active chat. */
export async function refreshAutoresearchStatusForChat(options: RefreshAutoresearchStatusForChatOptions): Promise<void> {
  const {
    currentChatJid,
    activeChatJidRef,
    getAutoresearchStatus,
    setExtensionStatusPanels,
    setPendingExtensionPanelActions,
  } = options;

  const targetChatJid = currentChatJid;
  try {
    const payload = await getAutoresearchStatus(targetChatJid);
    if (activeChatJidRef.current !== targetChatJid) return;
    setExtensionStatusPanels((prev) => applyAutoresearchStatusPayload(prev, payload));
    setPendingExtensionPanelActions((prev) => clearPendingPanelActionPrefix(prev, 'autoresearch'));
  } catch (error) {
    if (activeChatJidRef.current !== targetChatJid) return;
    console.warn('Failed to fetch autoresearch status:', error);
  }
}

export interface RefreshModelAndQueueStateOptions {
  refreshModelState: () => void;
  refreshActiveChatAgents: () => void;
  refreshCurrentChatBranches: () => void;
  refreshQueueState: () => void;
  refreshContextUsage: () => Promise<void> | void;
  refreshAutoresearchStatus: () => Promise<void> | void;
}

/** Run the standard model/queue/status refresh bundle used on connect/wake. */
export function refreshModelAndQueueState(options: RefreshModelAndQueueStateOptions): void {
  const {
    refreshModelState,
    refreshActiveChatAgents,
    refreshCurrentChatBranches,
    refreshQueueState,
    refreshContextUsage,
    refreshAutoresearchStatus,
  } = options;

  refreshModelState();
  refreshActiveChatAgents();
  refreshCurrentChatBranches();
  refreshQueueState();
  void refreshContextUsage();
  void refreshAutoresearchStatus();
}

export interface RefreshCurrentViewOptions {
  viewStateRef: RefBox<Record<string, unknown> | null | undefined>;
  refreshTimeline: () => Promise<void> | void;
  refreshModelAndQueueState: () => void;
}

/**
 * Refresh the current view and status panels without disturbing search/hashtag modes.
 */
export function refreshCurrentView(options: RefreshCurrentViewOptions): void {
  const {
    viewStateRef,
    refreshTimeline,
    refreshModelAndQueueState: refreshModelAndQueueStateFn,
  } = options;

  const onMainTimeline = isMainTimelineView(viewStateRef.current);
  if (onMainTimeline) {
    void refreshTimeline();
  }
  refreshModelAndQueueStateFn();
}
