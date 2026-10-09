/** Disposable disk-WAL auth workload. No tokens, SQL binds or response bodies in output. */
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { monitorEventLoopDelay, performance } from "node:perf_hooks";
import { initDatabase, closeDatabase, getDb } from "../../src/db/connection.js";
import { createWebSession, getWebSession, deleteAllWebSessions } from "../../src/db/web-sessions.js";
import { getUser } from "../../src/db/users.js";
import { resolveRequestPrincipal } from "../../src/channels/web/auth/principal.js";
import { isRequestAuthenticated } from "../../src/channels/web/auth/session-auth.js";
import { assertPathWithinTestFilesystemIsolation } from "../../scripts/test-filesystem-isolation.js";

assertPathWithinTestFilesystemIsolation(process.env.PICLAW_WORKSPACE!, process.env, { allowRoot: false });
assert.equal(process.env.PICLAW_DB_IN_MEMORY, "0");
const instrument = process.argv.includes("--instrument"), iterations = 10000, sessions = 1000;
const modes = ["lookup", "principal", "auth-gateway", "missing"] as const;
const sentinel = "synthetic-profile-cookie-";
const hash = (text: string) => createHash("sha256").update(text).digest("hex");
const fetchOriginal = globalThis.fetch;
let network = 0;
const deny = () => { network++; throw Error("Network is forbidden"); };
globalThis.fetch = Object.assign(deny, { preconnect: deny }) as typeof fetch;
try {
  initDatabase(); const db = getDb(); deleteAllWebSessions();
  db.transaction(() => { for (let n = 0; n < sessions; n++) createWebSession(`${sentinel}${n}`, "default", 3600, "totp"); }).immediate();
  const tokens = Array.from({ length: sessions }, (_, n) => `${sentinel}${n}`);
  const missing = tokens.map(token => `${token}-absent`);
  const requests = tokens.map(token => new Request("https://fixture.invalid/agent/me", { headers: { cookie: `piclaw_session=${token}` } }));
  const settings = { journal: db.query("PRAGMA journal_mode").get(), synchronous: db.query("PRAGMA synchronous").get(), busyTimeout: db.query("PRAGMA busy_timeout").get() };
  assert.deepEqual(settings.journal, { journal_mode: "wal" }); assert.deepEqual(settings.synchronous, { synchronous: 2 });
  const schema = () => hash(JSON.stringify(db.query("SELECT type,name,tbl_name,sql FROM sqlite_schema WHERE name NOT LIKE 'sqlite_stat%' ORDER BY type,name").all()));
  const schemaBefore = schema();
  const plans = {
    lookup: db.query("EXPLAIN QUERY PLAN SELECT token, user_id, auth_method, created_at, expires_at, session_id FROM web_sessions WHERE token = ?").all("unused"),
    expiry: db.query("EXPLAIN QUERY PLAN DELETE FROM web_sessions WHERE expires_at <= ?").all("2000-01-01T00:00:00.000Z"),
    devices: db.query("EXPLAIN QUERY PLAN SELECT session_id, user_id, auth_method, created_at, expires_at FROM web_sessions WHERE user_id = ? ORDER BY created_at DESC").all("unused"),
  };
  const originalPrepare = db.prepare, originalQuery = db.query;
  const originalParse = JSON.parse, originalStringify = JSON.stringify;
  let metrics: Record<string, { calls: number; ms: number }> = {}, unique = new WeakSet<object>(), uniqueCount = 0;
  let parseCalls = 0, stringifyCalls = 0, inputCodeUnits = 0, outputCodeUnits = 0, serializationMs = 0;
  const row = (name: string) => metrics[name] ??= { calls: 0, ms: 0 };
  const proxies = new WeakMap<object, object>();
  const wrap = (stmt: any, sql: string) => {
    if (!unique.has(stmt)) { unique.add(stmt); uniqueCount++; }
    const previous = proxies.get(stmt); if (previous) return previous;
    const category = /^SELECT/.test(sql.trim()) ? (sql.includes("FROM users") ? "user-read" : "session-read") : /^DELETE/.test(sql.trim()) ? "expiry-delete" : "other";
    const proxy = new Proxy(stmt, { get(target, key) {
      if (!["get", "all", "run"].includes(String(key))) return Reflect.get(target, key, target);
      return (...args: unknown[]) => { const start = performance.now(); try { return Reflect.apply(target[key], target, args); } finally { const m = row(`step.${category}`); m.calls++; m.ms += performance.now() - start; } };
    } }); proxies.set(stmt, proxy); return proxy;
  };
  const rows = [];
  for (const mode of modes) {
    const run = (n: number) => {
      const index = n % sessions;
      if (mode === "lookup") return getWebSession(tokens[index])?.user_id === "default";
      if (mode === "missing") return getWebSession(missing[index]) === null;
      if (mode === "auth-gateway") return isRequestAuthenticated(requests[index], true);
      return resolveRequestPrincipal(requests[index], { mode: "single-user", authEnabled: true }, { getSession: getWebSession, getUser: id => getUser(db, id), getLocalDisplayName: () => "Fixture" })?.userId === "default";
    };
    for (let n = 0; n < 100; n++) assert(run(n));
    metrics = {}; unique = new WeakSet(); uniqueCount = 0; parseCalls = 0; stringifyCalls = 0; inputCodeUnits = 0; outputCodeUnits = 0; serializationMs = 0;
    if (instrument) {
      db.prepare = ((sql: string, ...args: unknown[]) => { const start = performance.now(); let statement; try { statement = Reflect.apply(originalPrepare, db, [sql, ...args]); } finally { const m = row("prepare"); m.calls++; m.ms += performance.now() - start; } return wrap(statement, sql); }) as typeof db.prepare;
      db.query = ((sql: string) => { const start = performance.now(); let statement; try { statement = originalQuery.call(db, sql); } finally { const m = row("query-cache"); m.calls++; m.ms += performance.now() - start; } return wrap(statement, sql); }) as typeof db.query;
      JSON.parse = (...args: Parameters<typeof JSON.parse>) => { const start = performance.now(); try { return originalParse(...args); } finally { parseCalls++; inputCodeUnits += args[0].length; serializationMs += performance.now() - start; } };
      JSON.stringify = ((...args: Parameters<typeof JSON.stringify>) => { const start = performance.now(); const result = originalStringify(...args); stringifyCalls++; outputCodeUnits += result?.length ?? 0; serializationMs += performance.now() - start; return result; }) as typeof JSON.stringify;
    }
    const loop = monitorEventLoopDelay({ resolution: 1 }); loop.enable(); await Bun.sleep(5);
    const cpu = process.cpuUsage(), memoryBefore = process.memoryUsage(); const batches: number[] = [];
    let accepted = 0;
    for (let n = 0; n < iterations; n += 100) {
      const start = performance.now();
      for (let j = n; j < n + 100; j++) if (run(j)) accepted++;
      batches.push(performance.now() - start); await Bun.sleep(1);
    }
    const cpuUsed = process.cpuUsage(cpu), memoryAfter = process.memoryUsage();
    db.prepare = originalPrepare; db.query = originalQuery; JSON.parse = originalParse; JSON.stringify = originalStringify;
    await Bun.sleep(5); loop.disable();
    assert.equal(accepted, iterations);
    rows.push({ mode, iterations, batches, workMs: batches.reduce((a,b) => a+b,0), cpu: cpuUsed, memoryBefore, memoryAfter, eventLoop: { resolutionMs: 1, samples: loop.count, maxMs: loop.max / 1e6, meanMs: loop.mean / 1e6 }, metrics: instrument ? metrics : null, uniqueStatementsObserved: instrument ? uniqueCount : null, parsing: instrument ? { parseCalls, stringifyCalls, inputCodeUnits, outputCodeUnits, serializationMs } : null });
  }
  assert.equal(schema(), schemaBefore);
  assert.deepEqual(db.query("PRAGMA quick_check").get(), { quick_check: "ok" });
  assert.deepEqual(db.query("SELECT COUNT(*) AS n FROM web_sessions").get(), { n: sessions });
  assert.equal(network, 0);
  console.log(JSON.stringify({ name: "web-session-profile", runtime: Bun.version, instrument, sessions, rows, settings, plans, schemaSha256: schemaBefore, network, scope: "Synthetic warm disk-WAL session lookup/principal/cookie-auth workloads; no real HTTP server, credentials or provider. Sleeps excluded from workMs; CPU includes workload plus yields; CPU samples also include startup." }));
} finally { globalThis.fetch = fetchOriginal; closeDatabase(); }
