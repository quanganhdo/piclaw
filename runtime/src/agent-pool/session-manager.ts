/**
 * agent-pool/session-manager.ts – Main/side session lifecycle management for AgentPool.
 *
 * Extracts chat-session creation, side-session sync, idle eviction, and shutdown
 * mechanics out of the top-level AgentPool coordinator while preserving the
 * existing map-based cache structure used by callers and tests.
 */

import type { AgentSession, AgentSessionRuntime, ExtensionFactory, ModelRuntime, SettingsManager } from "@earendil-works/pi-coding-agent";
import { closeOpenAICodexWebSocketSessions } from "@earendil-works/pi-ai/api/openai-codex-responses";

import {
  claimDeferredBranchSeed,
  finalizeClaimedDeferredBranchSeed,
  getDeferredBranchSeedFingerprint,
  hasDeferredBranchSeed,
  restoreClaimedDeferredBranchSeed,
  seedSessionManagerFromDeferredBranchSeed,
} from "./branch-seeding.js";
import { getChatBranchByChatJid, getDb } from "../db.js";
import { readAccessConfig } from "../core/config-access.js";
import { ChatAccessDenied } from "../db/session-ownership.js";
import { readOwnedForkSeed, finishOwnedForkSeed } from "../db/owned-forks.js";
import { requireOwnedSessionExecution } from "./owned-session-access.js";
import { importAdoptedSession } from './adopted-session-import.js';
import { createDefaultSession, createSessionInDir, ensureNamedSessionDir, ensureSessionDir, lightweightPrewarmSession } from "./session.js";
import { forcePersistSessionFile, seedRotatedSession } from "../session-rotation.js";
import { getSessionPersistencePort } from "./session-persistence.js";
import { getDefaultActiveToolNames } from "../extensions/tool-activation.js";

/** Cached session entry stored for each chat JID. */
export interface PoolEntry {
  runtime: AgentSessionRuntime;
  lastUsed: number;
}

/**
 * Protect freshly touched sessions from immediate timer-based eviction.
 * This avoids create→idle-cleanup→dispose churn when the cleanup loop runs
 * right after a session was created or used.
 */
const RECENT_USE_EVICTION_GRACE_MS = 1_000;

/** Dependencies required to manage AgentPool session lifecycles. */
export interface AgentSessionManagerOptions {
  pool: Map<string, PoolEntry>;
  sidePool: Map<string, PoolEntry>;
  createSession?: (chatJid: string, sessionDir: string) => Promise<AgentSessionRuntime>;
  createSideSession?: (chatJid: string, sessionDir: string) => Promise<AgentSessionRuntime>;
  disposePersistence?: (runtime: AgentSessionRuntime) => Promise<void> | void;
  modelRuntime: ModelRuntime;
  settingsManager: SettingsManager;
  mainSessionMaxSize?: number | null;
  lightweightPrewarmSession?: (chatJid: string) => Promise<void>;
  createDefaultTools: () => NonNullable<Parameters<typeof createDefaultSession>[1]["tools"]>;
  createCustomToolOverrides?: (chatJid: string) => unknown[];
  getSessionExtensionFactories?: (chatJid: string) => Promise<ExtensionFactory[]>;
  bindSession: (runtime: AgentSessionRuntime, chatJid: string) => Promise<void>;
  ensureBranchRegistration: (chatJid: string, session?: AgentSession | null) => void;
  onInfo?: (message: string, details: Record<string, unknown>) => void;
  onWarn?: (message: string, details: Record<string, unknown>) => void;
  onError?: (message: string, details: Record<string, unknown>) => void;
}

/**
 * Handles lifecycle operations for main and auxiliary AgentSession instances.
 */
export interface AgentSessionManagerInstrumentationSnapshot {
  branchSeedRealizationsInFlight: number;
  createInFlight: number;
  evictionProtectedChats: number;
  invalidDeferredSeedErrors: number;
  prewarmInFlight: number;
  queuedPrewarms: number;
  prewarmQueueLength: number;
  prewarmCooldowns: number;
}

