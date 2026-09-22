/** Session-local thinking intent. Never writes operator or account defaults. */
import { AsyncLocalStorage } from 'node:async_hooks';
import type { AgentSession, SettingsManager } from '@earendil-works/pi-coding-agent';
import type { ThinkingLevel } from '@earendil-works/pi-agent-core';
import { createLogger } from '../utils/logger.js';

const log = createLogger('agent-pool.thinking');
const levels = new Set(['off', 'minimal', 'low', 'medium', 'high', 'xhigh', 'max']);
const validLevel = (value: unknown): value is ThinkingLevel => typeof value === 'string' && levels.has(value);
export const THINKING_POLICY_ENTRY = 'piclaw.thinking-policy.v1';
type Source = 'session' | 'model_default' | 'scoped_model';
type Operation = 'model_set' | 'model_cycle' | 'thinking_set' | 'restore';
type Transition = { operation: Operation; source: Source; previous: ThinkingLevel; requested: ThinkingLevel; effective: ThinkingLevel; clamped: boolean };
const state = new WeakMap<AgentSession, { preferred: ThinkingLevel; last: Transition | null }>();
const switching = new AsyncLocalStorage<{ session: AgentSession; operation: 'model_set' | 'model_cycle' | 'restore'; pending: boolean; preferred?: ThinkingLevel }>();

/** Restore a carried effective value without treating it as a new user choice. */
export function restoreSessionThinkingPolicy(session: AgentSession, effective: ThinkingLevel, preferred?: ThinkingLevel | null): void {
  switching.run({ session, operation: 'restore', pending: true, preferred: preferred ?? effective }, () => session.setThinkingLevel(effective));
}

export function getThinkingDefaults(settings: SettingsManager) {
  const global = settings.getGlobalSettings().defaultThinkingLevel;
  const project = settings.isProjectTrusted() ? settings.getProjectSettings().defaultThinkingLevel : undefined;
  const effective = settings.getDefaultThinkingLevel();
  return {
    level: validLevel(effective) ? effective : null,
    source: effective === project && validLevel(project) ? 'project' : effective === global && validLevel(global) ? 'global' : effective ? 'override' : 'sdk',
  };
}

export function getSessionThinkingPolicy(session: AgentSession) {
  const current = state.get(session);
  return current ? {
    preferred_level: current.preferred,
    effective_level: session.thinkingLevel,
    defaults: getThinkingDefaults(session.settingsManager),
    last_transition: current.last,
  } : null;
}

/** Read only the active branch; later explicit SDK entries supersede old metadata. */
export function readThinkingPreference(entries: readonly { type: string; customType?: string; data?: unknown; thinkingLevel?: unknown }[]): ThinkingLevel | null {
  for (let i = entries.length - 1; i >= 0; i--) {
    const entry = entries[i];
    if (entry.type === 'thinking_level_change' && validLevel(entry.thinkingLevel)) return entry.thinkingLevel;
    if (entry.type === 'custom' && entry.customType === THINKING_POLICY_ENTRY) {
      const preferred = (entry.data as { preferred?: unknown } | undefined)?.preferred;
      if (validLevel(preferred)) return preferred;
    }
  }
  return null;
}

/** Install once before binding extensions: their public API calls these methods too. */
export function installSessionThinkingPolicy(session: AgentSession, restoredPreference?: ThinkingLevel | null): void {
  if (state.has(session)) return;
  const saved = restoredPreference ?? readThinkingPreference(session.sessionManager.getBranch());
  const preferred = validLevel(saved) ? saved : session.thinkingLevel;
  const current = { preferred, last: validLevel(saved) ? {
    operation: 'restore' as const, source: 'session' as const, previous: session.thinkingLevel,
    requested: saved, effective: session.thinkingLevel, clamped: saved !== session.thinkingLevel,
  } : null as Transition | null };
  state.set(session, current);
  const setModel = session.setModel.bind(session);
  const cycleModel = session.cycleModel.bind(session);
  const setThinking = session.setThinkingLevel.bind(session);
  // SDK startup may append an effective clamp even to a message-free resumed
  // transcript. Keep the captured pre-start preference ahead of that entry.
  if (validLevel(saved) && saved !== readThinkingPreference(session.sessionManager.getBranch())) {
    session.sessionManager.appendCustomEntry(THINKING_POLICY_ENTRY, { preferred: saved });
  }

  session.setModel = (model, options) => switching.run({ session, operation: 'model_set', pending: true }, () => setModel(model, options));
  session.cycleModel = (direction, options) => switching.run({ session, operation: 'model_cycle', pending: true }, () => cycleModel(direction, options));
  session.setThinkingLevel = (level, options) => {
    const context = switching.getStore();
    const operation = context?.session === session && context.pending ? context.operation : 'thinking_set';
    if (context?.session === session) context.pending = false;
    let requested = level;
    let source: Source = 'session';
    if ((operation === 'model_set' || operation === 'model_cycle') && session.model) {
      const model = session.model;
      const scoped = operation === 'model_cycle' ? session.scopedModels.find(item => item.model.provider === model.provider && item.model.id === model.id)?.thinkingLevel : undefined;
      const perModel = session.settingsManager.getModelThinkingLevel(model.provider, model.id);
      requested = validLevel(scoped) ? scoped : validLevel(perModel) ? perModel : current.preferred;
      source = validLevel(scoped) ? 'scoped_model' : validLevel(perModel) ? 'model_default' : 'session';
    }
    const previous = session.thinkingLevel;
    // Remember intent before notifications: an extension may synchronously
    // switch model while handling the thinking event.
    if (operation === 'thinking_set') current.preferred = requested;
    else if (operation === 'restore') current.preferred = context?.preferred ?? requested;
    // Keep SDK clamping, transcript events and explicit persist semantics intact.
    setThinking(requested, options);
    current.last = { operation, source, previous, requested, effective: session.thinkingLevel, clamped: requested !== session.thinkingLevel };
    session.sessionManager.appendCustomEntry(THINKING_POLICY_ENTRY, { preferred: current.preferred, ...current.last });
    log.info('Thinking level selection', { ...current.last, transition: operation, operation: 'thinking.selection', defaultSource: getThinkingDefaults(session.settingsManager).source });
  };
}
