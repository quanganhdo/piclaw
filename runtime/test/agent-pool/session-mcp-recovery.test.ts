import { expect, test } from "bun:test";
import { mkdirSync, writeFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { SettingsManager } from "@earendil-works/pi-coding-agent";
import { withTempWorkspaceEnv } from "../helpers.js";
import { createSessionInDir } from "../../src/agent-pool/session.js";
import { createRealTestModelServices } from "../model-services-fixture.js";
import { resetMcpCodemodeRuntimeForTests } from "../../src/agent-pool/mcp-codemode-runtime.js";

for (const scenario of ["legacy-permissions", "invalid-policy"] as const) {
  test(`real session construction survives ${scenario} without exposing unsafe MCP`, async () => {
    await withTempWorkspaceEnv("session-mcp-recovery-", {}, async ws => {
      const path = join(ws.workspace, ".piclaw/config.json");
      mkdirSync(join(ws.workspace, ".piclaw"), { recursive: true });
      writeFileSync(path, JSON.stringify({ domains: { access: { mode: "single-user" }, mcp: scenario === "invalid-policy" ? { engine: "INVALID" } : { engine: "adapter", codemode: "auto" } } }), { mode: scenario === "legacy-permissions" ? 0o644 : 0o600 });
      resetMcpCodemodeRuntimeForTests();
      const agent = join(ws.base, "agent");
      const { modelRuntime } = await createRealTestModelServices(agent);
      const settingsManager = SettingsManager.create(ws.workspace, agent);
      let runtime: Awaited<ReturnType<typeof createSessionInDir>> | undefined;
      try {
        runtime = await createSessionInDir(join(ws.base, "session"), { modelRuntime, settingsManager, tools: [] } as any);
        expect(runtime.session).toBeDefined();
        if (scenario === "legacy-permissions") {
          expect(statSync(path).mode & 0o777).toBe(0o600);
          expect(runtime.session.getAllTools().some(tool => tool.name === "codemode")).toBe(true);
        } else {
          expect(runtime.session.getAllTools().some(tool => tool.name === "codemode" || tool.name === "mcp")).toBe(false);
          expect(runtime.diagnostics.some(item => item.message.includes("MCP and codemode disabled"))).toBe(true);
          expect(runtime.session.getAllTools().some(tool => tool.name === "read")).toBe(true);
        }
      } finally {
        runtime?.session.dispose();
        resetMcpCodemodeRuntimeForTests();
      }
    });
  }, 20000);
}