export class AgentSessionManager {
  private readonly branchSeedRealizationInFlight = new Map<string, Promise<boolean>>();
  private readonly createInFlight = new Map<string, Promise<AgentSessionRuntime>>();
  private readonly idleMainDisposalsInFlight = new Map<string, Promise<void>>();
  private readonly idleSideDisposalsInFlight = new Map<string, Promise<void>>();
  private readonly createSideInFlight = new Map<string, Promise<AgentSessionRuntime>>();
  private readonly invalidDeferredBranchSeedErrors = new Map<string, { error: Error; fingerprint: string | null }>();
  private readonly runtimeDisposeInFlight = new WeakMap<AgentSessionRuntime, Promise<unknown | null>>();
  private readonly prewarmInFlight = new Set<string>();
  private readonly queuedPrewarms = new Set<string>();
  private readonly prewarmQueue: Array<{ chatJid: string; mode: "full" | "lightweight" }> = [];
  private readonly prewarmCooldownByChat = new Map<string, number>();
  private readonly evictionProtectionCounts = new Map<string, number>();
  private prewarmLoopActive = false;
  private isShuttingDown = false;

  constructor(private readonly options: AgentSessionManagerOptions) {}

  /**
   * Protect a chat from every idle/pool-limit eviction path while work is
   * pending or in flight. Protection is reference-counted for overlapping runs.
   */
  acquireEvictionProtection(chatJid: string): () => void {
    const normalized = String(chatJid || "").trim();
    if (!normalized) return () => {};
    this.evictionProtectionCounts.set(normalized, (this.evictionProtectionCounts.get(normalized) ?? 0) + 1);
    let released = false;
    return () => {
      if (released) return;
      released = true;
      const next = (this.evictionProtectionCounts.get(normalized) ?? 1) - 1;
      if (next > 0) this.evictionProtectionCounts.set(normalized, next);
      else this.evictionProtectionCounts.delete(normalized);
    };
  }

  /** Lifecycle callers must not archive while a run, hydration or disposal is in flight. */
  hasPendingSessionWork(chatJid: string): boolean {
    return this.createInFlight.has(chatJid) || this.createSideInFlight.has(chatJid)
      || this.branchSeedRealizationInFlight.has(chatJid) || this.evictionProtectionCounts.has(chatJid)
      || this.idleMainDisposalsInFlight.has(chatJid) || this.idleSideDisposalsInFlight.has(chatJid);
  }

  private getEvictionProtectedChatJids(explicit: string[] = []): string[] {
    return [...new Set([...explicit, ...this.evictionProtectionCounts.keys()])];
  }

  private getBlockingInvalidSeedError(chatJid: string): Error | null {
    const knownInvalidSeedState = this.invalidDeferredBranchSeedErrors.get(chatJid);
    if (!knownInvalidSeedState) return null;
    if (knownInvalidSeedState.fingerprint === getDeferredBranchSeedFingerprint(chatJid)) {
      return knownInvalidSeedState.error;
    }
    this.invalidDeferredBranchSeedErrors.delete(chatJid);
    return null;
  }

  private prunePrewarmCooldownEntries(now: number): void {
    for (const [chatJid, lastQueuedAt] of this.prewarmCooldownByChat) {
      if (now - lastQueuedAt >= 30_000) {
        this.prewarmCooldownByChat.delete(chatJid);
      }
    }
  }

  async refreshRuntime(chatJid: string, runtime: AgentSessionRuntime): Promise<void> {
    requireOwnedSessionExecution(chatJid);
    const entry = this.options.pool.get(chatJid);
    if (entry) {
      entry.lastUsed = Date.now();
    }
    await this.options.bindSession(runtime, chatJid);
    requireOwnedSessionExecution(chatJid);
    this.options.ensureBranchRegistration(chatJid, runtime.session);
  }

