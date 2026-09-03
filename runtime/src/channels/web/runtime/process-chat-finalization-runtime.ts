import { getIdentityConfig } from "../../../core/config.js";
import { endChatRun, getChatCursor, getMessagesSince } from "../../../db.js";
import { checkPendingShutdown } from "../../../runtime/shutdown-registry.js";
import { createLogger } from "../../../utils/logger.js";
import type { WebChannelLike } from "../core/web-channel-contracts.js";
import type { AgentEventEmitter } from "../sse/agent-events.js";
import { storeAgentTurn } from "../messaging/agent-message-store.js";
import { materializeDeferredFollowups } from "./process-chat-control-runtime.js";
import type { AttachmentInfo } from "../../../agent-pool/attachments.js";
import type { AgentTurnCause, AgentTurnKind } from "../../../agent-pool/contracts.js";
import type { ChatChannel } from "../../../router.js";

const log = createLogger("web.runtime.process-chat-finalization");

export interface ProcessChatFinalizationRuntime {
  channel: Pick<WebChannelLike,
    | "agentPool"
    | "consumePendingSteering"
    | "saveState"
    | "setContextUsage"
    | "resumeChat"
    | "peekQueuedFollowupItem"
    | "consumeQueuedFollowupItem"
    | "prependQueuedFollowupItem"
    | "replaceQueuedFollowupItem"
    | "storeMessage"
    | "broadcastEvent"
    | "sendMessage"
    | "updateAgentStatus"
    | "retryFailedOnModelSwitch"
  >;
  emitter: AgentEventEmitter;
  chatJid: string;
  agentId: string;
  turnId: string;
  threadId: string | number | null;
  prevCursor: string;
  recovery: { attemptsUsed?: number; recovered?: boolean; exhausted?: boolean; lastClassifier?: string | null } | null;
}

/** Finalise a successfully persisted terminal outcome, then resume persisted/queued work. */
export async function finalizeSuccessfulProcessChatRun(options: ProcessChatFinalizationRuntime): Promise<void> {
  const { channel, chatJid } = options;
  // Stale protected intent was removed atomically with terminal persistence.
  // This update only clears inflight/failed run state.
  endChatRun(chatJid);
  const cursorAfterEnd = getChatCursor(chatJid);
  const pendingSteerTimestamps = channel.consumePendingSteering(chatJid);
  const cursorAfterSteer = getChatCursor(chatJid);

  channel.saveState();
  const contextUsage = await channel.agentPool.getContextUsageForChat(chatJid);
  const activeSessionGeneration = typeof channel.agentPool.getSessionGenerationForChat === "function"
    ? channel.agentPool.getSessionGenerationForChat(chatJid)
    : null;
  const usageSessionGeneration = typeof contextUsage?.sessionGeneration === "string"
    ? contextUsage.sessionGeneration.trim()
    : "";
  const staleUsage = Boolean(
    usageSessionGeneration
      && activeSessionGeneration
      && usageSessionGeneration !== activeSessionGeneration,
  );
  const sessionGeneration = activeSessionGeneration || usageSessionGeneration || null;
  const storedUsage = (channel as typeof channel & { getContextUsage?: (jid: string) => Record<string, unknown> | null })
    .getContextUsage?.(chatJid) ?? null;
  const storedGeneration = typeof storedUsage?.sessionGeneration === "string"
    ? storedUsage.sessionGeneration.trim()
    : "";
  const generationChanged = Boolean(sessionGeneration && storedGeneration && storedGeneration !== sessionGeneration);
  const contextReset = Boolean(sessionGeneration && (staleUsage || generationChanged));
  const boundaryUsage = sessionGeneration
    ? { tokens: null, contextWindow: null, percent: null, sessionGeneration }
    : null;

  if (contextReset && boundaryUsage) {
    channel.setContextUsage(chatJid, { ...boundaryUsage, reset: true });
  }
  if (!staleUsage && sessionGeneration) {
    channel.setContextUsage(chatJid, {
      tokens: contextUsage?.tokens ?? null,
      contextWindow: contextUsage?.contextWindow ?? null,
      percent: contextUsage?.percent ?? null,
      sessionGeneration,
    });
  }
  options.emitter.status({
    thread_id: options.threadId,
    agent_id: options.agentId,
    type: "done",
    turn_id: options.turnId,
    sessionGeneration,
    ...(contextReset ? { context_reset: true } : {}),
    context_usage: staleUsage
      ? boundaryUsage
      : sessionGeneration
        ? {
          tokens: contextUsage?.tokens ?? null,
          contextWindow: contextUsage?.contextWindow ?? null,
          percent: contextUsage?.percent ?? null,
          sessionGeneration,
        }
        : null,
    recovery: options.recovery,
  });

  const cursorNow = getChatCursor(chatJid);
  const remainingPersisted = getMessagesSince(chatJid, cursorNow, getIdentityConfig().assistantName);
  log.info("finalizeSuccessfulRun advanced cursor", {
    operation: "process_chat.finalize_successful_run",
    chatJid,
    cursorBefore: options.prevCursor,
    cursorAfterEnd,
    pendingSteerCount: pendingSteerTimestamps.length,
    pendingSteerTimestamps,
    cursorAfterSteer,
    cursorNow,
    remainingCount: remainingPersisted.length,
    remainingMessages: remainingPersisted.map((message) => `${message.id}@${message.timestamp}`),
  });

  if (remainingPersisted.length > 0) {
    channel.resumeChat(chatJid);
    return;
  }

  await materializeDeferredFollowups({ channel: channel as WebChannelLike, chatJid, agentId: options.agentId });
  checkPendingShutdown(chatJid);
}

