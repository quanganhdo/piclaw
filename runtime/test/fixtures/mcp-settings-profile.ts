/** Synthetic disk-SQLite/settings workload; use through the isolated launcher. */
import assert from "node:assert/strict";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { monitorEventLoopDelay, performance } from "node:perf_hooks";
import { Database } from "bun:sqlite";
import { assertPathWithinTestFilesystemIsolation } from "../../scripts/test-filesystem-isolation.js";
import { closeDatabase, getDb, initDatabase } from "../../src/db.js";
import { createWebSession, getWebSession } from "../../src/db/web-sessions.js";
import { getUser } from "../../src/db/users.js";
import { resolveRequestPrincipal } from "../../src/channels/web/auth/principal.js";
import { readAccessConfig } from "../../src/core/config-access.js";
import { hydrateMcpKeychainCredentials, resetMcpStartupStateForTests } from "../../src/secure/mcp-keychain.js";
import { handleMcpSettings } from "../../src/channels/web/handlers/mcp-settings.js";
import { McpCodemodeController, resetMcpCodemodeRuntimeForTests } from "../../src/agent-pool/mcp-codemode-runtime.js";

const workspace = process.env.PICLAW_WORKSPACE!;
assertPathWithinTestFilesystemIsolation(workspace, process.env, { allowRoot: false });
const instrument = process.argv.includes("--instrument");
const metrics: Record<string, { count: number; ms: number }> = {};
const undo: Array<() => void> = [];
const statements = new WeakSet<object>();
function wrap(object: any, key: string, metric: string) {
  const original = object[key];
  object[key] = function (...args: unknown[]) {
    const start = performance.now();
    try {
      const result = Reflect.apply(original, this, args);
      if (object === Database.prototype && (key === "prepare" || key === "query") && !statements.has(result)) {
        statements.add(result);
        for (const method of ["get", "all", "run"]) wrap(result, method, `sqlite.statement.${method}`);
      }
      return result;
    }
    finally { const row = metrics[metric] ??= { count: 0, ms: 0 }; row.count++; row.ms += performance.now() - start; }
  };
  undo.push(() => { object[key] = original; });
}
let networkAttempts = 0;
const originalFetch = globalThis.fetch;
const deny = () => { networkAttempts++; throw Error("Network forbidden"); };
globalThis.fetch = Object.assign(deny, { preconnect: deny }) as typeof fetch;
try {
  mkdirSync(join(workspace, ".piclaw"), { recursive: true }); mkdirSync(join(workspace, ".pi"), { recursive: true });
  writeFileSync(join(workspace, ".piclaw/config.json"), JSON.stringify({ domains: { access: { mode: "single-user" } }, fixture: { padding: "x".repeat(20_000) } }), { mode: 0o600 });
  writeFileSync(join(workspace, ".pi/mcp.json"), JSON.stringify({ mcpServers: Object.fromEntries(Array.from({ length: 100 }, (_, n) => [`fixture-${n}`, { command: "never-run", args: ["synthetic"], directTools: true }])) }));
  initDatabase(); const db = getDb();
  const sqlite = { journalMode: db.query("PRAGMA journal_mode").get(), synchronous: db.query("PRAGMA synchronous").get() };
  const token = "synthetic-profile-session"; createWebSession(token, "default", 3600);
  await hydrateMcpKeychainCredentials(workspace, () => { throw Error("Keychain forbidden"); });
  resetMcpCodemodeRuntimeForTests();
  const controller = new McpCodemodeController({ blockMcpAdmissions() {throw Error("Preview must not fence");}, async fenceMcpAndSnapshot() {throw Error("Preview must not snapshot");}, resumeMcpAdmissions() {throw Error("Preview must not resume");}, async quarantineMcpRuntime() {throw Error("Preview must not quarantine");} });
  const channel = { agentPool: { inspectMcpSettings: (policy?: unknown) => controller.inspect(policy) }, authGateway: { getPrincipal: (req: Request) => resolveRequestPrincipal(req, { mode: readAccessConfig().mode, authEnabled: true }, { getSession: getWebSession, getUser: id => getUser(db, id), getLocalDisplayName: () => "Fixture" }) } } as any;
  if (instrument) {
    wrap(JSON, "parse", "json.parse"); wrap(JSON, "stringify", "json.stringify");
    for (const key of ["prepare", "query", "exec"]) wrap(Database.prototype, key, `sqlite.${key}`);
  }
  const loop = monitorEventLoopDelay({ resolution: 1 }); loop.enable();
  const batches: number[] = [];
  const started = performance.now();
  for (let b = 0; b < 10; b++) {
    const begin = performance.now();
    for (let n = 0; n < 100; n++) {
      const req = new Request("https://fixture.invalid/agent/settings/mcp/preview", { method: "POST", headers: { Cookie: `piclaw_session=${token}` }, body: '{"engine":"adapter","codemode":"auto"}' });
      const response = await handleMcpSettings(channel, req, new URL(req.url));
      assert.equal(response.status, 200); const body = await response.json(); assert.equal(body.servers.length, 100); assert.equal(body.applyAvailable, true);
    }
    batches.push(performance.now() - begin);
    await new Promise(resolve => setTimeout(resolve, 5));
  }
  const elapsed = performance.now() - started; loop.disable();
  const loopData = { samples: loop.count, maxMs: loop.max / 1e6, p50Ms: loop.percentile(50) / 1e6, p95Ms: loop.percentile(95) / 1e6, p99Ms: loop.percentile(99) / 1e6 };
  for (const restore of undo.reverse()) restore(); undo.length = 0;
  assert.equal(networkAttempts, 0);
  console.log(JSON.stringify({ name: "mcp-settings-preview", instrument, requests: 1000, servers: 100, configPaddingBytes: 20000, elapsedMs: elapsed, batchesMs: batches, metrics, sqlite, eventLoop: loopData, memory: process.memoryUsage(), networkAttempts, limitations: ["synthetic serialized request batches", "no server or provider execution", "DB wrappers aggregate method time without SQL or bind values", "CPU profile must be collected on this process", "no claim of lock contention or transaction throughput"] }));
} finally { for (const restore of undo.reverse()) restore(); closeDatabase(); resetMcpStartupStateForTests(); resetMcpCodemodeRuntimeForTests(); globalThis.fetch = originalFetch; }
