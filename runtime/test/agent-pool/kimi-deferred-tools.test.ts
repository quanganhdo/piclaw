import { describe, expect, test } from "bun:test";
import { Type } from "typebox";
import { streamSimple } from "@earendil-works/pi-ai/api/openai-completions";
import { normalizeContext, type AssistantMessage, type Context, type Model, type Tool, type ToolResultMessage } from "@earendil-works/pi-ai";

function assistantToolCall(): AssistantMessage {
  return {
    role: "assistant",
    content: [{
      type: "toolCall",
      id: "call_activate_tools",
      name: "activate_tools",
      arguments: { names: ["demo_extension_tool"] },
    }],
    api: "openai-completions",
    provider: "moonshotai",
    model: "kimi-test",
    usage: {
      input: 0,
      output: 0,
      cacheRead: 0,
      cacheWrite: 0,
      totalTokens: 0,
      cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
    },
    stopReason: "toolUse",
    timestamp: 1,
  };
}

function activationResult(): ToolResultMessage {
  return {
    role: "toolResult",
    toolCallId: "call_activate_tools",
    toolName: "activate_tools",
    content: [{ type: "text", text: "Activated demo_extension_tool." }],
    addedToolNames: ["demo_extension_tool"],
    isError: false,
    timestamp: 2,
  };
}

const activateTools: Tool = {
  name: "activate_tools",
  description: "Activate one or more available tools for the current session.",
  parameters: Type.Object({ names: Type.Array(Type.String()) }),
};

const demoTool: Tool = {
  name: "demo_extension_tool",
  description: "Demo extension tool activated during this turn.",
  parameters: Type.Object({ value: Type.String() }),
};

function model(baseUrl: string, kimi: boolean): Model<"openai-completions"> {
  return {
    id: "kimi-test",
    name: "Kimi deferred-tools fixture",
    api: "openai-completions",
    provider: "moonshotai",
    baseUrl,
    reasoning: false,
    input: ["text"],
    cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
    contextWindow: 128_000,
    maxTokens: 4096,
    ...(kimi ? { compat: { supportsMidConvoSystemMessages: true, supportsMidConvoToolAdditions: true } } : {}),
  };
}

function context(): Context {
  const initial = normalizeContext({ messages: [], tools: [activateTools] });
  return {
    messages: [
      ...initial.messages,
      assistantToolCall(),
      activationResult(),
      { role: "system", content: "", toolsAdded: [demoTool], timestamp: 3 },
    ],
  };
}

async function captureRequest(kimi: boolean): Promise<Record<string, any>> {
  let requestBody: Record<string, any> | undefined;
  const stream = streamSimple(model("https://example.invalid/v1", kimi), normalizeContext(context()), {
    apiKey: "test-key",
    maxRetries: 0,
    onPayload(payload) {
      requestBody = structuredClone(payload) as Record<string, any>;
      throw new Error("request captured before network dispatch");
    },
  });
  for await (const _event of stream) {
    // Consume the terminal provider error emitted after the intentional capture.
  }
  if (!requestBody) throw new Error("Provider fixture did not construct a request");
  return requestBody;
}

function topLevelToolNames(body: Record<string, any>): string[] {
  return (body.tools ?? []).map((tool: any) => tool.function?.name).filter(Boolean);
}

describe("Kimi deferred-tool compatibility", () => {
  test("serializes Piclaw same-turn activation at the tool-result position", async () => {
    const body = await captureRequest(true);

    expect(topLevelToolNames(body)).toEqual(["activate_tools"]);
    const activationResultIndex = body.messages.findIndex(
      (message: any) => message.role === "tool" && message.tool_call_id === "call_activate_tools",
    );
    expect(activationResultIndex).toBeGreaterThanOrEqual(0);

    const deferredMessage = body.messages[activationResultIndex + 1];
    expect(deferredMessage).toEqual({
      role: "system",
      tools: [{
        type: "function",
        function: {
          name: "demo_extension_tool",
          description: "Demo extension tool activated during this turn.",
          parameters: {
            type: "object",
            properties: { value: { type: "string" } },
            required: ["value"],
          },
        },
      }],
    });
  });

  test("keeps ordinary top-level tool serialization for non-Kimi models", async () => {
    const body = await captureRequest(false);

    expect(topLevelToolNames(body)).toEqual(["activate_tools", "demo_extension_tool"]);
    expect(body.messages.some((message: any) => message.role === "system" && Array.isArray(message.tools))).toBe(false);
  });
});