  async getOrCreate(chatJid: string): Promise<AgentSessionRuntime> {
    const owner = requireOwnedSessionExecution(chatJid);
    if (owner) readOwnedForkSeed(getDb(), owner, chatJid);
    if (this.isShuttingDown) {
      throw new Error("Session manager is shutting down.");
    }
    const pendingIdleDispose = this.idleMainDisposalsInFlight.get(chatJid);
    if (pendingIdleDispose) {
      await pendingIdleDispose;
    }

    requireOwnedSessionExecution(chatJid);
    const knownInvalidSeedError = this.getBlockingInvalidSeedError(chatJid);
    if (knownInvalidSeedError) {
      throw knownInvalidSeedError;
    }

    const pendingCreate = this.createInFlight.get(chatJid);
    if (pendingCreate) {
      const runtime = await pendingCreate;
      requireOwnedSessionExecution(chatJid);
      return runtime;
    }

    const existing = this.options.pool.get(chatJid);
    if (existing) {
      existing.lastUsed = Date.now();
      try {
        await this.realizeDeferredBranchSeed(chatJid, existing.runtime);
        requireOwnedSessionExecution(chatJid);
        return existing.runtime;
      } catch (error) {
        await this.disposeMainRuntimeAfterError(chatJid, existing.runtime, "get_or_create.realize_existing_after_error");
        throw error;
      }
    }

    const task = (async () => {
      this.options.onInfo?.("Creating new session", {
        operation: "get_or_create.create_main_session",
        chatJid,
      });

      const chatSessionDir = ensureSessionDir(chatJid);

      const extensionFactories = await this.options.getSessionExtensionFactories?.(chatJid) ?? [];
      requireOwnedSessionExecution(chatJid);
      const runtime = this.options.createSession
        ? await this.options.createSession(chatJid, chatSessionDir)
        : await createDefaultSession(chatJid, {
            modelRuntime: this.options.modelRuntime,
            settingsManager: this.options.settingsManager,
            tools: this.options.createDefaultTools(),
            customTools: this.options.createCustomToolOverrides?.(chatJid) ?? [],
            extensionFactories,
          });

      if (this.isShuttingDown) {
        await this.disposeRuntimeOnce(runtime, "Failed to dispose newly created session during shutdown", {
          operation: "get_or_create.dispose_during_shutdown",
          chatJid,
        });
        throw new Error("Session manager is shutting down.");
      }

      this.options.pool.set(chatJid, { runtime, lastUsed: Date.now() });
      this.enforceMainSessionPoolLimit({ protectedChatJids: [chatJid] });
      try {
        const realizedDeferredSeed = await this.realizeDeferredBranchSeed(chatJid, runtime);
        if (!realizedDeferredSeed) {
          await this.applyDefaultModel(runtime.session);
        }
        await this.refreshRuntime(chatJid, runtime);
        this.options.onInfo?.("Session ready", {
          operation: this.options.createSession ? "get_or_create.create_main_session" : "get_or_create.create_default_session",
          chatJid,
          poolSize: this.options.pool.size,
        });
        return runtime;
      } catch (err) {
        await this.disposeMainRuntimeAfterError(chatJid, runtime, "get_or_create.dispose_after_error");
        throw err;
      }
    })().finally(() => {
      this.createInFlight.delete(chatJid);
    });

    this.createInFlight.set(chatJid, task);
    return await task;
  }

  async getOrCreateSide(chatJid: string): Promise<AgentSessionRuntime> {
    const owner = requireOwnedSessionExecution(chatJid);
    if (owner) readOwnedForkSeed(getDb(), owner, chatJid);
    if (this.isShuttingDown) {
      throw new Error("Session manager is shutting down.");
    }
    const pendingIdleDispose = this.idleSideDisposalsInFlight.get(chatJid);
    if (pendingIdleDispose) {
      await pendingIdleDispose;
    }

    requireOwnedSessionExecution(chatJid);
    const pendingCreate = this.createSideInFlight.get(chatJid);
    if (pendingCreate) {
      const runtime = await pendingCreate;
      requireOwnedSessionExecution(chatJid);
      return runtime;
    }

    const existing = this.options.sidePool.get(chatJid);
    if (existing) {
      existing.lastUsed = Date.now();
      return existing.runtime;
    }

    const task = (async () => {
      this.options.onInfo?.("Creating new side session", {
        operation: "get_or_create_side.create_session",
        chatJid,
      });
      const sideSessionDir = ensureNamedSessionDir(chatJid, "btw-side");

      const extensionFactories = await this.options.getSessionExtensionFactories?.(chatJid) ?? [];
      requireOwnedSessionExecution(chatJid);
      const runtime = this.options.createSideSession
        ? await this.options.createSideSession(chatJid, sideSessionDir)
        : await createSessionInDir(sideSessionDir, {
            modelRuntime: this.options.modelRuntime,
            settingsManager: this.options.settingsManager,
            tools: this.options.createDefaultTools(),
            customTools: this.options.createCustomToolOverrides?.(chatJid) ?? [],
            extensionFactories,
          });

      if (this.isShuttingDown) {
        await this.disposeRuntimeOnce(runtime, "Failed to dispose newly created side session during shutdown", {
          operation: "get_or_create_side.dispose_during_shutdown",
          chatJid,
        });
        throw new Error("Session manager is shutting down.");
      }

      try {
        requireOwnedSessionExecution(chatJid);
      } catch (error) {
        await this.disposeRuntimeOnce(runtime, "Discarding unauthorised side session", { operation: "get_or_create_side.identity_denied", chatJid });
        throw error;
      }
      this.options.sidePool.set(chatJid, { runtime, lastUsed: Date.now() });
      return runtime;
    })().finally(() => {
      this.createSideInFlight.delete(chatJid);
    });

    this.createSideInFlight.set(chatJid, task);
    return await task;
  }

