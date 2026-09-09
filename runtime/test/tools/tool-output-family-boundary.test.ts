import { expect, test } from "bun:test";
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { createTempWorkspace, withTempWorkspaceEnv, waitFor } from "../helpers.js";
import { closeDatabase, getDb, initDatabase } from "../../src/db.js";
import * as output from "../../src/tool-output.js";
import { createBatchExecTool, createContextBashTool, createToolOutputSearchTool } from "../../src/tools/context-tools.js";
import { withExecutionIdentity, type ExecutionIdentity } from "../../src/core/execution-context.js";
import { createToolOutputAccessGuard, ToolOutputAccessDenied } from "../../src/core/tool-output-access.js";
import { createFakeExtensionApi } from "../extensions/fake-extension-api.js";

let contextMode: typeof import("../../extensions/integrations/context-mode.js");
function __setSemanticToolResultSummarizerForTests(summarizer: Parameters<typeof contextMode.__setSemanticToolResultSummarizerForTests>[0]) {
  contextMode.__setSemanticToolResultSummarizerForTests(summarizer);
}

type Mode = "single-user" | "family-shared" | "isolated-containers" | "invalid";
const denial = "Tool output access denied.";
const identity: ExecutionIdentity = { mode: "family-shared", username: "alice", displayName: "Alice", role: "admin", rootChatJid: "web:alice", provenance: { actorUserId: "alice", ownerUserId: "alice", chatJid: "web:alice", kind: "interactive", authenticationSessionId: "claimed-login" } };
async function fixture(run: (configure: (mode: Mode) => void, workspace: string, data: string) => Promise<void>) {
  await withTempWorkspaceEnv("output-boundary-", { PICLAW_TOOL_RESULT_COMPACTION_ENABLED: "1", PICLAW_TOOL_RESULT_COMPACTION_TOOLS: "bash", PICLAW_TOOL_RESULT_SEMANTIC_SUMMARY_ENABLED: "1", PICLAW_TOOL_OUTPUT_STORE_BYTES: "8", PICLAW_TOOL_OUTPUT_STORE_LINES: "2" }, async (ws) => {
    closeDatabase(); initDatabase();
    mkdirSync(join(ws.workspace, ".piclaw"), { recursive: true });
    const configure = (mode: Mode) => writeFileSync(join(ws.workspace, ".piclaw/config.json"), mode === "invalid" ? "{" : JSON.stringify({ domains: { access: {
      mode, ...(mode === "isolated-containers" ? { isolation: { component: "backend", backendId: "test", ownerUserId: "alice", gatewayUrl: "https://gateway.example", verificationKeyRef: "test-key" } } : {}),
    } } }));
    configure("single-user");
    // Context-mode captures presentation defaults on import. Load only after
    // the fixture config, matching the existing context-mode regression suite.
    contextMode = await import("../../extensions/integrations/context-mode.js");
    __setSemanticToolResultSummarizerForTests(null);
    try { await run(configure, ws.workspace, ws.data); } finally { __setSemanticToolResultSummarizerForTests(null); closeDatabase(); }
  });
}
function disk(root: string): unknown[] {
  if (!existsSync(root)) return [];
  return readdirSync(root, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name)).map((e) => [e.name, e.isDirectory() ? disk(join(root, e.name)) : readFileSync(join(root, e.name)).toString("base64")]);
}
function snapshot(data: string) {
  return JSON.stringify({ metadata: getDb().query("SELECT * FROM tool_outputs ORDER BY id").all(), fts: getDb().query("SELECT * FROM tool_outputs_fts ORDER BY rowid").all(), files: disk(join(data, "tool-output")) });
}
const large = "needle output line\n".repeat(4000);
function hooks() {
  const fake = createFakeExtensionApi(); contextMode.default(fake.api);
  return { result: fake.handlers.find((e) => e.event === "tool_result")!.handler, context: fake.handlers.find((e) => e.event === "context")!.handler };
}
const event = () => ({ toolName: "bash", content: [{ type: "text", text: large }], details: {}, input: { command: "test" }, isError: false });