export interface PersistIntermediateTurnOptions {
  channel: WebChannelLike;
  emitter: AgentEventEmitter;
  chatJid: string;
  text: string;
  attachments: AttachmentInfo[];
  channelName: ChatChannel;
  threadId: number | null;
  skipPlaceholder: boolean;
  timingBlock: Record<string, unknown>;
  turnKind?: AgentTurnKind;
  cause?: AgentTurnCause;
  followedByToolUse?: boolean;
  buildThinkingRefBlocks(): Array<Record<string, unknown>>;
  consumePersistedPreviewsForRow(rowId: number, persistedThreadId?: string | number | null): void;
}

function buildAgentTurnMarker(options: PersistIntermediateTurnOptions): Record<string, unknown> | null {
  const validDraft = options.turnKind === "draft_snapshot"
    && options.cause === "interrupted_text_start"
    && !options.followedByToolUse;
  const validIntermediate = options.turnKind === "intermediate"
    && ((options.cause === "completed_boundary" && !options.followedByToolUse)
      || (options.cause === "failed_boundary" && !options.followedByToolUse)
      || (options.cause === "tool_use" && options.followedByToolUse === true));
  if (!validDraft && !validIntermediate) return null;

  return {
    type: "agent_turn_marker",
    kind: options.turnKind,
    cause: options.cause,
    ...(options.followedByToolUse ? { followed_by_tool_use: true } : {}),
    ...(typeof options.timingBlock.turn_id === "string" ? { turn_id: options.timingBlock.turn_id } : {}),
    ...(typeof options.timingBlock.source_message_id === "string"
      ? { source_message_id: options.timingBlock.source_message_id }
      : {}),
  };
}

/** Persist one non-terminal agent turn, then consume its Draft and Thought previews before broadcast. */
export function persistIntermediateProcessChatTurn(options: PersistIntermediateTurnOptions): number | null {
  const marker = buildAgentTurnMarker(options);
  return storeAgentTurn(options.channel, options.emitter, {
    chatJid: options.chatJid,
    text: options.text,
    attachments: options.attachments,
    channelName: options.channelName,
    threadId: options.threadId,
    skipPlaceholder: options.skipPlaceholder,
    extraContentBlocks: [
      options.timingBlock,
      ...(marker ? [marker] : []),
      ...options.buildThinkingRefBlocks(),
    ],
    onMessageStored: (rowId, interaction) => options.consumePersistedPreviewsForRow(
      rowId,
      interaction.data?.thread_id ?? options.threadId,
    ),
  });
}
