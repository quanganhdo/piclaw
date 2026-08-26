export interface BrowserObservabilityContext {
  userId?: string;
  sessionId?: string;
  clientId?: string;
}
import type { WebChannelLike } from "../core/web-channel-contracts.js";
import { getPrePromptCompactionForegroundMs } from "../../../core/config.js";
import { beginChatPreflight, beginChatRun, clearChatPreflight, promoteChatPreflightToInflight } from "../../../db.js";
import { isCompactionCancellationError, maybeAutoCompactSessionBeforePrompt } from "../../../agent-pool/compaction.js";
import { beginTrackedPhase, endTrackedPhase, heartbeatTrackedPhase } from "../../../runtime/progress-watchdog.js";
import { createLogger } from "../../../utils/logger.js";

const log = createLogger("web.runtime.process-chat-preflight");

function withMetadata(details: Record<string, unknown>, turnId: string, browser?: BrowserObservabilityContext): Record<string, unknown> {
  return { ...details, turnId, ...(browser?.userId ? { userId: browser.userId } : {}), ...(browser?.sessionId ? { sessionId: browser.sessionId } : {}), ...(browser?.clientId ? { clientId: browser.clientId } : {}) };
}

export async function runProcessChatPreflight(options: {
  channel: WebChannelLike;
  chatJid: string;
  agentId: string;
  message: { id: string; timestamp: string };
  prevCursor: string;
  effectiveThreadRootId: number | null;
  turnId: string;
  runStartedAt: string;
  browserObservability?: BrowserObservabilityContext;
  streamingHandler(event: Record<string, unknown>): void;
  compactionState: { lastCompactionErrorMessage: string | null; lastCompactionSuppressed: boolean };
  enqueueResume(threadRootId: number | undefined): void;
  skipPrePromptCompaction?: boolean;
}): Promise<"continue" | "deferred"> {
  const { channel, chatJid } = options;
  if (options.skipPrePromptCompaction
    || typeof channel.agentPool.getSessionForIntrospection !== "function") {
    beginChatRun(chatJid, options.message.timestamp, { prevTs: options.prevCursor, messageId: options.message.id, startedAt: options.runStartedAt });
    return "continue";
  }

  const rotateIfNeeded = async (source: "foreground" | "background"): Promise<boolean> => {
    const detail = options.compactionState.lastCompactionErrorMessage?.trim();
    if (!detail || isCompactionCancellationError(detail)) return false;
    const result = await channel.agentPool.emergencyRotateSession(chatJid, detail);
    log[result.status === "success" ? "info" : "warn"]("Emergency rotation after pre-prompt compaction", withMetadata({ operation: result.status === "success" ? "process_chat.preprompt_compaction_emergency_rotate_success" : "process_chat.preprompt_compaction_emergency_rotate_failed", chatJid, source, suppressed: options.compactionState.lastCompactionSuppressed, reason: result.message, archivePath: result.archivePath ?? null, newSessionFile: result.newSessionFile ?? null }, options.turnId, options.browserObservability));
    return result.status === "success";
  };

  const session = await channel.agentPool.getSessionForIntrospection(chatJid);
  beginTrackedPhase(chatJid, "preprompt_compaction", { source: "web.process_chat.preflight", messageId: options.message.id });
  beginChatPreflight(chatJid, { prevTs: options.prevCursor, messageId: options.message.id, startedAt: options.runStartedAt });
  const compactionPromise = maybeAutoCompactSessionBeforePrompt(session, chatJid, {
    onInfo: (message, details) => log.info(message, withMetadata(details || {}, options.turnId, options.browserObservability)),
    onWarn: (message, details) => log.warn(message, withMetadata(details || {}, options.turnId, options.browserObservability)),
  }, options.streamingHandler);
  let deferred = false;
  try {
    const foregroundMs = getPrePromptCompactionForegroundMs();
    const outcome = await Promise.race([compactionPromise.then(() => "done" as const), Bun.sleep(foregroundMs).then(() => "defer" as const)]);
    if (outcome === "defer") {
      deferred = true;
      compactionPromise.then(async () => {
        if (await rotateIfNeeded("background")) { clearChatPreflight(chatJid); endTrackedPhase(chatJid); }
      }).catch((error) => log.warn("Background pre-prompt compaction failed before chat resume", withMetadata({ operation: "process_chat.preprompt_compaction_deferred_failed", chatJid, messageId: options.message.id, err: error }, options.turnId, options.browserObservability)))
        .finally(() => options.enqueueResume(options.effectiveThreadRootId ?? undefined));
      return "deferred";
    }
  } catch (error) {
    clearChatPreflight(chatJid); endTrackedPhase(chatJid); throw error;
  } finally {
    if (!deferred) await compactionPromise;
  }

  if (await rotateIfNeeded("foreground")) {
    clearChatPreflight(chatJid); endTrackedPhase(chatJid); options.enqueueResume(options.effectiveThreadRootId ?? undefined); return "deferred";
  }
  heartbeatTrackedPhase(chatJid, "prompt", { eventType: "preflight_promoted" });
  promoteChatPreflightToInflight(chatJid, options.message.timestamp, { prevTs: options.prevCursor, messageId: options.message.id, startedAt: options.runStartedAt });
  return "continue";
}
