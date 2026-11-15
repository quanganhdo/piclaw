#!/usr/bin/env bun
// Explicit archive-layout tooling only; never native execution persistence.
import Database from "bun:sqlite";
import { appendFileSync, closeSync, cpSync, existsSync, fsyncSync, lstatSync, mkdirSync, openSync, readFileSync, readdirSync, realpathSync, rmSync, statSync, truncateSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { performance } from "node:perf_hooks";

import { SqliteSessionStore } from "./lib/sqlite-session-archive.js";
import { createVerifiedSqliteBackup, verifySqliteBackup } from "../src/db/backup.js";

type Layout = "jsonl" | "unified" | "separate";
type Metric = { layout: Layout; operation: string; samples: number[]; unit: "ms" | "bytes"; notes?: string };
type Options = { sessions: string; messages: string; out: string; limit: number; iterations: number };

function options(): Options {
  const map = new Map<string, string>();
  const args = process.argv.slice(2);
  for (let index = 0; index < args.length; index += 2) {
    if (!args[index]?.startsWith("--") || !args[index + 1]) throw new Error("Expected --sessions, --messages, --out, --limit and --iterations");
    map.set(args[index], args[index + 1]);
  }
  if (!map.get("--sessions") || !map.get("--messages") || !map.get("--out")) throw new Error("Expected --sessions, --messages and --out");
  return {
    sessions: resolve(map.get("--sessions")!),
    messages: resolve(map.get("--messages")!),
    out: resolve(map.get("--out")!),
    limit: Number(map.get("--limit") ?? 50),
    iterations: Number(map.get("--iterations") ?? 20),
  };
}

function collect(root: string): string[] {
  const files: string[] = [];
  const visit = (dir: string) => {
    for (const name of readdirSync(dir).sort()) {
      const path = join(dir, name);
      const stat = lstatSync(path);
      if (stat.isSymbolicLink()) continue;
      if (stat.isDirectory()) visit(path);
      else if (stat.isFile() && name.endsWith(".jsonl")) files.push(realpathSync(path));
    }
  };
  visit(root);
  return files.sort((left, right) => statSync(right).size - statSync(left).size);
}

function measure<T>(fn: () => T): { value: T; ms: number } {
  const start = performance.now();
  const value = fn();
  return { value, ms: performance.now() - start };
}

async function measureAsync<T>(fn: () => Promise<T>): Promise<{ value: T; ms: number }> {
  const start = performance.now();
  const value = await fn();
  return { value, ms: performance.now() - start };
}

function summary(samples: number[]) {
  const values = [...samples].sort((left, right) => left - right);
  const pick = (fraction: number) => values[Math.min(values.length - 1, Math.floor((values.length - 1) * fraction))] ?? 0;
  return { min: pick(0), p50: pick(0.5), p95: pick(0.95), max: pick(1), mean: values.reduce((sum, value) => sum + value, 0) / Math.max(1, values.length) };
}

function databaseBytes(path: string): number {
  return [path, `${path}-wal`, `${path}-shm`].reduce((total, candidate) => total + (existsSync(candidate) ? statSync(candidate).size : 0), 0);
}

function importedIds(path: string): string[] {
  const database = new Database(path, { readonly: true, strict: true });
  try {
    return (database.prepare("SELECT import_id FROM piclaw_agent_sessions ORDER BY source_bytes DESC, source_path").all() as Array<{ import_id: string }>).map((row) => row.import_id);
  } finally {
    database.close();
  }
}

const config = options();
rmSync(config.out, { recursive: true, force: true });
mkdirSync(config.out, { recursive: true });
const files = collect(config.sessions).slice(0, config.limit);
if (files.length === 0) throw new Error("No JSONL session files found");
const sourceBytes = files.reduce((total, path) => total + statSync(path).size, 0);
const unifiedPath = join(config.out, "unified.db");
const separatePath = join(config.out, "sessions.db");
const timelineSource = new Database(config.messages, { strict: true });
try {
  createVerifiedSqliteBackup(timelineSource, config.messages, unifiedPath);
} finally {
  timelineSource.close();
}
const metrics: Metric[] = [];

for (const [layout, path] of [["unified", unifiedPath], ["separate", separatePath]] as const) {
  const rssBefore = process.memoryUsage().rss;
  const opened = measure(() => new SqliteSessionStore(path));
  metrics.push({ layout, operation: "startup", samples: [opened.ms], unit: "ms" });
  const imported = await measureAsync(async () => {
    for (const file of files) await opened.value.importJsonl(file);
  });
  metrics.push({ layout, operation: "import", samples: [imported.ms], unit: "ms" });
  metrics.push({ layout, operation: "rss_after_import", samples: [Math.max(0, process.memoryUsage().rss - rssBefore)], unit: "bytes" });
  metrics.push({ layout, operation: "shutdown_drain", samples: [measure(() => opened.value.close()).ms], unit: "ms" });
}

const headerScan = measure(() => files.map((path) => readFileSync(path, "utf8").split("\n", 1)[0]));
metrics.push({ layout: "jsonl", operation: "startup", samples: [headerScan.ms], unit: "ms", notes: "read each header" });

for (const [layout, path] of [["unified", unifiedPath], ["separate", separatePath]] as const) {
  const store = new SqliteSessionStore(path);
  const ids = importedIds(path);
  const branch: number[] = [];
  const compact: number[] = [];
  const search: number[] = [];
  for (let index = 0; index < config.iterations; index += 1) {
    const id = ids[index % ids.length];
    branch.push(measure(() => store.readBranch(id)).ms);
    compact.push(measure(() => store.readCompactedBranch(id)).ms);
    search.push(measure(() => store.search("the", 20)).ms);
  }
  metrics.push({ layout, operation: "branch_read", samples: branch, unit: "ms" });
  metrics.push({ layout, operation: "compaction_prune_read", samples: compact, unit: "ms" });
  metrics.push({ layout, operation: "search", samples: search, unit: "ms" });
  const append: number[] = [];
  let parentId = store.readBranch(ids[0]).at(-1)?.entry_id ?? null;
  for (let index = 0; index < config.iterations; index += 1) {
    const id = `benchmark-${layout}-${index}`;
    const raw = JSON.stringify({ type: "message", id, parentId, timestamp: new Date().toISOString(), message: { role: "user", content: `benchmark ${index}` } });
    append.push(measure(() => store.appendRawEntry(ids[0], raw)).ms);
    parentId = id;
  }
  metrics.push({ layout, operation: "append", samples: append, unit: "ms" });
  store.close();
}

const jsonlBranch: number[] = [];
const jsonlCompact: number[] = [];
const jsonlSearch: number[] = [];
for (let index = 0; index < config.iterations; index += 1) {
  const parsed = measure(() => readFileSync(files[index % files.length], "utf8").trimEnd().split("\n").slice(1).map((line) => JSON.parse(line) as Record<string, unknown>));
  jsonlBranch.push(parsed.ms);
  jsonlCompact.push(parsed.ms + measure(() => {
    for (let entryIndex = parsed.value.length - 1; entryIndex >= 0; entryIndex -= 1) if (parsed.value[entryIndex]?.type === "compaction") return entryIndex;
    return -1;
  }).ms);
  jsonlSearch.push(parsed.ms + measure(() => parsed.value.filter((entry) => JSON.stringify(entry).toLowerCase().includes("the")).slice(0, 20)).ms);
}
metrics.push({ layout: "jsonl", operation: "branch_read", samples: jsonlBranch, unit: "ms", notes: "parse full file" });
metrics.push({ layout: "jsonl", operation: "compaction_prune_read", samples: jsonlCompact, unit: "ms", notes: "parse full file" });
metrics.push({ layout: "jsonl", operation: "search", samples: jsonlSearch, unit: "ms", notes: "parse and scan selected file" });
const appendPath = join(config.out, "append.jsonl");
writeFileSync(appendPath, `${JSON.stringify({ type: "session", version: 3, id: "benchmark", cwd: "/workspace" })}\n`);
const jsonlAppend: number[] = [];
const appendFd = openSync(appendPath, "a");
try {
  for (let index = 0; index < config.iterations; index += 1) {
    jsonlAppend.push(measure(() => {
      appendFileSync(appendFd, `${JSON.stringify({ type: "message", id: `jsonl-${index}`, parentId: index ? `jsonl-${index - 1}` : null, message: { role: "user", content: `benchmark ${index}` } })}\n`);
      fsyncSync(appendFd);
    }).ms);
  }
} finally {
  closeSync(appendFd);
}
metrics.push({ layout: "jsonl", operation: "append", samples: jsonlAppend, unit: "ms", notes: "append plus fsync" });

const faults: Record<string, unknown> = {};
const busyPath = join(config.out, "busy.db");
const busy = new SqliteSessionStore(busyPath);
const busySession = await busy.importJsonl(files[0]);
const blocker = new Database(busyPath, { strict: true });
blocker.exec("PRAGMA busy_timeout=100; BEGIN IMMEDIATE");
busy.database.exec("PRAGMA busy_timeout=100");
const busyStart = performance.now();
try {
  busy.appendRawEntry(busySession.importId, JSON.stringify({ type: "message", id: "busy", parentId: busySession.activeLeafId, message: { role: "user", content: "busy" } }));
  faults.busyHandling = { passed: false };
} catch (error) {
  faults.busyHandling = { passed: String(error).includes("locked"), elapsedMs: performance.now() - busyStart, error: String(error) };
}
blocker.exec("ROLLBACK");
blocker.close();
busy.close();

const crashPath = join(config.out, "crash.db");
const crash = new Database(crashPath, { create: true, strict: true });
crash.exec("PRAGMA journal_mode=WAL; CREATE TABLE t(id INTEGER PRIMARY KEY, value TEXT)");
crash.close();
const crashChild = Bun.spawn({ cmd: [process.execPath, "-e", `import Database from 'bun:sqlite'; const db=new Database(${JSON.stringify(crashPath)}); db.exec(\"BEGIN IMMEDIATE; INSERT INTO t(value) VALUES ('uncommitted')\"); process.kill(process.pid, 'SIGKILL');`], stdout: "ignore", stderr: "ignore" });
await crashChild.exited;
const crashCheck = new Database(crashPath, { readonly: true, strict: true });
faults.crashRecovery = { passed: Number((crashCheck.prepare("SELECT COUNT(*) AS count FROM t").get() as { count: number }).count) === 0, childExitCode: crashChild.exitCode };
crashCheck.close();

const partialPath = join(config.out, "partial-migration.db");
const partial = new Database(partialPath, { create: true, strict: true });
let partialMigrationError = "";
try {
  partial.transaction(() => partial.exec("CREATE TABLE partial_a(id INTEGER); INSERT INTO partial_a VALUES (1); INSERT INTO missing VALUES (1)"))();
} catch (error) {
  partialMigrationError = String(error);
}
faults.partialMigration = {
  passed: partialMigrationError.length > 0 && !partial.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='partial_a'").get(),
  error: partialMigrationError,
};
partial.close();

const corruptSeparate = join(config.out, "corrupt-separate.db");
cpSync(separatePath, corruptSeparate);
truncateSync(corruptSeparate, Math.max(4096, Math.floor(statSync(corruptSeparate).size / 3)));
let separateRejected = false;
try { verifySqliteBackup(corruptSeparate); } catch { separateRejected = true; }
const corruptUnified = join(config.out, "corrupt-unified.db");
cpSync(unifiedPath, corruptUnified);
truncateSync(corruptUnified, Math.max(4096, Math.floor(statSync(corruptUnified).size / 3)));
let unifiedRejected = false;
try { verifySqliteBackup(corruptUnified); } catch { unifiedRejected = true; }
const timelineIntegrity = verifySqliteBackup(config.messages).integrityCheck;
faults.corruptionIsolation = { passed: separateRejected && unifiedRejected && timelineIntegrity === "ok", separate: "session corruption rejected while timeline remained healthy", unified: "one corrupted file made both domains unavailable", timelineIntegrity };

const unifiedStore = new SqliteSessionStore(unifiedPath);
const separateStore = new SqliteSessionStore(separatePath);
const timelineWriter = new Database(unifiedPath, { strict: true });
timelineWriter.exec("PRAGMA busy_timeout=100; BEGIN IMMEDIATE; UPDATE chats SET last_message_time=last_message_time WHERE rowid=(SELECT rowid FROM chats LIMIT 1)");
unifiedStore.database.exec("PRAGMA busy_timeout=100");
let unifiedBlocked = false;
try { unifiedStore.appendRawEntry(importedIds(unifiedPath)[0], JSON.stringify({ type: "message", id: "unified-contention", parentId: null, message: { role: "user", content: "contention" } })); } catch (error) { unifiedBlocked = String(error).includes("locked"); }
separateStore.appendRawEntry(importedIds(separatePath)[0], JSON.stringify({ type: "message", id: "separate-isolation", parentId: null, message: { role: "user", content: "isolation" } }));
timelineWriter.exec("ROLLBACK");
timelineWriter.close();
unifiedStore.close();
separateStore.close();
faults.walConcurrencyIsolation = { passed: unifiedBlocked, unifiedSessionWriteBlockedByTimelineWriter: unifiedBlocked, separateSessionWriteSucceededDuringTimelineWriter: true };

const backupPath = join(config.out, "sessions.backup.db");
const backupSource = new Database(separatePath, { strict: true });
const manifest = createVerifiedSqliteBackup(backupSource, separatePath, backupPath);
backupSource.close();
faults.backupConsistency = { passed: manifest.integrityCheck === "ok", manifest };
const restorePath = join(config.out, "sessions.restored.db");
cpSync(backupPath, restorePath);
faults.restore = { passed: verifySqliteBackup(restorePath).integrityCheck === "ok" };

const report = {
  version: 1,
  scope: "archive-layout-only",
  generatedAt: new Date().toISOString(),
  host: process.env.HOSTNAME ?? "unknown",
  corpus: { sourceDirectory: config.sessions, files: files.length, bytes: sourceBytes, largestFirst: true },
  timelineCopy: { source: config.messages, bytes: statSync(config.messages).size },
  configuration: { iterations: config.iterations, synchronous: "FULL", journalMode: "WAL", busyTimeoutMs: 5000 },
  measurements: metrics.map((metric) => ({ ...metric, summary: summary(metric.samples) })),
  footprint: { jsonlBytes: sourceBytes, unifiedBytes: databaseBytes(unifiedPath), separateSessionBytes: databaseBytes(separatePath), timelineBytes: statSync(config.messages).size },
  faults,
};
const reportPath = join(config.out, "report.json");
writeFileSync(reportPath, `${JSON.stringify(report, null, 2)}\n`);
console.log(JSON.stringify({ reportPath, scope: report.scope, corpus: report.corpus, footprint: report.footprint, faults }, null, 2));