  async syncSideSessionFromMain(mainSession: AgentSession, sideRuntime: AgentSessionRuntime): Promise<void> {
    try {
      const mainContext = await getSessionPersistencePort(mainSession).buildContext();
      const result = await sideRuntime.newSession({
        setup: async (sessionManager) => {
          await seedRotatedSession(sessionManager, mainContext, {
            sessionName: "BTW",
            model: mainContext.model,
            thinkingLevel: mainSession.thinkingLevel,
          });
        },
      });
      if (result.cancelled) {
        throw new Error("Side-session reseed was cancelled.");
      }
    } catch (err) {
      this.options.onWarn?.("Failed to reseed side session from main context", {
        operation: "sync_side_session_from_main.reseed",
        err,
      });
      await this.disposeSideRuntimeAfterError(sideRuntime, "sync_side_session_from_main.dispose_after_reseed_failure");
      throw err;
    }

    const sideSession = sideRuntime.session;
    const mainModel = mainSession.model;
    const sideModel = sideSession.model;
    if (mainModel && (!sideModel || sideModel.provider !== mainModel.provider || sideModel.id !== mainModel.id)) {
      try {
        await sideSession.setModel(mainModel);
      } catch (err) {
        this.options.onWarn?.("Failed to sync side-session model", {
          operation: "sync_side_session_from_main.model",
          model: `${mainModel.provider}/${mainModel.id}`,
          err,
        });
      }
    }

    try {
      sideSession.setThinkingLevel(mainSession.thinkingLevel);
    } catch (err) {
      this.options.onWarn?.("Failed to sync side-session thinking level", {
        operation: "sync_side_session_from_main.thinking_level",
        err,
      });
    }

    try {
      const mainToolNames = mainSession.getActiveToolNames();
      // Empty is a transient protected-recovery/finalisation state, not a
      // durable user selection. Never copy that suppression into a side
      // session where it can outlive the owning turn.
      sideSession.setActiveToolsByName(mainToolNames.length > 0 ? mainToolNames : getDefaultActiveToolNames());
    } catch (err) {
      this.options.onWarn?.("Failed to sync side-session tool selection", {
        operation: "sync_side_session_from_main.tools",
        err,
      });
    }
  }

  async recreate(chatJid: string): Promise<void> {
    await this.disposeEntry(this.options.pool, chatJid, "recreate.dispose_main_session");
    await this.disposeEntry(this.options.sidePool, chatJid, "recreate.dispose_side_session", true);
  }

  /**
   * Remove any pending (not-yet-realized) prewarm for a chat. Used by
   * branch prune so a queued warmup cannot materialize a blank runtime
   * (or realize the deferred seed) for an archived chat.
   */
  cancelPrewarm(chatJid: string): void {
    const normalized = String(chatJid || "").trim();
    if (!normalized) return;
    this.queuedPrewarms.delete(normalized);
    const idx = this.prewarmQueue.findIndex((entry) => entry.chatJid === normalized);
    if (idx >= 0) this.prewarmQueue.splice(idx, 1);
  }

  prewarm(chatJid: string, options: { priority?: boolean; mode?: "full" | "lightweight" } = {}): boolean {
    // Queue provenance must be durable before background multi-user hydration is enabled.
    if (readAccessConfig().mode !== "single-user") return false;
    if (this.isShuttingDown) return false;
    const normalizedChatJid = String(chatJid || "").trim();
    if (!normalizedChatJid) return false;
    if (this.getBlockingInvalidSeedError(normalizedChatJid)) return false;
    if (this.options.pool.has(normalizedChatJid) && !hasDeferredBranchSeed(normalizedChatJid)) return false;
    if (this.prewarmInFlight.has(normalizedChatJid) || this.queuedPrewarms.has(normalizedChatJid)) return false;
    const now = Date.now();
    this.prunePrewarmCooldownEntries(now);
    const lastQueuedAt = this.prewarmCooldownByChat.get(normalizedChatJid) ?? 0;
    if (!options.priority && now - lastQueuedAt < 30_000) return false;

    const mode = options.mode === "lightweight" ? "lightweight" : "full";
    this.queuedPrewarms.add(normalizedChatJid);
    this.prewarmCooldownByChat.set(normalizedChatJid, now);
    if (options.priority) {
      this.prewarmQueue.unshift({ chatJid: normalizedChatJid, mode });
    } else {
      this.prewarmQueue.push({ chatJid: normalizedChatJid, mode });
    }
    this.drainPrewarmQueue();
    return true;
  }

