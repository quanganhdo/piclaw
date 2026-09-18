import { expect, test } from "bun:test";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import {
  SettingsManager,
  DefaultResourceLoader,
} from "@earendil-works/pi-coding-agent";
import { initDatabase, getDb } from "../../src/db.js";
import { AddonOperationService } from "../../src/addons/operation-service.js";
import {
  operationSessionProfile,
  operationSessionTools,
} from "../../src/agent-pool/operation-session-profile.js";
import { createTempWorkspace } from "../helpers.js";
import { createSessionInDir } from "../../src/agent-pool/session.js";
import { createRealTestModelServices } from "../model-services-fixture.js";

test("operation resource loader excludes ambient skills, context, extensions and prompt appendices", async () => {
  initDatabase();
  getDb().exec(
    "DELETE FROM addon_operation_events;DELETE FROM addon_operations;",
  );
  const service = new AddonOperationService({
    authorize: () => ({
      decision: "allow",
      grant: {
        target: "task",
        revision: "r1",
        allowedTools: ["read"],
        maxToolCalls: 1,
        timeoutMs: 1000,
        parentWorkId: null,
      },
    }),
    execute: async () => ({ status: "completed" }),
  });
  const ws = createTempWorkspace("operation-resources-");
  try {
    const receipt = await service
      .bind({ addonId: "fixture", principalId: "alice" })
      .admit({
        target: "task",
        idempotencyKey: "resource",
        text: "external input",
      });
    await service.waitForIdle();
    const chat = "operation:" + receipt.operation!.id;
    const profile = operationSessionProfile(chat)!;
    expect(operationSessionProfile("web:default")).toBeNull();
    expect(() => operationSessionProfile("operation:missing")).toThrow(
      "admitted",
    );
    expect(operationSessionTools(chat)).toEqual(["read"]);
    mkdirSync(join(ws.base, ".pi", "extensions"), { recursive: true });
    mkdirSync(join(ws.base, ".pi", "skills", "private"), { recursive: true });
    writeFileSync(
      join(ws.base, "AGENTS.md"),
      "DO NOT EXPOSE: private workspace context",
    );
    writeFileSync(join(ws.base, ".pi", "SYSTEM.md"), "private system prompt");
    writeFileSync(join(ws.base, ".pi", "APPEND_SYSTEM.md"), "private appendix");
    writeFileSync(
      join(ws.base, ".pi", "extensions", "private.ts"),
      'throw new Error("Ambient extension executed");',
    );
    writeFileSync(
      join(ws.base, ".pi", "skills", "private", "SKILL.md"),
      "---\nname: private\ndescription: private skill\n---\nprivate",
    );
    const loader = new DefaultResourceLoader({
      cwd: ws.base,
      agentDir: join(ws.base, "agent"),
      settingsManager: SettingsManager.inMemory({}),
      ...profile,
    });
    await loader.reload();
    expect(loader.getExtensions().extensions).toHaveLength(0);
    expect(loader.getSkills().skills).toHaveLength(0);
    expect(loader.getAgentsFiles().agentsFiles).toHaveLength(0);
    expect(loader.getSystemPrompt()).not.toContain("private system prompt");
    expect(loader.getSystemPrompt()).not.toContain("DO NOT EXPOSE");
    expect(loader.getSystemPrompt()).toContain("externally requested");
    expect(loader.getAppendSystemPrompt()).toEqual([]);
    const { modelRuntime } = await createRealTestModelServices(
      join(ws.base, "agent"),
    );
    const runtime = await createSessionInDir(join(ws.base, "sessions"), {
      modelRuntime,
      settingsManager: SettingsManager.inMemory({}),
      tools: [],
      chatJid: chat,
      extensionFactories: [
        () => {
          throw new Error("Ambient factory invoked");
        },
      ],
      customTools: [{ name: "forbidden_extension", description: "never load" }],
    });
    try {
      expect(runtime.session.getActiveToolNames()).toEqual(["read"]);
      expect(runtime.session.systemPrompt).toContain("externally requested");
      expect(runtime.session.systemPrompt).not.toContain("DO NOT EXPOSE");
      expect(
        runtime.services.resourceLoader.getExtensions().extensions,
      ).toHaveLength(0);
    } finally {
      runtime.session.dispose();
    }
  } finally {
    service.shutdown();
    await service.waitForIdle();
    ws.cleanup();
  }
});