test("high-level output APIs and direct tools deny before parameters, SQL, files or shell execution", async () => {
  await fixture(async (configure, workspace, data) => {
    const saved = output.saveToolOutput("private needle", { createdAt: "2000-01-01T00:00:00.000Z" });
    const before = snapshot(data), marker = join(workspace, "executed");
    const search = createToolOutputSearchTool(), bash = createContextBashTool(workspace), batch = createBatchExecTool(workspace, { execute: () => { throw Error("Unexpected injected execution"); } } as any);
    const forbidden = new Proxy({}, { get: () => { throw Error("Unexpected argument read"); } });
    for (const mode of ["family-shared", "isolated-containers", "invalid", "single-user"] as const) {
      configure(mode);
      for (const ctx of mode === "single-user" ? [identity] : [null, identity]) await withExecutionIdentity(ctx, async () => {
        for (const call of [() => output.saveToolOutput(large, forbidden), () => output.getToolOutput(saved.id), () => output.searchToolOutput(saved.id, "needle"), () => output.searchToolOutput(saved.id, ""), () => output.readToolOutputFile(saved.path), () => output.pruneToolOutputs(1), () => output.pruneToolOutputFiles(1), () => output.migrateFlatToolOutputsToDateShards()]) expect(call).toThrow(denial);
        output.startToolOutputCleanup(1, 9999);
        await expect(search.execute("id", forbidden as any)).rejects.toThrow();
        await expect(batch.execute("id", forbidden as any)).rejects.toThrow(denial);
        await expect(bash.execute("id", { command: `touch '${marker}'` })).rejects.toThrow(denial);
      });
    }
    expect(snapshot(data)).toBe(before); expect(existsSync(marker)).toBe(false);
    configure("single-user"); expect(output.searchToolOutput(saved.id, "needle")).toHaveLength(1);
    const check = createToolOutputAccessGuard(); configure("family-shared"); expect(check).toThrow(denial); configure("single-user"); expect(check).toThrow(denial);
  });
});

test("tool-result and context hooks skip unsupported modes before event reads or cached summary retrieval", async () => {
  await fixture(async (configure, _workspace, data) => {
    const h = hooks(); let summaries = 0;
    __setSemanticToolResultSummarizerForTests(async () => { summaries++; return "Summary: private cached semantic output"; });
    const first = await h.result(event(), {}); expect(first.content[0].text).toContain("private cached");
    const before = snapshot(data), forbidden = new Proxy({}, { get: () => { throw Error("Unexpected event read"); } });
    for (const mode of ["family-shared", "isolated-containers", "invalid", "single-user"] as const) {
      configure(mode);
      await withExecutionIdentity(mode === "single-user" ? identity : null, async () => {
        expect(await h.result(forbidden, {})).toBeUndefined(); expect(await h.context(forbidden, {})).toEqual({});
        expect(await h.result(event(), {})).toBeUndefined();
      });
    }
    expect(summaries).toBe(1); expect(snapshot(data)).toBe(before);
    configure("single-user"); expect(await h.result(event(), {})).toEqual(first); expect(summaries).toBe(1);
  });
});

test("semantic completion or rejection after mode change cannot save preview, cache entry or replacement result", async () => {
  await fixture(async (configure, _workspace, data) => {
    const h = hooks();
    for (const reject of [false, true]) {
      configure("single-user"); const before = snapshot(data);
      __setSemanticToolResultSummarizerForTests(async () => { configure("family-shared"); if (reject) throw Error("model failed"); return "Summary: must not store or expose this result"; });
      expect(await h.result(event(), {})).toBeUndefined(); expect(snapshot(data)).toBe(before);
      configure("single-user"); let calls = 0;
      __setSemanticToolResultSummarizerForTests(async () => { calls++; return "Summary: new single-user output"; });
      expect((await h.result(event(), {})).content[0].text).toContain("new single-user"); expect(calls).toBe(1);
    }
  });
});

test("legacy context projection discards asynchronous results after mode changes", async () => {
  await fixture(async (configure) => {
    const h = hooks(), input = { messages: [{ role: "toolResult", toolName: "bash", content: [{ type: "text", text: large }] }] };
    const pending = h.context(input, {}); configure("family-shared");
    expect(await pending).toEqual({}); expect(input.messages[0].content[0].text).toBe(large);
  });
});