  getInstrumentationSnapshot(): AgentSessionManagerInstrumentationSnapshot {
    return {
      branchSeedRealizationsInFlight: this.branchSeedRealizationInFlight.size,
      createInFlight: this.createInFlight.size,
      evictionProtectedChats: this.evictionProtectionCounts.size,
      invalidDeferredSeedErrors: this.invalidDeferredBranchSeedErrors.size,
      prewarmInFlight: this.prewarmInFlight.size,
      queuedPrewarms: this.queuedPrewarms.size,
      prewarmQueueLength: this.prewarmQueue.length,
      prewarmCooldowns: this.prewarmCooldownByChat.size,
    };
  }

  async shutdown(): Promise<void> {
    this.isShuttingDown = true;
    this.queuedPrewarms.clear();
    this.prewarmQueue.length = 0;
    this.prewarmCooldownByChat.clear();
    this.evictionProtectionCounts.clear();

    for (const jid of [...this.options.pool.keys()]) {
      await this.disposeEntry(this.options.pool, jid, "shutdown.dispose_main_session");
    }
    for (const jid of [...this.options.sidePool.keys()]) {
      await this.disposeEntry(this.options.sidePool, jid, "shutdown.dispose_side_session", true);
    }
    this.options.pool.clear();
    this.options.sidePool.clear();
  }

  private async disposeEntry(
    map: Map<string, PoolEntry>,
    chatJid: string,
    operation: string,
    side = false,
  ): Promise<void> {
    const entry = map.get(chatJid);
    if (!entry) return;
    try {
      const disposeError = await this.disposeRuntimeOnce(entry.runtime, side ? "Failed to dispose side session" : "Failed to dispose session", {
        operation,
        chatJid,
      });
      if (disposeError) {
        this.options.onError?.(side ? "Failed to dispose side session" : "Failed to dispose session", { operation, chatJid, err: disposeError });
      } else {
        this.options.onInfo?.(side ? "Disposed side session" : "Disposed session", { operation, chatJid });
      }
    } finally {
      map.delete(chatJid);
    }
  }

  evictIdle(options: { mainIdleTtlMs: number; sideIdleTtlMs: number; mainSessionMaxSizeOverride?: number | null; protectedChatJids?: string[] }): void {
    const now = Date.now();
    const { mainIdleTtlMs, sideIdleTtlMs, mainSessionMaxSizeOverride } = options;
    const explicitProtectedChatJids = new Set(this.getEvictionProtectedChatJids(
      Array.isArray(options.protectedChatJids)
        ? options.protectedChatJids.map((chatJid) => String(chatJid || "").trim()).filter(Boolean)
        : [],
    ));
    let protectedRecentMainChatJid: string | null = null;
    let protectedRecentMainLastUsed = -Infinity;
    for (const [jid, entry] of this.options.pool) {
      if (explicitProtectedChatJids.has(jid)) continue;
      if (entry.lastUsed > protectedRecentMainLastUsed || (entry.lastUsed === protectedRecentMainLastUsed && protectedRecentMainChatJid !== jid)) {
        protectedRecentMainChatJid = jid;
        protectedRecentMainLastUsed = entry.lastUsed;
      }
    }
    if (protectedRecentMainChatJid && now - protectedRecentMainLastUsed > RECENT_USE_EVICTION_GRACE_MS) {
      protectedRecentMainChatJid = null;
    }

    for (const [jid, entry] of this.options.pool) {
      if (explicitProtectedChatJids.has(jid) || jid === protectedRecentMainChatJid) {
        continue;
      }
      if (this.shouldKeepSessionCached(entry.runtime.session, now, entry)) {
        continue;
      }
      if (now - entry.lastUsed > mainIdleTtlMs) {
        this.disposeCachedMainRuntime(jid, entry.runtime, "evict_idle.main_session");
      }
    }

    this.enforceMainSessionPoolLimit({
      protectedChatJids: [...explicitProtectedChatJids],
      maxSizeOverride: mainSessionMaxSizeOverride,
    });

    for (const [jid, entry] of this.options.sidePool) {
      if (this.shouldKeepSessionCached(entry.runtime.session, now, entry)) {
        continue;
      }
      if (now - entry.lastUsed > sideIdleTtlMs) {
        this.options.onInfo?.("Evicting idle side session", {
          operation: "evict_idle.side_session",
          chatJid: jid,
        });
        this.startIdleDispose(this.options.sidePool, this.idleSideDisposalsInFlight, jid, entry, "evict_idle.side_session", true);
      }
    }
  }

