/** Isolated database startup measurement; no query text or bind values in output. */
import assert from "node:assert/strict";
import { performance, monitorEventLoopDelay } from "node:perf_hooks";
import { createHash } from "node:crypto";
import { Database } from "bun:sqlite";
import { initDatabase, closeDatabase, getDb } from "../../src/db/connection.js";
import { assertPathWithinTestFilesystemIsolation } from "../../scripts/test-filesystem-isolation.js";
assertPathWithinTestFilesystemIsolation(process.env.PICLAW_WORKSPACE!, process.env, { allowRoot: false });
assert(process.env.PICLAW_DB_IN_MEMORY === "0");
const instrument = process.argv.includes("--instrument");
const classify = (sql: string) => /^VACUUM/i.test(sql.trim()) ? "VACUUM" : /^PRAGMA/i.test(sql.trim()) ? "PRAGMA" : /^(?:CREATE|ALTER|DROP)/i.test(sql.trim()) ? "DDL" : /^(?:INSERT|UPDATE|DELETE)/i.test(sql.trim()) ? "DML" : "other";
let metrics: Record<string, { count: number; ms: number }> = {};
type DatabaseMethod = (...args: any[]) => any;
const originals = new Map<string, DatabaseMethod>();
if (instrument) for (const key of ["exec", "run", "prepare", "query"] as const) {
  const original = Database.prototype[key] as DatabaseMethod; originals.set(key, original);
  (Database.prototype as any)[key] = function (sql: string, ...args: unknown[]) {
    const start = performance.now();
    try { return Reflect.apply(original, this, [sql, ...args]); }
    finally { const name = `${key}.${classify(sql)}`, row = metrics[name] ??= { count: 0, ms: 0 }; row.count++; row.ms += performance.now() - start; }
  };
}
try {
  const rows = [];
  for (const phase of ["fresh", "reuse", "reopen"]) {
    if (phase === "reopen") closeDatabase();
    const loop = monitorEventLoopDelay({ resolution: 1 }); loop.enable();
    await new Promise(resolve => setTimeout(resolve, 5));
    metrics = {}; const cpu = process.cpuUsage(); const start = performance.now(); initDatabase(); const ms = performance.now() - start;
    const cpuUsed = process.cpuUsage(cpu), capturedMetrics = structuredClone(metrics);
    await new Promise(resolve => setTimeout(resolve, 5)); loop.disable();
    const db = getDb();
    const settings = { journal: db.query("PRAGMA journal_mode").get(), synchronous: db.query("PRAGMA synchronous").get(), autoVacuum: db.query("PRAGMA auto_vacuum").get(), foreignKeys: db.query("PRAGMA foreign_keys").get() };
    assert.equal((db.query("PRAGMA quick_check").get() as any).quick_check, "ok");
    const schema = JSON.stringify(db.query("SELECT type,name,tbl_name,sql FROM sqlite_schema WHERE name NOT LIKE 'sqlite_stat%' ORDER BY type,name").all());
    rows.push({ phase, ms, cpu: cpuUsed, eventLoop: { samples: loop.count, maxMs: loop.max / 1e6 }, metrics: capturedMetrics, settings, schemaSha256: createHash("sha256").update(schema).digest("hex"), schemaObjects: (db.query("SELECT COUNT(*) AS n FROM sqlite_schema").get() as any).n });
  }
  console.log(JSON.stringify({ name: "db-startup", runtime: Bun.version, instrument, rows, limits: ["synthetic fresh schema and empty store", "method timings can include nested calls and I/O", "not a live DB migration or crash test"] }));
} finally { for (const [key, original] of originals) (Database.prototype as any)[key] = original; closeDatabase(); }
