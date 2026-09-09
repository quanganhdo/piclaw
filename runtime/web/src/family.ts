import { FamilyApi, fetchFamilyIdentity, prepareFamilyBrowser } from './family-api.js';
import { FamilyAccount } from './family-account.js';
import { FamilySessions } from './family-sessions.js';
import { FamilyAdministration } from './family-administration.js';
import { FamilyWorkspace } from './family-workspace.js';
import { FamilyPreferences } from './family-preferences.js';
import { FamilyResults } from './family-results.js';
import { FamilyTasks } from './family-tasks.js';
import { FamilyMemory } from './family-memory.js';
import { FamilyNotifications } from './family-notifications.js';
import { initialiseFamilyPanelNavigation } from './family-panel-navigation.js';
import { FamilyChatSurface, type FamilyChatDirectoryEntry } from './family-chat-surface.js';
import { FamilyRealtime } from './family-realtime.js';

function element<T extends HTMLElement>(id: string): T {
  const value = document.getElementById(id);
  if (!value) throw new Error(`Missing family shell element: ${id}`);
  return value as T;
}
const account = element<HTMLElement>('account-name'), modeBadge = element<HTMLElement>('deployment-mode');
const status = element<HTMLElement>('family-status'), error = element<HTMLElement>('family-error');
const home = element<HTMLButtonElement>('go-home'), refresh = element<HTMLButtonElement>('refresh'), logout = element<HTMLButtonElement>('sign-out');
const switchAccount = element<HTMLAnchorElement>('switch-account'), notify = element<HTMLButtonElement>('toggle-notifications');
const recovery = element<HTMLElement>('message-recovery'), recoveryStatus = element<HTMLElement>('recovery-status'), recoveryActions = element<HTMLElement>('recovery-actions');
const retry = element<HTMLButtonElement>('retry-message'), skip = element<HTMLButtonElement>('skip-message'), confirmSkip = element<HTMLInputElement>('confirm-skip');
const panelNavigation = initialiseFamilyPanelNavigation();
let heldRow: number | null = null;
let legacyHeld = false;
let recoveryRequest: { row: number; action: 'retry' | 'skip' | 'dismiss-legacy'; requestId: string } | null = null;
let api: FamilyApi | null = null, current = '', stopped = false, busy = false, paused = false, generation = 0;
let settings: FamilyAccount | null = null;
let sessionSettings: FamilySessions | null = null;
let administration: FamilyAdministration | null = null;
let workspacePolicy: FamilyWorkspace | null = null;
let preferences: FamilyPreferences | null = null;
let results: FamilyResults | null = null;
let tasks: FamilyTasks | null = null;
let memory: FamilyMemory | null = null;
let notifications: FamilyNotifications | null = null;
let chatSurface: FamilyChatSurface | null = null;
let realtime: FamilyRealtime | null = null;
let directory: FamilyChatDirectoryEntry[] = [];
let directoryGeneration = 0;
let refreshing: symbol | null = null;