  private shouldKeepSessionCached(
    session: { isStreaming?: boolean; isBashRunning?: boolean; isCompacting?: boolean },
    now: number,
    entry: PoolEntry,
  ): boolean {
    if (session.isStreaming || session.isBashRunning || session.isCompacting) {
      entry.lastUsed = now;
      return true;
    }
    return false;
  }

  private enforceMainSessionPoolLimit(options: { protectedChatJids?: string[]; maxSizeOverride?: number | null } = {}): void {
    const resolvedMaxSize = options.maxSizeOverride ?? this.options.mainSessionMaxSize ?? 0;
    const maxSize = Number.isFinite(resolvedMaxSize) ? resolvedMaxSize : 0;
    if (maxSize <= 0 || this.options.pool.size <= maxSize) return;

    const protectedChatJids = new Set(this.getEvictionProtectedChatJids(
      Array.isArray(options.protectedChatJids)
        ? options.protectedChatJids.map((chatJid) => String(chatJid || "").trim()).filter(Boolean)
        : [],
    ));
    const candidates = [...this.options.pool.entries()]
      .filter(([chatJid, entry]) => !protectedChatJids.has(chatJid) && !this.shouldKeepSessionCached(entry.runtime.session, Date.now(), entry))
      .sort((left, right) => left[1].lastUsed - right[1].lastUsed);

    while (this.options.pool.size > maxSize && candidates.length > 0) {
      const next = candidates.shift();
      if (!next) break;
      const [chatJid, entry] = next;
      if (this.options.pool.get(chatJid)?.runtime !== entry.runtime) continue;
      this.disposeCachedMainRuntime(chatJid, entry.runtime, "evict_idle.main_session_pool_limit", maxSize);
    }
  }

  private disposeCachedMainRuntime(chatJid: string, runtime: AgentSessionRuntime, operation: string, maxSizeOverride?: number | null): void {
    if (this.options.pool.get(chatJid)?.runtime !== runtime) return;
    this.options.onInfo?.("Evicting cached main session", {
      operation,
      chatJid,
      poolSize: this.options.pool.size,
      maxSize: maxSizeOverride ?? this.options.mainSessionMaxSize ?? null,
    });
    this.startIdleDispose(this.options.pool, this.idleMainDisposalsInFlight, chatJid, { runtime, lastUsed: Date.now() }, operation, false);
  }

  private startIdleDispose(
    map: Map<string, PoolEntry>,
    pendingDisposals: Map<string, Promise<void>>,
    chatJid: string,
    entry: PoolEntry,
    operation: string,
    side: boolean,
  ): void {
    if (pendingDisposals.has(chatJid)) return;
    if (map.get(chatJid)?.runtime === entry.runtime) {
      map.delete(chatJid);
    }

    const warnMessage = side ? "Failed to dispose evicted side session" : "Failed to dispose evicted session";
    const task = this.disposeRuntimeOnce(entry.runtime, warnMessage, {
      operation,
      chatJid,
    }).then(() => undefined).finally(() => {
      if (pendingDisposals.get(chatJid) === task) {
        pendingDisposals.delete(chatJid);
      }
    });

    pendingDisposals.set(chatJid, task);
  }

