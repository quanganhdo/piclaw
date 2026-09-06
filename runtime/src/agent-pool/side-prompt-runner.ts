/**
 * agent-pool/side-prompt-runner.ts – runSidePrompt orchestration helpers.
 */

import type { AgentSession, AgentSessionEvent, AgentSessionRuntime, ModelRuntime } from "@earendil-works/pi-coding-agent";
import { type AssistantMessageEvent, type Usage } from "@earendil-works/pi-ai";

import { getAgentRuntimeConfig } from "../core/config.js";
import { readAccessConfig } from "../core/config-access.js";
import { detectChannel } from "../router.js";
import { withChatContext } from "../core/chat-context.js";
import { installSessionUsageRecorder, recordMessageUsage } from "./usage.js";
import { createLogger, debugSuppressedError } from "../utils/logger.js";
import { normalizeLlmContext } from "./llm-context-normalizer.js";
import {
  extractAssistantText,
  extractAssistantThinking,
  formatTimeoutDuration,
  SideAssistantMessage,
  toSideReasoning,
  waitForSessionIdle,
} from "./prompt-utils.js";
import type { SidePromptOptions, SidePromptResult } from "./contracts.js";

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
    await withChatContext(chatJid, channel, async () => {
      const composedPrompt = options.systemPrompt ? `${options.systemPrompt}\n\n${prompt}` : prompt;
      await sideSession.prompt(composedPrompt);
      await waitForSessionIdle(sideSession);
    });
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
