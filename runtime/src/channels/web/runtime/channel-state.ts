/**
 * web/channel-state.ts – Persistent state for the web channel.
 *
 * After moving cursor positions and failed-run records into the `chat_cursors`
 * DB table (db/chat-cursors.ts), this class is responsible only for
 * transient per-chat agent status payloads that the UI polls for.
 *
 * Persisted agentStatuses are treated as transient UI hints, not durable
 * truth. On startup, stale previous-process entries are discarded and any
 * needed recovery status is re-derived from durable inflight markers in
 * `chat_cursors`.
 *
 * Consumers: channels/web.ts reads/writes state during agent run
 *            orchestration and SSE broadcasting.
 */

import { getRouterState, setRouterState } from "../../../db.js";

export interface PersistedDraftRecoveryEntry {
  turnId?: string;
  text: string;
  totalLines: number;
  updatedAt: number;
}

/** Persistent per-chat state manager for the web channel. */
export class WebChannelState {
  agentStatuses: Record<string, Record<string, unknown>> = {};
  contextUsages: Record<string, Record<string, unknown>> = {};
  draftRecoveries: Record<string, PersistedDraftRecoveryEntry> = {};

  constructor(private stateKey: string) {}

  load(): void {
    const data = getRouterState(this.stateKey);
    try {
      const parsed = data ? JSON.parse(data) : {};
      this.agentStatuses =
        parsed && typeof parsed === "object" && typeof parsed.agentStatuses === "object"
          ? (parsed.agentStatuses as Record<string, Record<string, unknown>>)
          : {};
      this.contextUsages =
        parsed && typeof parsed === "object" && typeof parsed.contextUsages === "object"
          ? (parsed.contextUsages as Record<string, Record<string, unknown>>)
          : {};
      this.draftRecoveries =
        parsed && typeof parsed === "object" && typeof parsed.draftRecoveries === "object"
          ? (parsed.draftRecoveries as Record<string, PersistedDraftRecoveryEntry>)
          : {};
    } catch {
      this.agentStatuses = {};
      this.contextUsages = {};
      this.draftRecoveries = {};
    }
  }

  save(): void {
    setRouterState(
      this.stateKey,
      JSON.stringify({ agentStatuses: this.agentStatuses, contextUsages: this.contextUsages, draftRecoveries: this.draftRecoveries })
    );
  }

  setAgentStatus(chatJid: string, status: Record<string, unknown> | null): void {
    if (!status) {
      delete this.agentStatuses[chatJid];
      return;
    }
    this.agentStatuses[chatJid] = status;
  }

  getAgentStatuses(): Record<string, Record<string, unknown>> {
    return { ...this.agentStatuses };
  }

  /**
   * Persist usage only for the active Pi session identity. Legacy entries without
   * sessionGeneration remain readable JSON but are intentionally not trusted.
   */
  setContextUsage(chatJid: string, usage: Record<string, unknown> | null): void {
    if (!usage) {
      delete this.contextUsages[chatJid];
      return;
    }
    const sessionGeneration = typeof usage.sessionGeneration === "string"
      ? usage.sessionGeneration.trim()
      : "";
    if (!sessionGeneration) return;

    const current = this.contextUsages[chatJid];
    const currentGeneration = typeof current?.sessionGeneration === "string"
      ? current.sessionGeneration.trim()
      : "";
    if (currentGeneration && currentGeneration !== sessionGeneration && usage.reset !== true) return;

    const { reset: _reset, ...persisted } = usage;
    this.contextUsages[chatJid] = { ...persisted, sessionGeneration };
  }

  getContextUsage(chatJid: string): Record<string, unknown> | null {
    const usage = this.contextUsages[chatJid];
    return usage && typeof usage.sessionGeneration === "string" && usage.sessionGeneration.trim()
      ? usage
      : null;
  }

  setDraftRecovery(chatJid: string, entry: PersistedDraftRecoveryEntry | null): void {
    if (!entry) {
      delete this.draftRecoveries[chatJid];
      return;
    }
    this.draftRecoveries[chatJid] = entry;
  }

  getDraftRecovery(chatJid: string): PersistedDraftRecoveryEntry | null {
    return this.draftRecoveries[chatJid] ?? null;
  }
}
