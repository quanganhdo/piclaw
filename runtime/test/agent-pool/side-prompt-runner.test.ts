import { expect, test } from "bun:test";

import { runSidePrompt } from "../helpers/legacy-side-prompt-runner.js";
import { initDatabase } from "../../src/db.js";
import { getDb } from "../../src/db/connection.js";

test("runSidePrompt returns an error when no model is active", async () => {
  const result = await runSidePrompt("web:default", "hello", {}, {
    getOrCreate: async () => ({ model: null }) as any,
    getOrCreateSideRuntime: async () => ({ session: {} }) as any,
    syncSideSessionFromMain: async () => {},
    modelRuntime: { streamSimple: () => { throw new Error("not called"); } } as any,
  });

  expect(result.status).toBe("error");
  expect(result.error).toContain("No active model selected");
});

test("runSidePrompt routes simple side prompts through the shared ModelRuntime", async () => {
  const seen: Array<{ prompt: string; reasoning: unknown; signal: unknown }> = [];
  const session = {
    model: { provider: "openai", id: "gpt-test", reasoning: true },
    thinkingLevel: "high",
  };
  const signal = new AbortController().signal;
  const streamSimple = (_model: any, context: any, options: any) => {
    seen.push({
      prompt: String(context.messages[0].content[0].text),
      reasoning: options?.reasoning,
      signal: options?.signal,
    });
    return (async function* () {
      yield { type: "thinking_delta", delta: "plan" } as any;
      yield { type: "text_delta", delta: "answer" } as any;
      yield {
        type: "done",
        message: {
          role: "assistant",
          content: [{ type: "text", text: "answer" }],
          usage: { totalTokens: 1 },
          stopReason: "stop",
        },
      } as any;
    })() as any;
  };

  const result = await runSidePrompt("web:default", "hello", { systemPrompt: "brief", signal }, {
    getOrCreate: async () => session as any,
    getOrCreateSideRuntime: async () => ({ session: {} }) as any,
    syncSideSessionFromMain: async () => {},
    modelRuntime: { streamSimple } as any,
    sideStreamSimple: streamSimple as any,
  });

  expect(result.status).toBe("success");
  expect(result.result).toBe("answer");
  expect(result.thinking).toBe("plan");
  expect(result.model).toBe("openai/gpt-test");
  expect(seen).toEqual([{ prompt: "hello", reasoning: "high", signal }]);
});

test("runSidePrompt records side-session assistant and tool-result usage once", async () => {
  initDatabase();
  const db = getDb();
  const chatJid = "web:side-usage-regression";
  const listeners = new Set<(event: unknown) => void>();
  const emit = (event: unknown) => {
    for (const listener of listeners) listener(event);
  };
  let promptCalled = false;
  const sideSession = {
    model: { provider: "openai", id: "gpt-test" },
    thinkingLevel: "medium",
    subscribe(callback: (event: unknown) => void) {
      listeners.add(callback);
      return () => {
        listeners.delete(callback);
      };
    },
    async prompt() {
      promptCalled = true;
      emit({
        type: "message_end",
        message: {
          role: "assistant",
          content: [{ type: "toolCall", id: "call_1", name: "delegate", arguments: {} }],
          stopReason: "toolUse",
          usage: { input: 10, output: 5, cacheRead: 0, cacheWrite: 0, totalTokens: 15, cost: { total: 0.0015 } },
          timestamp: "2026-01-01T00:00:00Z",
        },
      });
      emit({
        type: "message_end",
        message: {
          role: "toolResult",
          toolCallId: "call_1",
          toolName: "delegate",
          content: [{ type: "text", text: "ok" }],
          usage: { input: 3, output: 2, cacheRead: 0, cacheWrite: 0, totalTokens: 5, cost: { total: 0.0005 } },
          timestamp: "2026-01-01T00:00:01Z",
        },
      });
      emit({
        type: "message_end",
        message: {
          role: "assistant",
          content: [{ type: "text", text: "done" }],
          stopReason: "stop",
          usage: { input: 11, output: 4, cacheRead: 0, cacheWrite: 0, totalTokens: 15, cost: { total: 0.0011 } },
          timestamp: "2026-01-01T00:00:02Z",
        },
      });
    },
    getLastAssistantText: () => "done",
    async abort() {},
  };

  const result = await runSidePrompt(chatJid, "hello", {}, {
    getOrCreate: async () => ({
      model: { provider: "openai", id: "gpt-test" },
      thinkingLevel: "medium",
    }) as any,
    getOrCreateSideRuntime: async () => ({ session: sideSession }) as any,
    syncSideSessionFromMain: async () => {},
    modelRuntime: { streamSimple: () => { throw new Error("not called"); } } as any,
  });

  expect(promptCalled).toBe(true);
  expect(result.status).toBe("success");
  expect(result.result).toBe("done");
  const rows = db.prepare("SELECT usage_source, total_tokens FROM token_usage WHERE chat_jid = ? ORDER BY run_at ASC").all(chatJid) as any[];
  expect(rows).toEqual([
    { usage_source: "assistant", total_tokens: 15 },
    { usage_source: "tool", total_tokens: 5 },
    { usage_source: "assistant", total_tokens: 15 },
  ]);
});
