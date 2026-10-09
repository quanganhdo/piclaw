import "../setup-filesystem-isolation.js";
import assert from "node:assert/strict";
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { Database } from "bun:sqlite";

// This host is disposable: before the fix, a close-callback exception kills it.
const mode = process.argv[2];
const profiling = process.argv.includes('--profile');
const started = performance.now();
const profilePhase = (phase: string) => { if (profiling) console.log(JSON.stringify({ phase, elapsedMs: performance.now() - started })); };
delete process.env.PICLAW_WEB_VNC_ALLOW_DIRECT;
delete process.env.PICLAW_TOOL_OUTPUT_STORE_BYTES;
delete process.env.PICLAW_TOOL_OUTPUT_STORE_LINES;
mkdirSync(join(process.env.PICLAW_WORKSPACE!, ".piclaw"), { recursive: true });
writeFileSync(join(process.env.PICLAW_WORKSPACE!, ".piclaw/config.json"), JSON.stringify({ domains: { access: { mode: "single-user" }, tools: { toolOutputStoreBytes: 1024, toolOutputStoreLines: 20 } } }));
const { WORKSPACE_DIR, STORE_DIR, getDataDir } = await import("../../src/core/config.js");
const { initDatabase, getDb, closeDatabase } = await import("../../src/db.js");
const { runBunScript } = await import("../../src/tools/bun-runner.js");
const { listTrackedProcesses, killTrackedProcesses } = await import("../../src/utils/process-tracker.js");
// The parent requests graceful termination before its hard watchdog, so detached
// script groups are killed even if an assertion or runner regression hangs us.
process.once("SIGTERM", () => { killTrackedProcesses(); process.exitCode = 143; });
const { searchToolOutput } = await import("../../src/tool-output.js");
profilePhase('imports-complete');
assert.equal(process.env.PICLAW_DB_IN_MEMORY, "0");
initDatabase();
profilePhase('database-ready');
if (mode === '--setup') { closeDatabase(); console.log('BUN_SETUP_READY'); process.exit(0); }
const db = getDb();
db.exec("PRAGMA journal_mode=WAL; PRAGMA busy_timeout=40");
const blocker = new Database(join(STORE_DIR, "messages.db"));
const marker = join(WORKSPACE_DIR, "executed.txt");
const script = join(WORKSPACE_DIR, "script.ts");
const large = ["stdout-busy", "stderr-busy", "stdout-healthy", "stderr-healthy", "ownership-denied"].includes(mode!);
const stderr = mode?.startsWith("stderr-");
writeFileSync(script, [
  'import { appendFileSync, writeFileSync } from "node:fs";',
  `writeFileSync(${JSON.stringify(join(WORKSPACE_DIR, "script.pid"))}, String(process.pid));`,
  'setTimeout(() => process.exit(99), 6000).unref();',
  `appendFileSync(${JSON.stringify(marker)}, "ran\\n");`,
  mode === "ownership-denied" ? `writeFileSync(${JSON.stringify(join(WORKSPACE_DIR, ".piclaw/config.json"))}, JSON.stringify({domains:{access:{mode:"family-shared"}}}));` : "",
  `${stderr ? "console.error" : "console.log"}(${large ? '"needle " + "x".repeat(60000)' : '"small"'});`,
  mode === "exit-seven" ? "process.exitCode = 7;" : "",
  ["timeout", "abort"].includes(mode!) ? "await Bun.sleep(30000);" : "",
].join("\n"));
mkdirSync(join(WORKSPACE_DIR, ".piclaw"), { recursive: true });
const busy = mode?.endsWith("-busy");
if (busy) blocker.exec("BEGIN IMMEDIATE");
const controller = new AbortController();
let abortPoll: ReturnType<typeof setInterval> | undefined;
if (mode === "abort") abortPoll = setInterval(() => { if (existsSync(marker)) controller.abort(); }, 5);
let settled = 0;
try {
  try {
    const result = await runBunScript({ script: "script.ts", captureStdout: true, timeoutSec: mode === "timeout" ? 1 : 5 }, controller.signal);
    profilePhase('runner-complete');
    settled++;
    assert.ok(!["stdout-busy", "stderr-busy", "ownership-denied", "timeout", "abort"].includes(mode!));
    assert.equal(result.exitCode, mode === "exit-seven" ? 7 : 0);
    const captured = stderr ? result.stderr : result.stdout;
    if (large) {
      assert.ok(captured.storedOutputId); assert.ok(captured.storedOutputPath);
      assert.ok(readFileSync(captured.storedOutputPath, "utf8").startsWith("needle "));
      assert.equal(searchToolOutput(captured.storedOutputId, "needle").length, 1);
    } else assert.equal(result.stdout.text, "small\n");
  } catch (error) {
    settled++;
    assert.ok(error instanceof Error);
    if (["stdout-busy", "stderr-busy", "ownership-denied"].includes(mode!)) {
      assert.match(error.message, /script exited \(code 0\).*could not be finalized/);
      assert.match(error.message, /may already have made changes; inspect before retrying/);
      assert.ok(error.cause instanceof Error);
      if (busy) assert.equal((error.cause as Error & { code?: string }).code, "SQLITE_BUSY");
      else assert.equal(error.cause.message, "Tool output access denied.");
      assert.equal(error.message.includes("needle"), false);
    } else assert.equal(error.message, mode === "timeout" ? "timeout:1" : mode === "abort" ? "aborted" : "UNEXPECTED_FAILURE");
  }
  await Bun.sleep(30);
  assert.equal(settled, 1);
  assert.equal(readFileSync(marker, "utf8"), "ran\n");
  assert.deepEqual(listTrackedProcesses(), []);
  if (busy || mode === "ownership-denied") {
    assert.deepEqual(db.query("SELECT count(*) n FROM tool_outputs").get(), { n: 0 });
    assert.deepEqual(db.query("SELECT count(*) n FROM tool_outputs_fts").get(), { n: 0 });
    const files = (path: string): string[] => existsSync(path) ? readdirSync(path, { withFileTypes: true }).flatMap(entry => entry.isDirectory() ? files(join(path, entry.name)) : [entry.name]) : [];
    assert.deepEqual(files(join(getDataDir(), "tool-output")), []);
  }
  console.log("BUN_SETTLEMENT=" + JSON.stringify({ mode, settled, tracked: 0, executions: 1 }));
} finally {
  clearInterval(abortPoll);
  killTrackedProcesses();
  if (busy) blocker.exec("ROLLBACK");
  blocker.close(); closeDatabase();
}