  private async disposeRuntimeOnce(
    runtime: AgentSessionRuntime,
    warnMessage = "Failed to dispose session",
    details: Record<string, unknown> = {},
  ): Promise<unknown | null> {
    const pendingDispose = this.runtimeDisposeInFlight.get(runtime);
    if (pendingDispose) return await pendingDispose;

    const task = (async (): Promise<unknown | null> => {
      const sessionId = runtime.session.sessionId;
      let firstError: unknown | null = null;
      try {
        await runtime.dispose();
      } catch (err) {
        firstError = err;
        this.options.onWarn?.(warnMessage, { ...details, err });
      } finally {
        try {
          await this.options.disposePersistence?.(runtime);
        } catch (err) {
          firstError ??= err;
          this.options.onWarn?.("Failed to dispose session persistence resource", { ...details, err });
        }
        closeOpenAICodexWebSocketSessions(sessionId);
      }
      return firstError;
    })();
    this.runtimeDisposeInFlight.set(runtime, task);
    const result = await task;
    if (this.runtimeDisposeInFlight.get(runtime) === task) this.runtimeDisposeInFlight.delete(runtime);
    return result;
  }

  private async applyDefaultModel(session: AgentSession): Promise<void> {
    if (session.model) return;

    const provider = this.options.settingsManager.getDefaultProvider();
    const modelId = this.options.settingsManager.getDefaultModel();
    if (!provider || !modelId) return;

    await this.applyResolvedModel(session, { provider, modelId }, "apply_default_model");
  }

  private async realizeDeferredBranchSeed(chatJid: string, runtime: AgentSessionRuntime): Promise<boolean> {
    const pending = this.branchSeedRealizationInFlight.get(chatJid);
    if (pending) return await pending;

    const task = (async () => {
      const owner = requireOwnedSessionExecution(chatJid);
      let seed;
      try {
        if (owner) {
          const json = readOwnedForkSeed(getDb(), owner, chatJid);
          if (hasDeferredBranchSeed(chatJid)) throw new ChatAccessDenied();
          seed = json === null ? null : JSON.parse(json);
          if (seed && (seed.version !== 1 || !["stable_branch", "rotated_context", "adopted_jsonl"].includes(seed.mode))) throw new ChatAccessDenied();
        } else {
          seed = claimDeferredBranchSeed(chatJid);
        }
      } catch (error) {
        if (error instanceof Error && error.message.startsWith("Invalid deferred branch seed for ")) {
          this.invalidDeferredBranchSeedErrors.set(chatJid, {
            error,
            fingerprint: getDeferredBranchSeedFingerprint(chatJid),
          });
        }
        throw error;
      }
      if (!seed) return false;

      try {
        const result = owner && seed.mode === 'adopted_jsonl'
          ? (await importAdoptedSession(runtime,chatJid,seed), {cancelled:false})
          : await runtime.newSession({
          ...(seed.parentSession ? { parentSession: seed.parentSession } : {}),
          setup: async (sessionManager) => {
            requireOwnedSessionExecution(chatJid);
            await seedSessionManagerFromDeferredBranchSeed(sessionManager, seed);
          },
        });
        if (result.cancelled) {
          throw new Error("Deferred branch seed was cancelled.");
        }

        requireOwnedSessionExecution(chatJid);
        const session = runtime.session;
        await this.applyResolvedModel(session, seed.model, "realize_deferred_branch_seed");
        try {
          if (seed.thinkingLevel) {
            session.setThinkingLevel(seed.thinkingLevel);
          }
        } catch (err) {
          this.options.onWarn?.("Failed to restore deferred branch thinking level", {
            operation: "realize_deferred_branch_seed.thinking_level",
            chatJid,
            err,
          });
        }
        try {
          // Prefer the current branch record's agent_name over the seed's
          // captured sessionName: if the user renamed the branch between fork
          // and realization, the DB has the new name and applying the stale
          // seed value would overwrite the rename on first warmup.
          const liveAgentName = getChatBranchByChatJid(chatJid)?.agent_name?.trim() || "";
          const sessionNameToApply = liveAgentName || seed.sessionName?.trim() || "";
          if (sessionNameToApply) {
            session.setSessionName(sessionNameToApply);
          }
        } catch (err) {
          this.options.onWarn?.("Failed to restore deferred branch session name", {
            operation: "realize_deferred_branch_seed.session_name",
            chatJid,
            err,
          });
        }

        const persistedSessionFile = forcePersistSessionFile(session);
        if (persistedSessionFile) {
          const reopened = await runtime.switchSession(persistedSessionFile);
          if (reopened.cancelled) throw new Error("Deferred branch session could not be reopened after persistence.");
        }
        if (owner) {
          if (!persistedSessionFile) throw new Error("Owned fork must be persisted before completing its seed.");
          const current = requireOwnedSessionExecution(chatJid);
          if (!current) throw new ChatAccessDenied();
          finishOwnedForkSeed(getDb(), current, chatJid);
        } else {
          finalizeClaimedDeferredBranchSeed(chatJid);
        }
        this.invalidDeferredBranchSeedErrors.delete(chatJid);
        return true;
      } catch (error) {
        if (!owner) restoreClaimedDeferredBranchSeed(chatJid);
        throw error;
      }
    })().finally(() => {
      this.branchSeedRealizationInFlight.delete(chatJid);
    });

    this.branchSeedRealizationInFlight.set(chatJid, task);
    return await task;
  }

