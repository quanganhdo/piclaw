import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Type } from "@sinclair/typebox";
import { createAgentSession, createAgentSessionRuntime, DefaultResourceLoader, ModelRuntime, SessionManager, SettingsManager, type ExtensionFactory } from "@earendil-works/pi-coding-agent";
import { InMemoryCredentialStore } from "@earendil-works/pi-ai";
import { DEFAULT_MCP_ENGINE_POLICY, type McpEnginePolicy } from "../../../src/agent-pool/mcp-engine-policy.js";
import { McpEngineSwitchCoordinator, type McpReloadSession } from "../../../src/agent-pool/mcp-engine-switch.js";

const root = mkdtempSync(join(tmpdir(), "mcp-engine-reload-"));
const originalFetch = globalThis.fetch;
let networkAttempts = 0;
const deny = () => { networkAttempts++; throw new Error("Network forbidden."); };
globalThis.fetch = Object.assign(deny, { preconnect: deny }) as typeof fetch;
let selection: Readonly<McpEnginePolicy> = DEFAULT_MCP_ENGINE_POLICY;
const events: string[] = [];
let unrelatedLoads = 0, fenced = false;
const ownerFactory = (id: string): ExtensionFactory => pi => {
  const owner = selection.engine;
  events.push(`load:${id}:${owner}`);
  pi.registerTool({ name: `synthetic_${owner}`, label: `Synthetic ${owner}`, description: "No MCP connection or inference.", parameters: Type.Object({}),
    execute: async () => ({ content: [{ type: "text", text: owner }], details: {} }) });
  pi.on("session_start", async () => { events.push(`start:${id}:${owner}`); });
  pi.on("session_shutdown", async () => { events.push(`stop:${id}:${owner}`); });
};
const unrelated: ExtensionFactory = pi => {
  unrelatedLoads++;
  pi.on("session_shutdown", async () => { events.push("stop:unrelated"); });
};
const runtimes: Awaited<ReturnType<typeof createAgentSessionRuntime>>[] = [];
try {
  const modelRuntime = await ModelRuntime.create({ credentials: new InMemoryCredentialStore(), modelsPath: null, refreshOnCreate: false, allowModelNetwork: false });
  for (const id of ["a", "b"]) {
    const agentDir = join(root, id);
    const settingsManager = SettingsManager.inMemory();
    const loader = new DefaultResourceLoader({ cwd: root, agentDir, settingsManager, noExtensions: true, noSkills: true, noPromptTemplates: true, noThemes: true, noContextFiles: true,
      extensionFactories: [ownerFactory(id), unrelated] });
    await loader.reload();
    const runtime = await createAgentSessionRuntime(async ({ sessionManager }) => {
      const result = await createAgentSession({ cwd: root, agentDir, modelRuntime, sessionManager, settingsManager, resourceLoader: loader, noTools: "builtin" });
      await result.session.bindExtensions({ mode: "rpc", onError: () => { throw new Error("Unexpected extension error."); } });
      return { ...result, services: { cwd: root, agentDir, modelRuntime, settingsManager, resourceLoader: loader, diagnostics: [] }, diagnostics: [] };
    }, { cwd: root, agentDir, sessionManager: SessionManager.inMemory(root) });
    runtime.session.sessionManager.appendMessage({ role: "user", content: `preserved history ${id}`, timestamp: Date.now() });
    runtimes.push(runtime);
  }
  const sessionIds = runtimes.map(runtime => runtime.session.sessionId);
  const histories = runtimes.map(runtime => JSON.stringify(runtime.session.sessionManager.getEntries()));
  assert.equal(unrelatedLoads, 2);
  for (const runtime of runtimes) assert.ok(runtime.session.getAllTools().some(tool => tool.name === "synthetic_adapter"));
  events.length = 0;
  const participants: McpReloadSession[] = runtimes.map(runtime => runtime.session);
  const coordinator = new McpEngineSwitchCoordinator({
    validate: () => {}, blockAdmissions: () => { fenced = true; }, fenceAndSnapshot: async () => participants,
    select: policy => { selection = policy; }, persist: async () => { events.push("persist"); },
    quarantine: async session => { const index = participants.indexOf(session); if (index >= 0) await runtimes[index].dispose(); },
    resume: () => { fenced = false; },
  }, selection, 5000);
  await coordinator.apply({ engine: "native", codemode: "auto" });
  assert.equal(fenced, false); assert.equal(unrelatedLoads, 4);
  assert.deepEqual(runtimes.map(runtime => runtime.session.sessionId), sessionIds);
  assert.deepEqual(runtimes.map(runtime => JSON.stringify(runtime.session.sessionManager.getEntries())), histories);
  const starts = events.flatMap((event, index) => event.startsWith("start:") ? [index] : []);
  assert.equal(starts.length, 2);
  const stops = events.flatMap((event, index) => event.startsWith("stop:") ? [index] : []);
  assert.equal(stops.length, 4);
  assert.ok(Math.max(...stops) < Math.min(...starts));
  assert.ok(events.indexOf("persist") < Math.min(...starts));
  for (const runtime of runtimes) {
    const names = runtime.session.getAllTools().map(tool => tool.name);
    assert.ok(names.includes("synthetic_native")); assert.ok(!names.includes("synthetic_adapter"));
  }
  assert.equal(networkAttempts, 0);
  console.log(JSON.stringify({ runtime: `Bun ${Bun.version}`, scope: "public_sdk_reload_lifecycle_with_synthetic_owner_factories", sessions: 2,
    preservedSessionIds: true, preservedHistory: true, allExtensionsReloaded: true, oldToolsRemoved: true, shutdownBeforeStartup: true, networkAttempts,
    realMcpConnections: "not_exercised", activeAgentTurn: "not_exercised" }));
} finally {
  for (const runtime of runtimes) await runtime.dispose();
  globalThis.fetch = originalFetch; rmSync(root, { recursive: true, force: true });
}
