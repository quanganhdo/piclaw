import { describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Type } from "typebox";
import { SettingsManager, getAgentDir, type ExtensionFactory } from "@earendil-works/pi-coding-agent";
import type { AssistantMessage, ToolCall } from "@earendil-works/pi-ai";
import { currentContextTools } from "../../src/extensions/transcript-context-compat.js";
import { registerFauxProvider } from "@earendil-works/pi-ai/compat";
import "../helpers.js";
import { createSessionInDir } from "../../src/agent-pool/session.ts";
import { createRealTestModelServices } from "../model-services-fixture.js";

function fauxToolCall(name: string, args: Record<string, unknown>): ToolCall {
  return {
    type: "toolCall",
    id: `call_${name}`,
    name,
    arguments: args,
  };
}

function fauxAssistantMessage(content: string | ToolCall): AssistantMessage {
  return {
    role: "assistant",
    content: typeof content === "string" ? [{ type: "text", text: content }] : [content],
    api: "faux",
    provider: "faux",
    model: "faux",
    usage: {
      input: 0,
      output: 0,
      cacheRead: 0,
      cacheWrite: 0,
      totalTokens: 0,
      cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
    },
    stopReason: typeof content === "string" ? "stop" : "toolUse",
    timestamp: Date.now(),
  };
}

const customExtension: ExtensionFactory = (pi) => {
  pi.registerTool({
    name: "demo_extension_tool",
    label: "demo_extension_tool",
    description: "Demo extension tool",
    parameters: Type.Object({ value: Type.String() }),
    async execute(_toolCallId: string, params: { value: string }) {
      return {
        content: [{ type: "text" as const, text: `demo:${params.value}` }],
        details: { ok: true, echoed: params.value },
      };
    },
  });
};

describe("same-turn tool activation live update", () => {
  test("extension tools activated via activate_tools are callable in the same turn", async () => {
    const settingsManager = SettingsManager.create("/workspace", getAgentDir());
    const tempRoot = mkdtempSync(join(tmpdir(), "piclaw-issue13-"));
    const workspaceDir = join(tempRoot, "workspace");
    mkdirSync(workspaceDir, { recursive: true });
    const sessionDir = join(tempRoot, "session");
    const previousWorkspace = process.env.PICLAW_WORKSPACE;
    process.env.PICLAW_WORKSPACE = workspaceDir;
    // The compat API registry is process-global. Use a unique API/provider/model
    // namespace so parallel test files cannot replace this registration or
    // consume this test's queued responses.
    const namespace = `tool-activation-${process.pid}-${Date.now()}-${Math.random().toString(36).slice(2)}`;
    const providerId = `faux-${namespace}`;
    const faux = registerFauxProvider({
      api: providerId,
      provider: providerId,
      models: [{ id: providerId, name: `Faux ${namespace}` }],
    });
    const { credentialStore, modelRuntime } = await createRealTestModelServices(join(tempRoot, "agent"));
    await credentialStore.modify(providerId, async () => ({ type: "api_key", key: "test-key" }));
    modelRuntime.registerProvider(providerId, {
      baseUrl: "https://example.invalid/v1",
      api: providerId,
      apiKey: "test-key",
      models: [faux.getModel()],
    });
    await modelRuntime.refresh({ allowNetwork: false });

    try {
      const runtime = await createSessionInDir(sessionDir, {
        modelRuntime,
        settingsManager,
        tools: [],
        extensionFactories: [customExtension],
      });
      const session: any = runtime.session;
      session.agent.state.model = faux.getModel();
      session.setActiveToolsByName(["activate_tools"]);

      const observedToolNames: string[] = [];
      faux.setResponses([
        fauxAssistantMessage(fauxToolCall("activate_tools", { names: ["demo_extension_tool"] })),
        (context) => {
          observedToolNames.push(...currentContextTools(context).map((tool) => tool.name));
          return fauxAssistantMessage(
            observedToolNames.includes("demo_extension_tool")
              ? fauxToolCall("demo_extension_tool", { value: "same-turn" })
              : "demo tool missing from context",
          );
        },
        fauxAssistantMessage("done"),
      ]);

      await session.prompt("activate and use the demo extension tool");

      const assistantTexts = session.agent.state.messages
        .filter((message) => message.role === "assistant")
        .flatMap((message) => message.content)
        .filter((block) => block.type === "text")
        .map((block) => block.text);
      expect(assistantTexts).toContain("done");
      expect(faux.getPendingResponseCount()).toBe(0);

      const toolResults = session.agent.state.messages.filter((message) => message.role === "toolResult");
      expect(toolResults.map((message) => message.toolName)).toContain("demo_extension_tool");
      expect(toolResults.some((message) => message.toolName === "demo_extension_tool" && message.isError)).toBe(false);
      expect(observedToolNames).toContain("demo_extension_tool");
    } finally {
      faux.unregister();
      if (previousWorkspace === undefined) delete process.env.PICLAW_WORKSPACE;
      else process.env.PICLAW_WORKSPACE = previousWorkspace;
      rmSync(tempRoot, { recursive: true, force: true });
    }
  }, 30_000);
});