  private async applyResolvedModel(
    session: AgentSession,
    model: { provider: string; modelId: string } | null,
    operation: string,
  ): Promise<void> {
    if (!model) return;

    const current = session.model;
    if (current && current.provider === model.provider && current.id === model.modelId) return;

    const resolved = this.options.modelRuntime.getModel(model.provider, model.modelId);
    if (!resolved) return;

    const setModel = (session as { setModel?: (model: typeof resolved) => Promise<void> }).setModel;
    if (typeof setModel !== "function") return;

    try {
      await setModel.call(session, resolved);
    } catch (err) {
      this.options.onWarn?.("Failed to restore model", {
        operation,
        model: `${model.provider}/${model.modelId}`,
        err,
      });
    }
  }

  private drainPrewarmQueue(): void {
    if (this.prewarmLoopActive) return;
    this.prewarmLoopActive = true;

    void (async () => {
      try {
        while (!this.isShuttingDown && this.prewarmQueue.length > 0) {
          const next = this.prewarmQueue.shift();
          if (!next) continue;
          const { chatJid, mode } = next;
          this.queuedPrewarms.delete(chatJid);
          if (readAccessConfig().mode !== "single-user") continue;
          if (this.isShuttingDown) continue;
          if (this.prewarmInFlight.has(chatJid)) continue;
          if (this.options.pool.has(chatJid) && !hasDeferredBranchSeed(chatJid)) continue;

          this.prewarmInFlight.add(chatJid);
          try {
            if (mode === "lightweight" && !hasDeferredBranchSeed(chatJid)) {
              await (this.options.lightweightPrewarmSession ?? ((jid: string) => lightweightPrewarmSession(jid, {
                getSessionExtensionFactories: this.options.getSessionExtensionFactories,
              })))(chatJid);
              this.options.onInfo?.("Lightweight-prewarmed chat session", {
                operation: "prewarm_session.lightweight",
                chatJid,
              });
            } else {
              await this.getOrCreate(chatJid);
              this.options.onInfo?.("Prewarmed chat session", {
                operation: "prewarm_session",
                chatJid,
              });
            }
          } catch (err) {
            this.options.onWarn?.("Failed to prewarm chat session", {
              operation: mode === "lightweight" ? "prewarm_session.lightweight" : "prewarm_session",
              chatJid,
              err,
            });
          } finally {
            this.prewarmInFlight.delete(chatJid);
          }
        }
      } finally {
        this.prewarmLoopActive = false;
        if (this.prewarmQueue.length > 0) {
          this.drainPrewarmQueue();
        }
      }
    })();
  }

  private findChatJidByRuntime(map: Map<string, PoolEntry>, runtime: AgentSessionRuntime): string | null {
    for (const [chatJid, entry] of map) {
      if (entry.runtime === runtime) return chatJid;
    }
    return null;
  }

  private async disposeSideRuntimeAfterError(runtime: AgentSessionRuntime, operation: string): Promise<void> {
    const chatJid = this.findChatJidByRuntime(this.options.sidePool, runtime);
    if (chatJid && this.options.sidePool.get(chatJid)?.runtime === runtime) {
      this.options.sidePool.delete(chatJid);
    }
    try {
      await this.disposeRuntimeOnce(runtime);
    } catch (disposeErr) {
      this.options.onWarn?.("Failed to dispose side session after initialization error", {
        operation,
        ...(chatJid ? { chatJid } : {}),
        err: disposeErr,
      });
    }
  }

  private async disposeMainRuntimeAfterError(chatJid: string, runtime: AgentSessionRuntime, operation: string): Promise<void> {
    if (this.options.pool.get(chatJid)?.runtime === runtime) {
      this.options.pool.delete(chatJid);
    }
    try {
      await this.disposeRuntimeOnce(runtime);
    } catch (disposeErr) {
      this.options.onWarn?.("Failed to dispose session after initialization error", {
        operation,
        chatJid,
        err: disposeErr,
      });
    }
  }
}
