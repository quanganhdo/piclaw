import { afterEach, describe, expect, test } from "bun:test";
import { mkdtempSync, readFileSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { SessionManager, SettingsManager, getAgentDir } from "@earendil-works/pi-coding-agent";
import "../helpers.js";
import { createSessionInDir, trimPreCompactionEntries } from "../../src/agent-pool/session.ts";
import { createRealTestModelServices } from "../model-services-fixture.js";

function makeAssistantMessage(text = "ready") {
  return {
    role: "assistant",
    content: [{ type: "text", text }],
    stopReason: "end_turn",
    timestamp: Date.now(),
  } as any;
}

function makeOversizedReadToolResult(imageChars = 1_500_000) {
  return {
    role: "toolResult",
    toolCallId: "call-test",
    toolName: "read",
    content: [
      {
        type: "text",
        text: "Read image file [image/png] [Image: original 1080x2828, displayed at 764x2000. Multiply coordinates by 1.41 to map to original image.]",
      },
      {
        type: "image",
        data: "A".repeat(imageChars),
        mimeType: "image/png",
      },
    ],
    timestamp: Date.now(),
  } as any;
}

describe("session persistence sanitizer", () => {
  const originalWarn = console.warn;

  afterEach(() => {
    console.warn = originalWarn;
  });

  test("createSessionInDir sanitizes oversized persisted tool results before resume", { timeout: 15000 }, async () => {
    console.warn = () => {};
    const tempRoot = mkdtempSync(join(tmpdir(), "piclaw-session-sanitize-resume-"));
    const sessionDir = join(tempRoot, "session");
    const workspaceDir = process.env.PICLAW_WORKSPACE || "/workspace";
    const { modelRuntime } = await createRealTestModelServices(join(tempRoot, "agent"));
    const settingsManager = SettingsManager.create(workspaceDir, getAgentDir());

    try {
      const seed = SessionManager.create(workspaceDir, sessionDir);
      seed.appendMessage(makeAssistantMessage());
      seed.appendMessage(makeOversizedReadToolResult());

      const sessionFile = seed.getSessionFile();
      expect(sessionFile).toBeTruthy();
      const beforeSize = statSync(sessionFile!).size;
      expect(beforeSize).toBeGreaterThan(500_000);
      const beforeText = readFileSync(sessionFile!, "utf8");
      expect(beforeText).toContain('"type":"image"');

      const runtime = await createSessionInDir(sessionDir, {
        modelRuntime,
        settingsManager,
        tools: [],
        chatJid: "web:test",
      });

      const afterSize = statSync(sessionFile!).size;
      const afterText = readFileSync(sessionFile!, "utf8");
      const context = runtime.session.sessionManager.buildSessionContext();
      const toolResult = context.messages.find((message: any) => message.role === "toolResult") as any;

      expect(afterSize).toBeLessThan(beforeSize / 4);
      expect(afterText).not.toContain('"type":"image"');
      expect(toolResult).toBeTruthy();
      expect(Array.isArray(toolResult.content)).toBe(true);
      expect(toolResult.content.some((block: any) => block?.type === "image")).toBe(false);
      expect(toolResult.content.some((block: any) => block?.type === "text" && String(block.text || "").includes("Persisted tool result sanitized"))).toBe(true);

      await runtime.dispose();
    } finally {
      rmSync(tempRoot, { recursive: true, force: true });
    }
  });

  test.each(["high", "off"] as const)("pre-compaction trimming carries model, effective %s and preferred high across cold hydration", (effective) => {
    const tempRoot = mkdtempSync(join(tmpdir(), "piclaw-session-trim-thinking-"));
    const sessionDir = join(tempRoot, "session");
    const workspaceDir = process.env.PICLAW_WORKSPACE || "/workspace";

    try {
      const seed = SessionManager.create(workspaceDir, sessionDir);
      seed.appendModelChange("openai-codex", "gpt-5.6-sol");
      seed.appendThinkingLevelChange(effective);
      seed.appendCustomEntry('piclaw.thinking-policy.v1', { preferred: 'high' });
      for (let index = 0; index < 8; index += 1) {
        seed.appendMessage({
          role: "user",
          content: [{ type: "text", text: `discarded-${index}-${"x".repeat(90_000)}` }],
          timestamp: Date.now(),
        } as any);
      }
      const firstKeptEntryId = seed.appendMessage({
        role: "user",
        content: [{ type: "text", text: "retained user request" }],
        timestamp: Date.now(),
      } as any);
      seed.appendMessage({
        ...makeAssistantMessage("retained answer"),
        provider: "openai-codex",
        model: "gpt-5.6-sol",
      } as any);
      seed.appendCompaction("## Goal\nPreserve retained work", firstKeptEntryId, 200_000);

      const sessionFile = seed.getSessionFile();
      expect(sessionFile).toBeTruthy();
      expect(statSync(sessionFile!).size).toBeGreaterThan(512 * 1024);

      trimPreCompactionEntries(sessionDir);

      const trimmedText = readFileSync(sessionFile!, "utf8");
      const entries = trimmedText.trim().split("\n").map((line) => JSON.parse(line));
      const carriedModel = entries.find((entry) => entry.id === "trim-model");
      const carriedThinking = entries.find((entry) => entry.id === "trim-thinking");
      const resumed = SessionManager.continueRecent(workspaceDir, sessionDir).buildSessionContext();

      expect(carriedModel).toMatchObject({
        type: "model_change",
        provider: "openai-codex",
        modelId: "gpt-5.6-sol",
      });
      expect(carriedThinking).toMatchObject({ type: "thinking_level_change", thinkingLevel: effective });
      expect(entries.find(entry => entry.id === 'trim-thinking-preference')?.data).toEqual({ preferred: 'high' });
      expect(resumed.model).toEqual({ provider: "openai-codex", modelId: "gpt-5.6-sol" });
      expect(resumed.thinkingLevel).toBe(effective);
      expect(resumed.messages.some((message: any) => JSON.stringify(message.content ?? "").includes("retained user request"))).toBe(true);
      expect(trimmedText).not.toContain("discarded-0-");
    } finally {
      rmSync(tempRoot, { recursive: true, force: true });
    }
  });

  test("createSessionInDir sanitizes oversized future tool results on append", async () => {
    console.warn = () => {};
    const tempRoot = mkdtempSync(join(tmpdir(), "piclaw-session-sanitize-append-"));
    const sessionDir = join(tempRoot, "session");
    const workspaceDir = process.env.PICLAW_WORKSPACE || "/workspace";
    const { modelRuntime } = await createRealTestModelServices(join(tempRoot, "agent"));
    const settingsManager = SettingsManager.create(workspaceDir, getAgentDir());

    try {
      const runtime = await createSessionInDir(sessionDir, {
        modelRuntime,
        settingsManager,
        tools: [],
        chatJid: "web:test",
      });

      runtime.session.sessionManager.appendMessage(makeAssistantMessage("seed"));
      const sanitized = await runtime.session.extensionRunner.emitMessageEnd({
        type: "message_end",
        message: makeOversizedReadToolResult(),
      });
      runtime.session.sessionManager.appendMessage(sanitized ?? makeOversizedReadToolResult());

      const sessionFile = runtime.session.sessionFile;
      expect(sessionFile).toBeTruthy();
      const sessionText = readFileSync(sessionFile!, "utf8");
      const context = runtime.session.sessionManager.buildSessionContext();
      const toolResult = context.messages.find((message: any) => message.role === "toolResult") as any;

      expect(sessionText).not.toContain('"type":"image"');
      expect(toolResult).toBeTruthy();
      expect(toolResult.content.some((block: any) => block?.type === "image")).toBe(false);
      expect(toolResult.content.some((block: any) => block?.type === "text" && String(block.text || "").includes("Persisted tool result sanitized"))).toBe(true);

      await runtime.dispose();
    } finally {
      rmSync(tempRoot, { recursive: true, force: true });
    }
  });
});
