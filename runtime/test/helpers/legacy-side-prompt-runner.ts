// Legacy compatibility fixture only; production side prompts use the durable dispatcher.
/**
 * agent-pool/side-prompt-runner.ts – runSidePrompt orchestration helpers.
 */

import type { AgentSession, AgentSessionEvent, AgentSessionRuntime, ModelRuntime } from "@earendil-works/pi-coding-agent";
import { type AssistantMessageEvent, type Usage } from "@earendil-works/pi-ai";

import { getAgentRuntimeConfig } from "../../src/core/config.js";
import { readAccessConfig } from "../../src/core/config-access.js";
import { detectChannel } from "../../src/router.js";
import { withChatContext } from "../../src/core/chat-context.js";
import { installSessionUsageRecorder, recordMessageUsage } from "../../src/agent-pool/usage.js";
import { createLogger, debugSuppressedError } from "../../src/utils/logger.js";
import { withoutAddonLocalContext } from '../../src/addons/local-context.js';
import { normalizeLlmContext } from "../../src/agent-pool/llm-context-normalizer.js";
import type { SidePromptOptions, SidePromptResult } from "../../src/agent-pool/contracts.js";

// Historical reference-only helpers; none is reachable from production.
/** Lightweight assistant message metadata used by side-prompt helpers. */
interface SideAssistantMessage {
  stopReason?: string;
  errorMessage?: string;
  usage?: unknown;
  content?: unknown[];
  provider?: string;
  model?: string;
  api?: string;
}

/** Format a timeout in a compact human-readable form. */
function formatTimeoutDuration(timeoutMs: number): string {
  if (!Number.isFinite(timeoutMs) || timeoutMs <= 0) return `${timeoutMs}ms`;
  if (timeoutMs % 1000 === 0) return `${Math.round(timeoutMs / 1000)}s`;
  return `${(timeoutMs / 1000).toFixed(1)}s`;
}

/** Extract assistant text blocks from a rich content message. */
function extractAssistantText(message: { content?: unknown[] } | null | undefined): string {
  if (!Array.isArray(message?.content)) return "";
  return message.content
    .map((block) => block && typeof block === "object" && (block as { type?: unknown }).type === "text"
      ? String((block as { text?: unknown }).text ?? "")
      : "")
    .join("")
    .trim();
}

/** Extract assistant thinking blocks from a rich content message. */
function extractAssistantThinking(message: { content?: unknown[] } | null | undefined): string {
  if (!Array.isArray(message?.content)) return "";
  return message.content
    .map((block) => block && typeof block === "object" && (block as { type?: unknown }).type === "thinking"
      ? String((block as { thinking?: unknown }).thinking ?? "")
      : "")
    .join("")
    .trim();
}

/** Normalize supported side-prompt reasoning levels for streamSimple(). */
function toSideReasoning(level: unknown): "minimal" | "low" | "medium" | "high" | "xhigh" | "max" | undefined {
  return level === "minimal" || level === "low" || level === "medium" || level === "high" || level === "xhigh" || level === "max"
    ? level
    : undefined;
}

interface SessionIdleWaitResult {
  totalWaitMs: number;
  settleTicks: number;
  idleTicks: number;
  isStreaming: boolean;
  isCompacting: boolean;
  isRetrying: boolean;
}

const DEFAULT_SESSION_IDLE_SETTLE_TICKS = 20;
const DEFAULT_SESSION_IDLE_MAX_WAIT_MS = 10_000;

/** Wait until a session fully settles after a prompt completes. */
async function waitForSessionIdle(
  session: { isStreaming?: boolean; isCompacting?: boolean; isRetrying?: boolean },
  settleTicks = DEFAULT_SESSION_IDLE_SETTLE_TICKS,
  onSettled?: (result: SessionIdleWaitResult) => void,
  maxWaitMs = DEFAULT_SESSION_IDLE_MAX_WAIT_MS,
): Promise<void> {
  let idleTicks = 0;
  const startTime = Date.now();
  while (idleTicks < settleTicks) {
    const totalWaitMs = Date.now() - startTime;
    if (maxWaitMs > 0 && totalWaitMs >= maxWaitMs) {
      throw new Error(
        `Timed out waiting for session idle after ${formatTimeoutDuration(maxWaitMs)} ` +
          `(streaming=${Boolean(session.isStreaming)}, compacting=${Boolean(session.isCompacting)}, retrying=${Boolean(session.isRetrying)})`,
      );
    }
    if (!session.isStreaming && !session.isCompacting && !session.isRetrying) {
      idleTicks += 1;
    } else {
      idleTicks = 0;
    }
    await Bun.sleep(50);
  }

  onSettled?.({
    totalWaitMs: Date.now() - startTime,
    settleTicks,
    idleTicks,
    isStreaming: Boolean(session.isStreaming),
    isCompacting: Boolean(session.isCompacting),
    isRetrying: Boolean(session.isRetrying),
  });
}

