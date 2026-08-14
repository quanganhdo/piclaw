/**
 * runtime/shutdown-registry.ts – Global shutdown handle for agent-initiated exits.
 *
 * bootstrapRuntime() registers the graceful shutdown handler here after
 * startup. The exit_process tool and /exit slash command call
 * requestGracefulShutdown() to trigger the same orderly teardown
 * (queue drain → session dispose → web stop → process.exit) that SIGINT uses.
 *
 * For agent-initiated exits (exit_process tool), the actual shutdown is
 * **deferred** until the current turn completes and is persisted to the DB.
 * Call markPendingShutdown() during a tool call, then checkPendingShutdown()
 * from finalizeSuccessfulRun() after the response is committed.
 *
 * isPendingShutdown() returns true while the flag is set, so the run-agent
 * orchestrator can abort the session immediately after the exit_process tool
 * executes — preventing further tool calls in the same turn.
 */

import { createLogger } from "../utils/logger.js";

const log = createLogger("runtime.shutdown-registry");

type ShutdownFn = (signal: string) => Promise<void>;
type PreShutdownHook = () => void | Promise<void>;

interface PendingShutdown {
  reason: string;
  ownerChatJid: string;
  canFailSafeShutdown: () => boolean;
}

const FAIL_SAFE_DELAY_MS = 30_000;
const FAIL_SAFE_RETRY_MS = 5_000;

let registeredShutdown: ShutdownFn | null = null;
let pendingShutdown: PendingShutdown | null = null;
let pendingShutdownTimer: ReturnType<typeof setTimeout> | null = null;
const preShutdownHooks = new Set<PreShutdownHook>();
let preShutdownHooksRan = false;

function clearPendingShutdownTimer(): void {
  if (!pendingShutdownTimer) return;
  clearTimeout(pendingShutdownTimer);
  pendingShutdownTimer = null;
}

function runPendingShutdownFailSafe(): void {
  pendingShutdownTimer = null;
  const pending = pendingShutdown;
  if (!pending) return;
  if (!pending.canFailSafeShutdown()) {
    log.info("Pending shutdown fail-safe deferred while another session is active", {
      operation: "fail_safe.defer",
      ownerChatJid: pending.ownerChatJid,
      retryMs: FAIL_SAFE_RETRY_MS,
    });
    schedulePendingShutdownFailSafe(FAIL_SAFE_RETRY_MS);
    return;
  }

  pendingShutdown = null;
  log.warn("Pending shutdown fail-safe executing", {
    operation: "fail_safe.execute",
    reason: pending.reason,
    ownerChatJid: pending.ownerChatJid,
  });
  requestGracefulShutdown(pending.reason);
}

function schedulePendingShutdownFailSafe(delayMs: number): void {
  clearPendingShutdownTimer();
  const testScheduler = (globalThis as {
    __PICLAW_PENDING_SHUTDOWN_FAIL_SAFE_SCHEDULER__?: (callback: () => void, delayMs: number) => void;
  }).__PICLAW_PENDING_SHUTDOWN_FAIL_SAFE_SCHEDULER__;
  if (typeof testScheduler === "function") {
    testScheduler(runPendingShutdownFailSafe, delayMs);
    return;
  }

  pendingShutdownTimer = setTimeout(runPendingShutdownFailSafe, delayMs);
  if (typeof pendingShutdownTimer.unref === "function") pendingShutdownTimer.unref();
}

/**
 * Register the graceful shutdown handler.
 * Called once by bootstrapRuntime() after all services are wired.
 */
export function registerShutdownHandler(handler: ShutdownFn): void {
  registeredShutdown = handler;
}

/**
 * Register a best-effort hook that runs immediately before graceful shutdown
 * begins. Used for cheap persistence cleanup such as clearing transient UI
 * state that should not survive a clean restart.
 */
export function registerPreShutdownHook(hook: PreShutdownHook): void {
  preShutdownHooks.add(hook);
}

export async function runPreShutdownHooksOnce(): Promise<void> {
  if (preShutdownHooksRan) return;
  preShutdownHooksRan = true;
  for (const hook of preShutdownHooks) {
    try {
      await hook();
    } catch (error) {
      log.warn("Pre-shutdown hook failed", {
        operation: "pre_shutdown_hook",
        err: error,
      });
    }
  }
}

/**
 * Request an immediate graceful shutdown of the entire runtime.
 *
 * Used by /exit slash command (which runs outside the agent turn).
 * For exit_process tool (mid-turn), use markPendingShutdown() instead.
 */
export function requestGracefulShutdown(reason: string, delayMs = 800): void {
  const testScheduler = (globalThis as { __PICLAW_EXIT_SCHEDULER__?: () => void }).__PICLAW_EXIT_SCHEDULER__;
  if (typeof testScheduler === "function") {
    testScheduler();
    return;
  }

  void runPreShutdownHooksOnce().finally(() => {
    if (registeredShutdown) {
      log.info("Graceful shutdown requested", { operation: "request", reason });
      void registeredShutdown(`exit_process: ${reason}`);
      return;
    }

    log.info("No runtime handler registered; scheduling process exit", {
      operation: "request_fallback",
      reason,
      delayMs,
    });
    setTimeout(() => process.exit(0), delayMs);
  });
}

/**
 * Mark that a graceful shutdown should happen after the current turn
 * completes and is persisted. Called by the exit_process tool.
 */
export function markPendingShutdown(
  reason: string,
  ownerChatJid: string,
  canFailSafeShutdown: () => boolean,
): void {
  pendingShutdown = { reason, ownerChatJid, canFailSafeShutdown };
  schedulePendingShutdownFailSafe(FAIL_SAFE_DELAY_MS);
  log.info("Pending shutdown marked", {
    operation: "mark_pending",
    reason,
    ownerChatJid,
    failSafeDelayMs: FAIL_SAFE_DELAY_MS,
  });
}

/**
 * Query whether a pending shutdown has been requested. When a chat JID is
 * supplied, only the requesting chat can observe the pending shutdown.
 */
export function isPendingShutdown(chatJid?: string): boolean {
  if (!pendingShutdown) return false;
  return chatJid === undefined || pendingShutdown.ownerChatJid === chatJid;
}

export function clearPendingShutdownForTests(): void {
  pendingShutdown = null;
  clearPendingShutdownTimer();
}

/**
 * Check if a pending shutdown was requested. If so, execute it after a brief
 * delay. Called from finalizeSuccessfulRun() after the response is committed
 * to the DB and broadcast to connected clients.
 *
 * The delay gives the SSE transport time to flush the final "done" status and
 * stored message events to connected web clients before the server tears down.
 * Without it the client may miss the agent's final reply even though it is
 * already persisted in the DB.
 */
export function checkPendingShutdown(chatJid?: string): void {
  if (!pendingShutdown) return;
  if (chatJid !== undefined && pendingShutdown.ownerChatJid !== chatJid) return;
  if (!pendingShutdown.canFailSafeShutdown()) {
    log.info("Pending shutdown finalization deferred while another session is active", {
      operation: "check_pending.defer",
      ownerChatJid: pendingShutdown.ownerChatJid,
    });
    return;
  }
  const { reason, ownerChatJid } = pendingShutdown;
  pendingShutdown = null;
  clearPendingShutdownTimer();
  log.info("Pending shutdown: delaying 1.5s for SSE flush", {
    operation: "check_pending.delay",
    reason,
    ownerChatJid,
  });
  setTimeout(() => requestGracefulShutdown(reason), 1500);
}
