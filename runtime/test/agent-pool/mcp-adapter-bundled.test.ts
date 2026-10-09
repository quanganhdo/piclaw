import { describe, expect, mock, test } from "bun:test";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { SettingsManager, getAgentDir } from "@earendil-works/pi-coding-agent";
import { setEnv, waitFor } from "../helpers.js";
import { createSessionInDir } from "../../src/agent-pool/session.ts";
import { getPreparedMcpConfig, hydrateMcpKeychainCredentials, resetMcpStartupStateForTests } from "../../src/secure/mcp-keychain.js";
import { createRealTestModelServices } from "../model-services-fixture.js";
import { executeCall, executeDescribe, executeList, executeSearch, executeStatus } from "../../../node_modules/pi-mcp-adapter/proxy-modes.ts";
import { createMcpStatusSnapshot } from "../../../node_modules/pi-mcp-adapter/mcp-status.ts";

describe("bundled pi-mcp-adapter integration", () => {
  test("binds one eager stdio process to each live Piclaw session owner", async () => {
    const tempRoot = mkdtempSync(join(tmpdir(), "piclaw-mcp-lifecycle-"));
    const { modelRuntime } = await createRealTestModelServices(join(tempRoot, "agent"));
    const sessionDir = join(tempRoot, "session");
    const workspaceDir = join(tempRoot, "workspace");
    const storeDir = join(tempRoot, "store");
    const dataDir = join(tempRoot, "data");
    const eventsPath = join(tempRoot, "mcp-lifecycle.jsonl");
    const fixturePath = join(tempRoot, "mcp-fixture.mjs");
    mkdirSync(join(workspaceDir, ".pi"), { recursive: true });
    mkdirSync(storeDir, { recursive: true });
    mkdirSync(dataDir, { recursive: true });
    writeFileSync(fixturePath, `
import { appendFileSync } from "node:fs";
import { createInterface } from "node:readline";
const eventsPath = process.argv[2];
let stopped = false;
const record = (event) => appendFileSync(eventsPath, JSON.stringify({ event, pid: process.pid }) + "\\n");
const stop = () => { if (!stopped) { stopped = true; record("exit"); } };
const send = (id, result) => process.stdout.write(JSON.stringify({ jsonrpc: "2.0", id, result }) + "\\n");
process.once("exit", stop);
for (const signal of ["SIGINT", "SIGTERM"]) process.once(signal, () => { stop(); process.exit(0); });
record("start");
createInterface({ input: process.stdin }).on("line", (line) => {
  const message = JSON.parse(line);
  record("request:" + message.method);
  if (message.id === undefined) return;
  if (message.method === "initialize") return send(message.id, {
    protocolVersion: message.params?.protocolVersion ?? "2025-06-18",
    capabilities: { tools: {} },
    serverInfo: { name: "piclaw-lifecycle-fixture", version: "1.0.0" },
  });
  if (message.method === "tools/list") return send(message.id, {
    tools: [{ name: "ping", description: "Return a lifecycle ping", inputSchema: { type: "object", properties: {} } }],
  });
  if (message.method === "resources/list") return send(message.id, { resources: [] });
  if (message.method === "prompts/list") return send(message.id, { prompts: [] });
  if (message.method === "tools/call") return send(message.id, { content: [{ type: "text", text: "pong" }], isError: false });
  send(message.id, {});
});
`);
    writeFileSync(join(workspaceDir, ".pi", "mcp.json"), JSON.stringify({
      mcpServers: {
        fixture: {
          command: process.execPath,
          args: [fixturePath, eventsPath],
          lifecycle: "eager",
        },
      },
    }));
    const restoreEnv = setEnv({
      PICLAW_WORKSPACE: workspaceDir,
      PICLAW_STORE: storeDir,
      PICLAW_DATA: dataDir,
      MCP_DIRECT_TOOLS: undefined,
    });
    const settingsManager = SettingsManager.create(workspaceDir, getAgentDir());
    const events = () => existsSync(eventsPath)
      ? readFileSync(eventsPath, "utf8").trim().split("\n").filter(Boolean).map((line) => JSON.parse(line) as { event: string; pid: number })
      : [];
    let runtime: Awaited<ReturnType<typeof createSessionInDir>> | null = null;

    try {
      await hydrateMcpKeychainCredentials(workspaceDir);
      expect(getPreparedMcpConfig()).toMatchObject({
        mcpServers: { fixture: { command: process.execPath, lifecycle: "eager" } },
      });
      runtime = await createSessionInDir(sessionDir, {
        modelRuntime,
        settingsManager,
        tools: [],
      });
      await Bun.sleep(100);
      expect(events(), "MCP must not spawn before Piclaw binds the session").toEqual([]);
      const extensionErrors: string[] = [];
      // The SDK only restarts extensions on reload when it has bindings. Match
      // Piclaw's real session binder, which always installs an error listener.
      await runtime.session.bindExtensions({ onError: error => extensionErrors.push(error.error) });

      const allTools = (runtime.session as any)._extensionRunner?.getAllRegisteredTools?.() ?? [];
      const mcpTool = allTools.find((tool: any) => tool.definition?.name === "mcp")?.definition;
      expect(mcpTool).toBeTruthy();
      const status = await mcpTool.execute("status", {});
      expect(status.details).toMatchObject({
        servers: [{ name: "fixture", status: "connected" }],
        connectedCount: 1,
      });
      await waitFor(() => events().some(({ event }) => event === "start"));
      const initialStarts = events().filter(({ event }) => event === "start");
      expect(initialStarts, JSON.stringify(events())).toHaveLength(1);

      const results = await Promise.all([
        mcpTool.execute("parallel-a", { tool: "ping", server: "fixture" }),
        mcpTool.execute("parallel-b", { tool: "ping", server: "fixture" }),
      ]);
      expect(results.every((result: any) => result.content?.[0]?.text?.includes("pong"))).toBe(true);
      expect(events().some(({ event }) => event === "request:server/discover")).toBe(false);
      expect(events().filter(({ event }) => event === "start")).toHaveLength(1);

      runtime.session.sessionManager.appendMessage({ role: "user", content: "Synthetic reload history", timestamp: 1 });
      const sessionId = runtime.session.sessionId;
      const history = JSON.stringify(runtime.session.sessionManager.getEntries());
      await runtime.session.reload();
      expect(extensionErrors).toEqual([]);
      await waitFor(() => events().filter(({ event }) => event === "exit").length >= 1);
      await waitFor(() => events().filter(({ event }) => event === "start").length >= 2);
      expect(runtime.session.sessionId).toBe(sessionId);
      expect(JSON.stringify(runtime.session.sessionManager.getEntries())).toBe(history);
      const afterReload = events();
      expect(afterReload.filter(({ event }) => event === "start")).toHaveLength(2);
      expect(afterReload.findIndex(({ event }) => event === "exit"))
        .toBeLessThan(afterReload.findIndex(({ event, pid }) => event === "start" && pid !== initialStarts[0].pid));

      await runtime.newSession();
      await waitFor(() => events().filter(({ event }) => event === "exit").length >= 2);
      await runtime.session.bindExtensions({});
      await waitFor(() => events().filter(({ event }) => event === "start").length >= 3);
      expect(events().filter(({ event }) => event === "start")).toHaveLength(3);

      await runtime.dispose();
      runtime = null;
      await waitFor(() => events().filter(({ event }) => event === "exit").length >= 3);
    } finally {
      if (runtime) await runtime.dispose();
      resetMcpStartupStateForTests();
      restoreEnv();
      rmSync(tempRoot, { recursive: true, force: true });
    }
  }, 30_000);

  test("enforces proxy include/exclude policy on stale discovery and before transport", async () => {
    const callTool = mock(async () => ({ isError: false, content: [{ type: "text", text: "ok" }] }));
    const connection = {
      status: "connected",
      tools: [
        { name: "retrieve", description: "Read data", inputSchema: { type: "object" } },
        { name: "delete_entity", description: "Delete data", inputSchema: { type: "object" } },
      ],
      resources: [],
      prompts: [],
      client: { callTool, readResource: mock() },
    };
    const state = {
      config: {
        settings: { toolPrefix: "server" },
        mcpServers: {
          workiq: {
            command: "workiq.exe",
            includeTools: ["retrieve"],
            excludeTools: ["delete_entity"],
          },
        },
      },
      manager: {
        getConnection: mock(() => connection),
        isConnecting: mock(() => false),
        getRequestOptions: mock(() => undefined),
        touch: mock(),
        incrementInFlight: mock(),
        decrementInFlight: mock(),
      },
      // Adapter 2.31 applies include/exclude policy before publishing metadata.
      toolMetadata: new Map([["workiq", [
        { name: "workiq_retrieve", originalName: "retrieve", description: "Read data" },
      ]]]),
      resourceCounts: new Map(),
      serverInstructions: new Map(),
      failureTracker: new Map(),
      completedUiSessions: [],
    } as any;

    expect(executeList(state, "workiq").details).toMatchObject({ tools: ["workiq_retrieve"], count: 1 });
    expect(executeSearch(state, "delete").details).toMatchObject({ matches: [], count: 0 });
    expect(executeDescribe(state, "workiq_delete_entity").details).toMatchObject({ error: "tool_not_found" });
    expect(executeStatus(state).details).toMatchObject({ totalTools: 1 });
    expect(createMcpStatusSnapshot(state)).toMatchObject({ totalTools: 1 });

    const denied = await executeCall(state, "workiq_delete_entity", {});
    expect(denied.details).toMatchObject({ error: "tool_not_found" });
    expect(callTool).not.toHaveBeenCalled();

    const allowed = await executeCall(state, "workiq_retrieve", { q: "status" });
    expect(allowed.content[0]?.text).toContain("ok");
    expect(callTool).toHaveBeenCalledTimes(1);
  });

  test("keeps the MCP proxy available when startup quarantines an invalid optional server", async () => {
    const tempRoot = mkdtempSync(join(tmpdir(), "piclaw-mcp-quarantine-"));
    const { modelRuntime } = await createRealTestModelServices(join(tempRoot, "agent"));
    const sessionDir = join(tempRoot, "session");
    const workspaceDir = join(tempRoot, "workspace");
    const storeDir = join(tempRoot, "store");
    const dataDir = join(tempRoot, "data");
    mkdirSync(join(workspaceDir, ".pi"), { recursive: true });
    mkdirSync(storeDir, { recursive: true });
    mkdirSync(dataDir, { recursive: true });
    writeFileSync(join(workspaceDir, ".pi", "mcp.json"), JSON.stringify({
      mcpServers: {
        broken: { bearerTokenKeychain: "broken/token" },
      },
    }));
    const restoreEnv = setEnv({ PICLAW_WORKSPACE: workspaceDir, PICLAW_STORE: storeDir, PICLAW_DATA: dataDir });
    const settingsManager = SettingsManager.create(workspaceDir, getAgentDir());

    try {
      await hydrateMcpKeychainCredentials(workspaceDir, async (name) => ({
        name,
        type: "token",
        secret: "unused",
        username: null,
      }));
      const runtime = await createSessionInDir(sessionDir, {
        modelRuntime,
        settingsManager,
        tools: [],
        cwd: workspaceDir,
      });
      const allTools = (runtime.session as any)._extensionRunner?.getAllRegisteredTools?.() ?? [];
      expect(allTools.some((tool: any) => tool.definition?.name === "mcp")).toBe(true);
      runtime.session.dispose?.();
    } finally {
      resetMcpStartupStateForTests();
      restoreEnv();
      rmSync(tempRoot, { recursive: true, force: true });
    }
  }, 20_000);

  test("registers the mcp proxy tool and slash commands for piclaw sessions", async () => {
    const tempRoot = mkdtempSync(join(tmpdir(), "piclaw-mcp-adapter-"));
    const { modelRuntime } = await createRealTestModelServices(join(tempRoot, "agent"));
    const sessionDir = join(tempRoot, "session");
    const workspaceDir = join(tempRoot, "workspace");
    const storeDir = join(tempRoot, "store");
    const dataDir = join(tempRoot, "data");
    mkdirSync(workspaceDir, { recursive: true });
    mkdirSync(storeDir, { recursive: true });
    mkdirSync(dataDir, { recursive: true });
    const restoreEnv = setEnv({ PICLAW_WORKSPACE: workspaceDir, PICLAW_STORE: storeDir, PICLAW_DATA: dataDir });
    const settingsManager = SettingsManager.create(workspaceDir, getAgentDir());

    try {
      const runtime = await createSessionInDir(sessionDir, {
        modelRuntime,
        settingsManager,
        tools: [],
        cwd: workspaceDir,
      });

      const session: any = runtime.session;
      const allTools = session._extensionRunner?.getAllRegisteredTools?.() ?? [];
      const mcpTool = allTools.find((t: any) => t.definition?.name === "mcp");
      expect(mcpTool).toBeTruthy();
      const tool = mcpTool;
      expect(typeof tool?.definition?.description).toBe("string");
      expect(tool.definition.description).toContain("MCP");

      expect(typeof session.extensionRunner?.getCommand).toBe("function");
      const mcpCommand = session.extensionRunner.getCommand("mcp");
      expect(mcpCommand).toBeTruthy();
      expect(typeof mcpCommand?.description).toBe("string");
      expect(mcpCommand.description).toContain("MCP");
      expect(session.extensionRunner.getCommand("mcp-auth")).toBeTruthy();

      session.dispose?.();
    } finally {
      restoreEnv();
      rmSync(tempRoot, { recursive: true, force: true });
    }
  }, 20_000);
});
