/**
 * runtime/wiring.ts – Runtime message/scheduler wiring helpers.
 */

import {
  classifyDreamWorkspaceState,
  getDreamDerivedMemoryFiles,
  recoverEstablishedDreamWorkspace,
  writeDreamStartupMarker,
  type DreamStartupRecoveryResult,
  type DreamWorkspaceState,
} from "../agent-memory/startup-state.js";
import { ensureDreamTask, runDreamAgentTurn } from "../dream.js";
import { createDreamAccessGuard } from "../core/dream-access.js";
import { AUTO_DREAM_DEFAULT_DAYS } from "../dream-defaults.js";
import { startIpcWatcher, type IpcDeps } from "../ipc.js";
import { startSchedulerLoop, type SchedulerDeps } from "../task-scheduler.js";
import { createUuid } from "../utils/ids.js";
import { createLogger } from "../utils/logger.js";

const log = createLogger("runtime.wiring");

/** Queue-lane key for out-of-band Dream work; separate from the interactive chat lane. */
export function getDreamQueueLane(chatJid: string): string {
  return `dream:${chatJid || "web:default"}`;
}

export function getDreamBootstrapFiles(): string[] {
  return getDreamDerivedMemoryFiles();
}

export function workspaceNeedsDreamBootstrap(state = classifyDreamWorkspaceState()): boolean {
  return state.kind === "fresh";
}

export type DreamWorkspaceStartupAction =
  | "bootstrap_queued"
  | "recovered"
  | "recovered_backfill_deferred"
  | "deferred"
  | "none"
  | "recovery_failed";

export interface DreamWorkspaceStartupResult {
  state: DreamWorkspaceState;
  action: DreamWorkspaceStartupAction;
  recovery: DreamStartupRecoveryResult | null;
}

/** Minimal sender contract exposed to runtime worker wiring. */
export type RuntimeSenders = Pick<IpcDeps, "sendMessage" | "sendNudge">;

/** Optional sendMessage options accepted by web message dispatch. */
export type RuntimeSendMessageOptions = Parameters<RuntimeSenders["sendMessage"]>[2];

/** Web-channel capabilities required by runtime worker startup. */
export interface RuntimeWebWorkerChannel {
  sendMessage: RuntimeSenders["sendMessage"];
  resumeChat: (chatJid: string, threadRootId?: number | null) => void;
  resumePendingChats: (chatJid?: string) => void;
}

/** Optional non-web channel capability for runtime worker startup. */

/** Optional Pushover-channel capability required by runtime worker startup. */
export interface RuntimePushoverWorkerChannel {
  sendMessage: (jid: string, text: string) => Promise<void>;
}

/** Agent-pool model resolution capability required by IPC update_task handling. */
export interface RuntimeModelResolver {
  resolveModelInput: NonNullable<IpcDeps["resolveModel"]>;
}

/** Build sendMessage/sendNudge closures for runtime workers. */
export function createRuntimeSenders(
  web: RuntimeWebWorkerChannel,
  pushover: RuntimePushoverWorkerChannel | null
): RuntimeSenders {
  const sendMessage = async (jid: string, text: string, options?: RuntimeSendMessageOptions) => {
    if (jid.startsWith("web:")) {
      await web.sendMessage(jid, text, options);
      return;
    }
  };

  const sendNudge = pushover
    ? async (text: string) => {
        await pushover.sendMessage("", text).catch((err) =>
          log.error("Failed to send pushover nudge", {
            operation: "send_nudge",
            err,
          })
        );
      }
    : undefined;

  return { sendMessage, sendNudge };
}