const log = createLogger("agent-pool.side-prompt-runner");

/** Dependencies required to run side prompts. */
export interface SidePromptRunnerOptions {
  getOrCreate: (chatJid: string) => Promise<AgentSession>;
  getOrCreateSideRuntime: (chatJid: string) => Promise<AgentSessionRuntime>;
  syncSideSessionFromMain: (mainSession: AgentSession, sideRuntime: AgentSessionRuntime) => Promise<void>;
  modelRuntime: Pick<ModelRuntime, "streamSimple">;
  /** Explicit simple-stream mode used by callers that do not need a tool-capable side session. */
  sideStreamSimple?: ModelRuntime["streamSimple"];
  onWarn?: (message: string, details: Record<string, unknown>) => void;
}

/** Single-user side prompt. Multi-user execution needs its own admission and tool-policy contract. */
export async function runSidePrompt(
  chatJid: string,
  prompt: string,
  options: SidePromptOptions,
  deps: SidePromptRunnerOptions,
): Promise<SidePromptResult> {
  if (readAccessConfig().mode !== "single-user") return { status: "error", result: null, thinking: null, error: "Side prompts are unavailable in multi-user mode.", model: null };
  const session = await deps.getOrCreate(chatJid);
  if (readAccessConfig().mode !== "single-user") return { status: "error", result: null, thinking: null, error: "Side prompts are unavailable in multi-user mode.", model: null };
  const model = session.model;
  if (!model) {
    return { status: "error", result: null, thinking: null, error: "No active model selected.", model: null };
  }

  if (deps.sideStreamSimple) {
    const stream = deps.sideStreamSimple(
      model,
      normalizeLlmContext({
        ...(options.systemPrompt ? { systemPrompt: options.systemPrompt } : {}),
        messages: [
          {
            role: "user",
            content: [{ type: "text", text: prompt }],
            timestamp: Date.now(),
          },
        ],
      }),
      {
        reasoning: toSideReasoning((session as AgentSession & { thinkingLevel?: unknown }).thinkingLevel),
        signal: options.signal,
      },
    );

    let text = "";
    let thinking = "";
    let finalMessage: SideAssistantMessage | null = null;

    for await (const event of stream) {
      options.onEvent?.(event as AssistantMessageEvent | AgentSessionEvent);
      if (event.type === "text_delta") {
        text += event.delta;
        options.onTextDelta?.(event.delta);
      } else if (event.type === "thinking_delta") {
        thinking += event.delta;
        options.onThinkingDelta?.(event.delta);
      } else if (event.type === "done") {
        finalMessage = event.message as SideAssistantMessage;
      } else if (event.type === "error") {
        finalMessage = event.error as SideAssistantMessage;
      }
    }

    if (!finalMessage) {
      return {
        status: "error",
        result: null,
        thinking: null,
        error: "Side prompt finished without a response.",
        model: `${model.provider}/${model.id}`,
      };
    }

    try {
      recordMessageUsage(chatJid, finalMessage);
    } catch (err) {
      deps.onWarn?.("Failed to persist side-prompt usage", {
        operation: "run_side_prompt.persist_usage_stream",
        chatJid,
        err,
      });
    }

    if (finalMessage.stopReason === "error" || finalMessage.stopReason === "aborted") {
      return {
        status: "error",
        result: null,
        thinking: thinking || extractAssistantThinking(finalMessage),
        error: finalMessage.errorMessage || "Side prompt failed.",
        model: `${model.provider}/${model.id}`,
        usage: finalMessage.usage as Usage | undefined,
        stopReason: finalMessage.stopReason,
      };
    }

    return {
      status: "success",
      result: text || extractAssistantText(finalMessage) || null,
      thinking: thinking || extractAssistantThinking(finalMessage) || null,
      model: `${model.provider}/${model.id}`,
      usage: finalMessage.usage as Usage | undefined,
      stopReason: finalMessage.stopReason,
    };
  }

  const sideRuntime = await deps.getOrCreateSideRuntime(chatJid);
  if (readAccessConfig().mode !== "single-user") return { status: "error", result: null, thinking: null, error: "Side prompts are unavailable in multi-user mode.", model: null };
  await deps.syncSideSessionFromMain(session, sideRuntime);
  if (readAccessConfig().mode !== "single-user") return { status: "error", result: null, thinking: null, error: "Side prompts are unavailable in multi-user mode.", model: null };
  const sideSession = sideRuntime.session;
  installSessionUsageRecorder(sideSession, chatJid, deps.onWarn);

  let text = "";
  let thinking = "";
  let sawText = false;
  let sawThinking = false;
  let finalMessage: SideAssistantMessage | null = null;
  let timedOut = false;
  const channel = detectChannel(chatJid);
  const timeoutMs = getAgentRuntimeConfig().timeoutMs;
  let timeoutId: ReturnType<typeof setTimeout> | null = null;

  const unsubscribe = sideSession.subscribe((event) => {
    options.onEvent?.(event);

    if (event.type === "message_update") {
      const messageEvent = event.assistantMessageEvent;
      if (messageEvent.type === "text_start") {
        if (sawText && !text.endsWith("\n\n")) text += "\n\n";
      } else if (messageEvent.type === "text_delta") {
        sawText = true;
        text += messageEvent.delta;
        options.onTextDelta?.(messageEvent.delta);
      } else if (messageEvent.type === "thinking_start") {
        if (sawThinking && !thinking.endsWith("\n\n")) thinking += "\n\n";
      } else if (messageEvent.type === "thinking_delta") {
        sawThinking = true;
        thinking += messageEvent.delta;
        options.onThinkingDelta?.(messageEvent.delta);
      }
      return;
    }

    if (event.type === "message_end") {
      const message = event.message as { role?: string; stopReason?: string; errorMessage?: string; usage?: Usage; content?: unknown[] } | undefined;
      if (message?.role === "assistant") {
        finalMessage = message as SideAssistantMessage;
      }
    }
  });

  const abortHandler = () => {
    void sideSession.abort().catch((err) => {
      debugSuppressedError(log, "Failed to abort side-prompt session after caller cancellation.", err, {
        operation: "run_side_prompt.abort_handler",
        chatJid,
      });
    });
  };
  options.signal?.addEventListener("abort", abortHandler, { once: true });
  if (timeoutMs > 0) {
    timeoutId = setTimeout(() => {
      timedOut = true;
      void sideSession.abort().catch((err) => {
        debugSuppressedError(log, "Failed to abort side-prompt session after timeout.", err, {
          operation: "run_side_prompt.timeout_abort",
          chatJid,
          timeoutMs,
        });
      });
    }, timeoutMs);
  }

  try {
    await withoutAddonLocalContext(() => withChatContext(chatJid, channel, async () => {
      const composedPrompt = options.systemPrompt ? `${options.systemPrompt}\n\n${prompt}` : prompt;
      await sideSession.prompt(composedPrompt);
      await waitForSessionIdle(sideSession);
    }));
  } catch (err) {
    if (timeoutId) clearTimeout(timeoutId);
    unsubscribe();
    options.signal?.removeEventListener("abort", abortHandler);
    return {
      status: "error",
      result: null,
      thinking: thinking || null,
      error: timedOut ? `Timed out after ${formatTimeoutDuration(timeoutMs)}` : (err instanceof Error ? err.message : String(err)),
      model: `${model.provider}/${model.id}`,
      stopReason: timedOut ? "aborted" : "error",
    };
  }

  if (timeoutId) clearTimeout(timeoutId);
  unsubscribe();
  options.signal?.removeEventListener("abort", abortHandler);

  if (!finalMessage) {
    const fallbackText = text || sideSession.getLastAssistantText() || null;
    if (!fallbackText) {
      return {
        status: "error",
        result: null,
        thinking: thinking || null,
        error: timedOut ? `Timed out after ${formatTimeoutDuration(timeoutMs)}` : "Side prompt finished without a response.",
        model: `${model.provider}/${model.id}`,
        stopReason: timedOut ? "aborted" : "error",
      };
    }
    return {
      status: "success",
      result: fallbackText,
      thinking: thinking || null,
      model: `${model.provider}/${model.id}`,
      stopReason: "stop",
    };
  }

  const completedMessage = finalMessage as SideAssistantMessage;
  if (timedOut || completedMessage.stopReason === "error" || completedMessage.stopReason === "aborted") {
    return {
      status: "error",
      result: null,
      thinking: thinking || extractAssistantThinking(completedMessage) || null,
      error: timedOut ? `Timed out after ${formatTimeoutDuration(timeoutMs)}` : (completedMessage.errorMessage || "Side prompt failed."),
      model: `${model.provider}/${model.id}`,
      usage: completedMessage.usage as Usage | undefined,
      stopReason: timedOut ? "aborted" : completedMessage.stopReason,
    };
  }

  return {
    status: "success",
    result: extractAssistantText(completedMessage) || text || sideSession.getLastAssistantText() || null,
    thinking: extractAssistantThinking(completedMessage) || thinking || null,
    model: `${model.provider}/${model.id}`,
    usage: completedMessage.usage as Usage | undefined,
    stopReason: completedMessage.stopReason,
  };
}