test("batch denial after completion, rejection or callback stops later commands and partial results", async () => {
  await fixture(async (configure) => {
    for (const stage of ["complete", "reject", "update", "update-restored"]) {
      configure("single-user"); const calls: string[] = [], updates: unknown[] = [];
      const tool = createBatchExecTool(process.cwd(), { execute: async (_id: string, params: any, _signal: any, onUpdate: any) => {
        calls.push(params.command); configure("family-shared");
        if (stage.startsWith("update")) {
          try { onUpdate({ content: [{ type: "text", text: "private" }] }); } catch (error) { if (stage !== "update-restored") throw error; }
          if (stage === "update-restored") configure("single-user");
        }
        if (stage === "reject") throw Error("execution failed");
        return { content: [{ type: "text", text: "private result" }] };
      } } as any);
      await expect(tool.execute("id", { commands: ["first", "second"] }, undefined, (u) => updates.push(u))).rejects.toThrow(denial);
      expect(calls).toEqual(["first"]); expect(updates).toEqual([]);
    }
  });
});

test("context bash does not return or persist an already-started command after mode change", async () => {
  await fixture(async (configure, workspace, data) => {
    const started = join(workspace, "started"), release = join(workspace, "release"), updates: unknown[] = [];
    const tool = createContextBashTool(workspace), before = snapshot(data);
    const pending = tool.execute("id", { command: `touch '${started}'; while [ ! -e '${release}' ]; do sleep 0.02; done; echo private`, timeout: 5 }, undefined, (u) => updates.push(u));
    let beforeUpdates: unknown[] = [];
    try { await waitFor(() => existsSync(started)); beforeUpdates = [...updates]; configure("family-shared"); } finally { writeFileSync(release, "go"); }
    await expect(pending).rejects.toThrow(denial); expect(updates).toEqual(beforeUpdates); expect(snapshot(data)).toBe(before);
  });
});

test("nested access denial never becomes a batch error preview or semantic fallback after mode restoration", async () => {
  await fixture(async (configure, _workspace, data) => {
    const nestedDenial = () => {
      const check = createToolOutputAccessGuard(); configure("family-shared");
      try { check(); } finally { configure("single-user"); }
    };
    let calls = 0;
    const tool = createBatchExecTool(process.cwd(), { execute: async () => { calls++; nestedDenial(); } } as any);
    await expect(tool.execute("id", { commands: ["first", "second"] })).rejects.toBeInstanceOf(ToolOutputAccessDenied);
    expect(calls).toBe(1);
    const h = hooks(), before = snapshot(data);
    __setSemanticToolResultSummarizerForTests(async () => { nestedDenial(); return null; });
    expect(await h.result(event(), {})).toBeUndefined(); expect(snapshot(data)).toBe(before);
  });
});

test("callback denial remains latched when a caller throws and the dependency later restores configuration", async () => {
  await fixture(async (configure) => {
    let calls = 0;
    const tool = createBatchExecTool(process.cwd(), { execute: async (_id: string, _params: any, _signal: any, onUpdate: any) => {
      calls++;
      try { onUpdate({ content: [{ type: "text", text: "allowed update" }] }); } catch (error) { expect(String(error)).toContain("caller failed"); }
      configure("single-user");
      return { content: [{ type: "text", text: "must not return" }] };
    } } as any);
    await expect(tool.execute("id", { commands: ["first", "second"] }, undefined, () => { configure("family-shared"); throw Error("caller failed"); })).rejects.toThrow(denial);
    expect(calls).toBe(1);
  });
});

for (const scenario of ["stop-restart", "check-race"]) {
  test(`retention boundary isolated from process-wide startup state: ${scenario}`, async () => {
    const workspace = createTempWorkspace("output-retention-");
    const fixturePath = new URL("../fixtures/tool-output-retention.ts", import.meta.url).pathname;
    try {
      const child = Bun.spawn([process.execPath, "--no-env-file", "-e", `import { runScenario } from ${JSON.stringify(fixturePath)}; await runScenario(${JSON.stringify(scenario)});`], {
        env: { ...process.env, PICLAW_WORKSPACE: workspace.workspace, PICLAW_STORE: workspace.store, PICLAW_DATA: workspace.data, PICLAW_DB_IN_MEMORY: "1" },
        stdout: "pipe", stderr: "pipe",
      });
      const [code, stdout, stderr] = await Promise.all([child.exited, new Response(child.stdout).text(), new Response(child.stderr).text()]);
      expect(code, stderr || stdout).toBe(0); expect(stdout).toContain(`RETENTION_OK:${scenario}`);
    } finally { workspace.cleanup(); }
  }, 15000);
}