export function initializeDreamWorkspaceAtStartup(
  queue: SchedulerDeps["queue"],
  agentPool: SchedulerDeps["agentPool"],
): DreamWorkspaceStartupResult {
  createDreamAccessGuard();
  const state = classifyDreamWorkspaceState();
  const chatJid = "web:default";

  if (state.kind === "fresh") {
    const taskId = `dream-bootstrap:${createUuid("dream")}`;
    log.info("Queueing initial Dream bootstrap for a fresh workspace", {
      operation: "start_runtime_workers.dream_state_fresh",
      chatJid,
      days: AUTO_DREAM_DEFAULT_DAYS,
      missingFiles: state.missingDerivedFiles,
    });
    queue.enqueueTask(taskId, async () => {
      const checkAccess = createDreamAccessGuard();
      const result = await runDreamAgentTurn({
        chatJid,
        days: AUTO_DREAM_DEFAULT_DAYS,
        mode: "auto",
        agentPool,
      });
      checkAccess();
      log.info("Initial Dream bootstrap finished", {
        operation: "start_runtime_workers.complete_dream_bootstrap",
        chatJid,
        skipped: result.skipped,
      });
    }, getDreamQueueLane(chatJid));
    return { state, action: "bootstrap_queued", recovery: null };
  }

  if (state.kind === "established_complete") {
    if (state.evidenceError) {
      log.error("Dream startup evidence is corrupt; preserving established workspace state", {
        operation: "start_runtime_workers.dream_state_corrupt",
        errorMessage: state.evidenceError,
      });
    }
    const markerChanged = !state.evidenceError && !state.initialized
      ? writeDreamStartupMarker(state.backfillRequired ? "backfill_required" : "complete")
      : false;
    if (state.backfillRequired) {
      log.warn("Dream startup recovery awaits scheduled or manual consolidation", {
        operation: "start_runtime_workers.defer_dream_consolidation",
        reason: "backfill_required",
      });
      return { state, action: "deferred", recovery: null };
    }
    log.info("Dream startup memory is complete", {
      operation: "start_runtime_workers.dream_state_complete",
      initialized: state.initialized || markerChanged,
      markerChanged,
      hasDailyNotes: state.hasDailyNotes,
      hasNonDreamMessages: state.hasNonDreamMessages,
    });
    return { state, action: "none", recovery: null };
  }

  if (state.evidenceError) {
    log.error("Dream startup evidence is corrupt; attempting deterministic recovery only", {
      operation: "start_runtime_workers.dream_state_corrupt",
      errorMessage: state.evidenceError,
      missingFiles: state.missingDerivedFiles,
    });
  }
  try {
    const recovery = recoverEstablishedDreamWorkspace(state, { recentDays: AUTO_DREAM_DEFAULT_DAYS });
    log.info("Recovered derived Dream memory without a provider request", {
      operation: "start_runtime_workers.recover_dream_state",
      missingFiles: state.missingDerivedFiles,
      materializedFiles: recovery.materializedFiles,
      backfillRequired: recovery.backfillRequired,
      markerChanged: recovery.markerChanged,
    });
    if (recovery.backfillRequired) {
      log.warn("Dream startup recovery awaits scheduled or manual consolidation", {
        operation: "start_runtime_workers.defer_dream_consolidation",
        reason: "backfill_required",
      });
    }
    return {
      state,
      action: recovery.backfillRequired ? "recovered_backfill_deferred" : "recovered",
      recovery,
    };
  } catch (error) {
    log.error("Dream startup recovery failed without queueing model work", {
      operation: "start_runtime_workers.dream_state_corrupt",
      missingFiles: state.missingDerivedFiles,
      err: error,
    });
    return { state, action: "recovery_failed", recovery: null };
  }
}

/** Start IPC and scheduler background workers with runtime callbacks. */
export function startRuntimeWorkers(
  queue: SchedulerDeps["queue"],
  agentPool: SchedulerDeps["agentPool"] & RuntimeModelResolver,
  web: RuntimeWebWorkerChannel,
  senders: RuntimeSenders
): void {
  ensureDreamTask("web:default");
  initializeDreamWorkspaceAtStartup(queue, agentPool);

  startIpcWatcher({
    sendMessage: senders.sendMessage,
    sendNudge: senders.sendNudge,
    resolveModel: (input) => agentPool.resolveModelInput(input),
    resumeChat: async (data) => {
      const chatJid = typeof data.chatJid === "string" && data.chatJid.trim()
        ? data.chatJid.trim()
        : "web:default";
      const threadRootId = typeof data.threadRootId === "number" ? data.threadRootId : null;
      web.resumeChat(chatJid, threadRootId);
    },
    resumePending: async (data) => {
      const chatJid = typeof data?.chatJid === "string" && data.chatJid.trim()
        ? data.chatJid.trim()
        : undefined;
      web.resumePendingChats(chatJid);
    },
    runDream: async (data) => {
      createDreamAccessGuard();
      const chatJid = typeof data.chatJid === "string" && data.chatJid.trim()
        ? data.chatJid.trim()
        : typeof data.chat_jid === "string" && data.chat_jid.trim()
          ? data.chat_jid.trim()
          : "web:default";
      const mode = data.mode === "auto" ? "auto" : "manual";
      const days = typeof data.days === "number" && Number.isFinite(data.days)
        ? Math.max(1, Math.floor(data.days))
        : typeof data.days === "string" && data.days.trim()
          ? Math.max(1, Number.parseInt(data.days, 10) || 7)
          : 7;
      const taskId = `dream-ipc:${createUuid("dream")}`;
      queue.enqueueTask(taskId, async () => {
        const checkAccess = createDreamAccessGuard();
        const result = await runDreamAgentTurn({
          chatJid,
          days,
          mode,
          agentPool,
        });
        checkAccess();
        if (mode !== "auto") {
          await senders.sendMessage(chatJid, result.result, { forceRoot: true, source: "dream" });
        }
      }, getDreamQueueLane(chatJid));
    },
  });

  startSchedulerLoop({
    queue,
    agentPool,
    sendMessage: senders.sendMessage,
    sendNudge: senders.sendNudge,
  });
}