function controls(enabled: boolean): void {
  panelNavigation.setLocked(busy);
  tasks?.setExecutionBlocked(busy);
  memory?.setBlocked(busy);
  home.disabled = refresh.disabled = !enabled;
  retry.disabled = !enabled || heldRow === null || legacyHeld;
  confirmSkip.disabled = !enabled || heldRow === null;
  skip.disabled = !enabled || heldRow === null || !confirmSkip.checked;
  notify.disabled = !enabled || !notifications?.state().available;
  chatSurface?.update({ enabled });
}
function mask(options: { preserveComposeDraft?: boolean } = {}): void {
  // Backgrounded tabs retain no visible conversation/draft until the cookie is revalidated.
  generation++; refreshing = null; account.textContent = ''; modeBadge.textContent = ''; modeBadge.hidden = true; status.textContent = ''; error.textContent = '';
  directoryGeneration++; directory = [];
  confirmSkip.checked = false;
  element('recovery-warning').textContent = ''; recoveryStatus.textContent = '';
  recovery.hidden = true; chatSurface?.clear(options); controls(false);
  realtime?.close();
  settings?.suspend(); element<HTMLButtonElement>('open-account').disabled = true;
  sessionSettings?.suspend(); element<HTMLButtonElement>('open-sessions').disabled = true;
  administration?.suspend(); workspacePolicy?.suspend(); preferences?.suspend(); results?.suspend(); tasks?.suspend(); memory?.suspend();
  notifications?.suspend(); notify.disabled = true;
}
function invalidate(): void {
  if (stopped) return;
  stopped = true; mask(); api?.stop(); chatSurface?.stop();
  realtime?.stop();
  settings?.stop(); sessionSettings?.stop(); administration?.stop(); workspacePolicy?.stop(); preferences?.stop(); results?.stop(); tasks?.stop(); memory?.stop(); notifications?.stop();
  directory = []; heldRow = null; recoveryRequest = null; confirmSkip.checked = false; recoveryStatus.textContent = ''; logout.disabled = true;
  status.textContent = 'This page is no longer bound to its original account.';
  error.textContent = 'Sign in again or reload. No previous conversation or draft is retained.';
}
function renderRecovery(value: any): void {
  if (!['idle', 'working', 'queued', 'held', 'legacy-held', 'blocked'].includes(value?.state)
    || (['held','legacy-held'].includes(value.state) && (!Number.isSafeInteger(value.message_rowid) || value.message_rowid <= 0))) throw new Error('Invalid recovery response.');
  const next = ['held','legacy-held'].includes(value.state) ? value.message_rowid : null;
  if (heldRow !== next || legacyHeld !== (value.state==='legacy-held')) { recoveryRequest = null; confirmSkip.checked = false; }
  legacyHeld = value.state==='legacy-held'; retry.hidden = legacyHeld;
  skip.textContent = legacyHeld ? 'Dismiss legacy input without running' : 'Skip held message';
  element('recovery-warning').textContent = legacyHeld ? 'This migrated input has no current execution authority. Dismiss it to unblock the queue; review its history and send a new plain-text prompt if you want it to run. Original content and authorship stay unchanged. A sign-in within five minutes is required.' : 'Retry or skip requires a sign-in within the last five minutes. Skipping leaves the message in history but prevents execution.';
  heldRow = next; recovery.hidden = value.state === 'idle'; recoveryActions.hidden = heldRow === null;
  recoveryStatus.textContent = legacyHeld ? `Legacy input ${heldRow} is held by migration and cannot be retried.` : value.state === 'held' ? `Input ${heldRow} is held. Choose whether to retry or skip.`
    : value.state === 'blocked' ? 'Recovery is blocked. Ask the operator to inspect the stored input.'
    : value.state === 'working' ? 'A message is running.' : value.state === 'queued' ? 'A message is queued.' : '';
}
async function loadTimeline(): Promise<void> {
  if (!api || stopped || !current || refreshing || busy || paused || document.hidden) return;
  const flight = Symbol(), expected = ++generation, target = current, realtimeRevision = realtime?.revision() ?? 0; refreshing = flight;
  try {
    const [result, recoveryState, preferenceState, modelState, agentState, contextUsage, queueState] = await Promise.all([
      api.request(`/timeline?chat_jid=${encodeURIComponent(target)}&limit=100`),
      api.request(`/agent/message-recovery?chat_jid=${encodeURIComponent(target)}`),
      api.request('/account/preferences'),
      api.request(`/agent/models?chat_jid=${encodeURIComponent(target)}`),
      api.request(`/agent/status?chat_jid=${encodeURIComponent(target)}`),
      api.request(`/agent/context?chat_jid=${encodeURIComponent(target)}`),
      api.request(`/agent/queue-state?chat_jid=${encodeURIComponent(target)}`),
    ]);
    if (stopped || expected !== generation || current !== target || paused || document.hidden) return;
    renderRecovery(recoveryState);
    status.textContent = `Session: ${target}${result.has_more ? ' · Showing the most recent messages' : ''}`;
    account.textContent = `${api.identity.displayName} (@${api.identity.username})`;
    modeBadge.textContent = 'Family shared'; modeBadge.title = 'family-shared mode · shared process and filesystem'; modeBadge.hidden = false;
    element<HTMLButtonElement>('open-account').disabled = false; settings?.resume();
    element<HTMLButtonElement>('open-sessions').disabled = false; sessionSettings?.resume();
    administration?.resume(); workspacePolicy?.resume(); results?.resume(); tasks?.resume(); memory?.resume();
    preferences?.resume(); preferences?.applyAppearance(preferenceState);
    notifications?.resume(); notify.disabled = !notifications?.state().available; notify.textContent = notifications?.state().enabled ? 'Disable notifications' : 'Enable notifications';
    const realtimeUnchanged = !realtime || realtime.revision() === realtimeRevision;
    const live = realtime?.applyServerSnapshot(agentState, queueState.items ?? [], realtimeRevision) ?? realtime?.snapshot();
    const currentSurface = chatSurface?.readSnapshot();
    const projectedAgentState = realtimeUnchanged
      ? (live?.agentStatus ? { status: 'active', data: live.agentStatus, draft: live.agentDraft, thought: live.agentThought } : agentState)
      : (live?.agentStatus ? { status: 'active', data: live.agentStatus, draft: live.agentDraft, thought: live.agentThought } : { status: 'idle', data: null });
    chatSurface?.update({ posts: realtimeUnchanged ? result.posts : currentSurface?.posts ?? result.posts, hasMore: realtimeUnchanged ? result.has_more === true : currentSurface?.hasMore ?? false, directory, currentChatJid: target, modelState,
      agentState: projectedAgentState, contextUsage, queueItems: live?.queueItems ?? queueState.items ?? [], connectionStatus: live?.connectionStatus ?? 'disconnected', enabled: !busy });
    controls(!busy);
  } catch (failure) {
    if (!stopped && expected === generation) {
      chatSurface?.update({ posts: [], hasMore: false, currentChatJid: target, agentState: null, contextUsage: null, enabled: false }); controls(false); home.disabled = false; refresh.disabled = false;
      error.textContent = (failure as Error).message;
      try {
        const preferenceState = await api.request('/account/preferences');
        if (!stopped && expected === generation && !paused && !document.hidden) {
          element<HTMLButtonElement>('open-account').disabled = false; settings?.resume();
          element<HTMLButtonElement>('open-sessions').disabled = false; sessionSettings?.resume();
          administration?.resume(); workspacePolicy?.resume(); results?.resume(); tasks?.resume(); memory?.resume(); preferences?.resume(); preferences?.applyAppearance(preferenceState);
          notifications?.resume(); notify.disabled = !notifications?.state().available; notify.textContent = notifications?.state().enabled ? 'Disable notifications' : 'Enable notifications';
        }
      } catch { /* Identity invalidation clears the page; network errors keep controls masked. */ }
    }
  } finally { if (refreshing === flight) refreshing = null; }
}
async function switchSession(chat: string): Promise<void> {
  if (stopped || busy || !api) return;
  mask({ preserveComposeDraft: true }); current = chat; heldRow = null; recoveryRequest = null; confirmSkip.checked = false; error.textContent = '';
  const url = new URL(location.href); url.search = ''; url.searchParams.set('chat_jid', chat); url.hash = '';
  history.replaceState(null, '', url.pathname + url.search);
  realtime?.start(chat); await refreshDirectory(); await loadTimeline();
}
async function refreshDirectory(): Promise<void> {
  if (!api || stopped || paused || document.hidden) return;
  const expected = ++directoryGeneration;
  const value = await api.request('/agent/branches?include_archived=1');
  if (stopped || paused || document.hidden || expected !== directoryGeneration || !Array.isArray(value?.branches)) return;
  directory = value.branches;
  chatSurface?.update({ directory, currentChatJid: current });
}
async function start(): Promise<void> {
  try {
    await prepareFamilyBrowser();
    const identity = await fetchFamilyIdentity(AbortSignal.timeout(15_000));
    if (stopped) return;
    api = new FamilyApi(identity, invalidate); logout.disabled = false;
    chatSurface = new FamilyChatSurface(api, {
      navigate: switchSession,
      changed: loadTimeline,
      refreshDirectory,
      previewMemory: source => { panelNavigation.activate('family-memory'); return memory?.previewSource(source); },
      submissionState: value => {
        busy = value; generation++; refreshing = null; controls(!value);
        if (!value && !stopped) void loadTimeline();
      },
    });
    realtime = new FamilyRealtime({
      sseUrl: chat => api!.sseUrl(chat),
      getStatus: chat => api!.request(`/agent/status?chat_jid=${encodeURIComponent(chat)}`),
      getContext: chat => api!.request(`/agent/context?chat_jid=${encodeURIComponent(chat)}`),
      refreshTimeline: loadTimeline,
      refreshQueue: loadTimeline,
      refreshDirectory,
      setPosts: next => {
        const previous = chatSurface?.readSnapshot().posts ?? [];
        chatSurface?.update({ posts: typeof next === 'function' ? next(previous) : next });
      },
      setContextUsage: next => {
        const previous = chatSurface?.readSnapshot().contextUsage ?? null;
        chatSurface?.update({ contextUsage: typeof next === 'function' ? next(previous) : next });
      },
      applyModelState: payload => {
        const previous = chatSurface?.readSnapshot().modelState ?? {};
        chatSurface?.update({ modelState: { ...previous, ...payload } });
      },
      changed: live => {
        if (stopped || paused || live.connectionStatus === 'disconnected' && !current) return;
        chatSurface?.update({
          agentState: live.agentStatus ? { status: 'active', data: live.agentStatus, draft: live.agentDraft, thought: live.agentThought } : { status: 'idle', data: null },
          queueItems: live.queueItems, connectionStatus: live.connectionStatus,
        });
      },
      invalidated: invalidate,
      revalidate: chat => api!.request(`/agent/status?chat_jid=${encodeURIComponent(chat)}`).then(() => undefined),
    });
    notifications = new FamilyNotifications(api, () => current);
    try { await notifications.initialise(); } catch (failure) { console.debug('[family] Notification subscription restore failed.', failure); }
    settings = new FamilyAccount(api); administration = new FamilyAdministration(api); workspacePolicy = new FamilyWorkspace(api); preferences = new FamilyPreferences(api);
    tasks = new FamilyTasks(api, { lock: value => { if (value && (busy || paused || stopped)) return false; busy = value; generation++; refreshing = null; controls(false); return true; }, changed: loadTimeline });
    results = new FamilyResults(api, { beforeCancel: () => { tasks?.disarmRun(); memory?.disarm(); }, lock: value => { if (value && (busy || paused || stopped)) return false; busy = value; generation++; refreshing = null; controls(false); return true; }, changed: loadTimeline });
    memory = new FamilyMemory(api, { beforeWithdraw: () => { tasks?.disarmRun(); memory?.disarm(); }, lock: value => { if (value && (busy || paused || stopped)) return false; busy = value; generation++; refreshing = null; controls(false); return true; }, changed: loadTimeline });
    sessionSettings = new FamilySessions(api, {
      lock: value => { if (value && (busy || paused || stopped)) return false; busy = value; generation++; refreshing = null; controls(false); return true; },
      navigate: switchSession,
      changed: async () => { try { await refreshDirectory(); await loadTimeline(); } catch (failure) { if (!stopped && !paused) error.textContent = (failure as Error).message; } },
    });
    const requested = new URL(location.href).searchParams.getAll('chat_jid');
    if (requested.length > 1 || (requested.length === 1 && !requested[0]?.trim())) throw new Error('Invalid session selection. Use Go home.');
    current = requested[0] ?? identity.homeChatJid;
    realtime.start(current); await refreshDirectory(); home.disabled = false; refresh.disabled = false; await loadTimeline();
  } catch (failure) { if (!stopped) { error.textContent = (failure as Error).message; status.textContent = 'Unable to open this session.'; if (api) home.disabled = false; } }
}
home.addEventListener('click', () => { if (api) void switchSession(api.identity.homeChatJid); });
refresh.addEventListener('click', () => { error.textContent = ''; void loadTimeline(); });
addEventListener('blur', () => { paused = true; mask(); });
async function resumeVisiblePage(): Promise<void> {
  paused = false;
  if (current) realtime?.start(current);
  if (!busy) { await refreshDirectory(); await loadTimeline(); return; }
  if (!api || stopped || document.hidden) return;
  const expected = generation;
  try { await api.verifyIdentity(); if (!stopped && !paused && !document.hidden && expected === generation) { results?.resume(); memory?.resume(); } }
  catch (failure) { if (!stopped && !paused && !document.hidden && expected === generation) error.textContent = (failure as Error).message; }
}
addEventListener('focus', () => { void resumeVisiblePage(); });
document.addEventListener('visibilitychange', () => { if (document.hidden) { paused = true; mask(); } else { void resumeVisiblePage(); } });
addEventListener('pagehide', invalidate); addEventListener('pageshow', event => { if ((event as PageTransitionEvent).persisted) invalidate(); });
switchAccount.addEventListener('click', () => invalidate());
logout.addEventListener('click', async () => {
  if (!api || stopped || busy) return;
  busy = true; controls(false); logout.disabled = true;
  try { try { await notifications?.disable(); } catch (failure) { console.debug('[family] Notification cleanup failed during sign out.', failure); } await api.logout(); invalidate(); location.replace('/login'); }
  catch (failure) { if (!stopped) { error.textContent = (failure as Error).message; logout.disabled = false; } }
  finally { busy = false; if (!stopped) void loadTimeline(); }
});
notify.addEventListener('click', async () => {
  if (!notifications || stopped || busy || paused) return;
  notify.disabled = true; error.textContent = '';
  try { if (notifications.state().enabled) await notifications.disable(); else await notifications.enable(); notify.textContent = notifications.state().enabled ? 'Disable notifications' : 'Enable notifications'; }
  catch (failure) { if (!stopped) error.textContent = (failure as Error).message; }
  finally { if (!stopped) notify.disabled = !notifications.state().available; }
});
confirmSkip.addEventListener('change', () => { skip.disabled = busy || heldRow === null || !confirmSkip.checked; });
async function recover(action: 'retry' | 'skip' | 'dismiss-legacy'): Promise<void> {
  if (!api || stopped || busy || paused || heldRow === null || (action !== 'retry' && !confirmSkip.checked) || (legacyHeld ? action!=='dismiss-legacy' : action==='dismiss-legacy')) return;
  if (!recoveryRequest || recoveryRequest.row !== heldRow || recoveryRequest.action !== action) recoveryRequest = { row: heldRow, action, requestId: crypto.randomUUID() };
  busy = true; generation++; controls(false);
  try { await api.request('/agent/message-recovery', 'POST', { chat_jid: current, message_rowid: heldRow, action, request_id: recoveryRequest.requestId }); if (!stopped) { recoveryRequest = null; confirmSkip.checked = false; error.textContent = ''; } }
  catch (failure) { if (!stopped) error.textContent = `${(failure as Error).message} Retry the same action to reuse its request ID; refresh before choosing another input.`; }
  finally { busy = false; if (!stopped) { refreshing = null; await loadTimeline(); } }
}
retry.addEventListener('click', () => { void recover('retry'); });
skip.addEventListener('click', () => { void recover(legacyHeld?'dismiss-legacy':'skip'); });
void start();
