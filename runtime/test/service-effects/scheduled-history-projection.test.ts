import { Database } from "bun:sqlite";
import { expect, test } from "bun:test";
import { hashCanonicalRequest, type CanonicalJsonValue } from "../../src/service-effects/contracts/common.js";
import type { CompleteScheduledRunRequest, ScheduledRunLease, ScheduledRunResultPayload } from "../../src/service-effects/contracts/scheduled-run-store.js";
import { installScheduledRunCompositionSchema } from "../../src/service-effects/current-piclaw/scheduled-run-schema.js";
import { createScheduledTaskAuthority } from "../../src/service-effects/current-piclaw/scheduled-task-authority.js";
import { createCurrentPiclawScheduledRunStore } from "../../src/service-effects/current-piclaw/scheduled-run-store.js";
import { normaliseComplete } from "../../src/service-effects/current-piclaw/scheduled-run-values.js";
import { normaliseComplete as fakeComplete } from "../../src/service-effects/testing/fakes/fake-scheduled-run-values.js";
import { initializeScheduledHistorySchema } from "../../src/db/scheduled-history-schema.js";
import { projectScheduledHistory, scheduledResultRef } from "../../src/service-effects/current-piclaw/scheduled-history-projection.js";

function legacyDatabase() {
  const db = new Database(":memory:");
  db.exec(`CREATE TABLE scheduled_tasks(id TEXT PRIMARY KEY);
    CREATE TABLE task_run_logs(id INTEGER PRIMARY KEY AUTOINCREMENT,task_id TEXT NOT NULL,run_at TEXT NOT NULL,duration_ms INTEGER NOT NULL,status TEXT NOT NULL,result TEXT,error TEXT,FOREIGN KEY(task_id) REFERENCES scheduled_tasks(id));
    CREATE INDEX idx_task_run_logs ON task_run_logs(task_id,run_at);`);
  return db;
}
function value<T>(result: { ok: true; value: T } | { ok: false; error: { _tag: string } }): T {
  if (!result.ok) throw Error(result.error._tag);
  return result.value;
}
async function fixture(status: "success" | "error" = "success") {
  const db = legacyDatabase();
  installScheduledRunCompositionSchema(db);
  initializeScheduledHistorySchema(db);
  db.exec("INSERT INTO scheduled_tasks VALUES('task:history')");
  const authority = createScheduledTaskAuthority(db);
  authority.create({ taskId: "task:history", chatJid: "web:history", kind: "shell", payloadRef: "payload:history", modelLabel: null,
    scheduleType: "once", scheduleValue: "2026-08-16T01:00:00.000Z", timezone: "UTC", notifyOnComplete: true, muted: false,
    cwd: null, timeoutSec: null, internalTask: null, redactionClass: "private", executionRepeatability: "reconciliation_required",
    nextRunAt: "2026-08-16T01:00:00.000Z", authoredAt: "2026-08-16T00:00:00.000Z" });
  let fault: "lost" | "statement" | null = null;
  const store = value(createCurrentPiclawScheduledRunStore(db, {
    hitFault(point, method) { if (method === "complete" && point === "effect_then_lost_acknowledgement" && fault === "lost") { fault = null; return true; } return false; },
    afterStatement(statement) { if (statement === "history_projection" && fault === "statement") { fault = null; throw Error("fixture projection fault"); } },
    recordTrace() {},
  }));
  const lease = value(await store.claimDue({ now: "2026-08-16T01:00:00.000Z", limit: 1, workerId: "worker:history", leaseTokenPrefix: "lease:history", leaseDurationMs: 60000, reclaimAuthorities: [] }))[0]!;
  const request = completion(lease, status);
  return { db, store, authority, lease, request, fail(kind: typeof fault) { fault = kind; }, close() { db.close(); } };
}
function completion(lease: ScheduledRunLease, status: "success" | "error"): CompleteScheduledRunRequest {
  const resultPayload: ScheduledRunResultPayload = { version: 1, result: status === "success" ? " exact result bytes \n" : null, error: status === "error" ? "retained failure text" : null };
  const request: CompleteScheduledRunRequest = {
    effect: { idempotencyKey: "complete:history", requestHash: "", operationId: null, sourceSeq: null, provenanceRef: "history:fixture", redactionClass: "private" },
    runId: lease.record.runId, workerId: lease.record.workerId, expectedAttempt: lease.record.attempt, expectedTaskRevision: lease.record.taskRevision,
    leaseToken: lease.leaseToken, now: "2026-08-16T01:00:10.000Z", status, durationMs: 10, resultPayload,
    resultRef: status === "success" ? scheduledResultRef(lease.record.runId) : null,
    errorCode: status === "error" ? "scheduled_task_failed" : null, completedAt: "2026-08-16T01:00:10.000Z", outboxIntents: [],
  };
  request.effect.requestHash = hashCanonicalRequest(request as unknown as CanonicalJsonValue);
  return request;
}

test("owned history migration preserves unmatched legacy bytes and its original receipt", () => {
  const db = legacyDatabase();
  try {
    db.exec("INSERT INTO scheduled_tasks VALUES('legacy'); INSERT INTO task_run_logs(task_id,run_at,duration_ms,status,result,error) VALUES('legacy','2020-01-01',1,'success',' legacy bytes ',NULL)");
    const before = db.query("SELECT * FROM task_run_logs").get() as Record<string, unknown>;
    initializeScheduledHistorySchema(db);
    const receipt = db.query("SELECT * FROM piclaw_schema_migrations").all();
    expect(db.query("SELECT id,task_id,run_at,duration_ms,status,result,error FROM task_run_logs").get()).toEqual(before);
    expect(db.query("SELECT occurrence_id,payload_version,payload_hash FROM task_run_logs").get()).toEqual({ occurrence_id: null, payload_version: null, payload_hash: null });
    initializeScheduledHistorySchema(db);
    expect(db.query("SELECT * FROM piclaw_schema_migrations").all()).toEqual(receipt);
    expect(() => db.exec("UPDATE task_run_logs SET occurrence_id='forged'")).toThrow();
    db.exec("DROP INDEX idx_task_run_logs_occurrence");
    expect(() => initializeScheduledHistorySchema(db)).toThrow("Unsupported scheduled history index");
    expect(db.query("SELECT * FROM piclaw_schema_migrations").all()).toEqual(receipt);
  } finally { db.close(); }
});

for (const status of ["success", "error"] as const) test(`canonical ${status}, projection and head commit atomically; lost ACK replay is idempotent`, async () => {
  const f = await fixture(status);
  try {
    f.fail("statement");
    expect((await f.store.complete(f.request)).ok).toBe(false);
    expect(f.db.query("SELECT * FROM task_run_logs").all()).toEqual([]);
    expect(f.db.query("SELECT * FROM service_effect_s07_run_logs").all()).toEqual([]);
    expect(value(await f.store.get(f.lease.record.runId))?.state).toBe("claimed");
    f.fail("lost");
    const lost = await f.store.complete(f.request);
    expect(!lost.ok && lost.error.certainty).toBe("unknown");
    const committed = value(await f.store.get(f.lease.record.runId))!;
    expect(committed.state).toBe("completed");
    const log = f.db.query("SELECT * FROM task_run_logs").get();
    expect(log).toEqual(expect.objectContaining({ occurrence_id: f.lease.record.runId, payload_version: 1, status, result: f.request.resultPayload!.result, error: f.request.resultPayload!.error }));
    expect(value(await f.store.complete(f.request))).toEqual(committed);
    expect(f.db.query("SELECT * FROM task_run_logs").all()).toEqual([log]);
    expect(value(await f.store.claimDue({ now: "2026-08-16T02:00:00.000Z", limit: 1, workerId: "worker:next", leaseTokenPrefix: "lease:next", leaseDurationMs: 60000, reclaimAuthorities: [] }))).toEqual([]);
  } finally { f.close(); }
});

test("metadata rebuild and exact-request repair keep the logical result reference; missing bytes are explicit", async () => {
  const f = await fixture();
  try {
    const committed = value(await f.store.complete(f.request));
    f.db.exec("UPDATE task_run_logs SET run_at='wrong',duration_ms=999,status='error'");
    expect(projectScheduledHistory(f.db, f.lease.record.runId).state).toBe("projected");
    expect(f.db.query("SELECT run_at,duration_ms,status,result FROM task_run_logs").get()).toEqual({ run_at: f.request.completedAt, duration_ms: 10, status: "success", result: f.request.resultPayload!.result });
    f.db.exec("DELETE FROM task_run_logs");
    expect(projectScheduledHistory(f.db, f.lease.record.runId)).toEqual({ state: "unavailable" });
    expect(value(await f.store.complete(f.request))).toEqual(committed);
    expect(f.db.query("SELECT result,occurrence_id FROM task_run_logs").get()).toEqual({ result: f.request.resultPayload!.result, occurrence_id: f.lease.record.runId });
    const changed = { ...f.request, effect: { ...f.request.effect, requestHash: "" }, resultPayload: { version: 1 as const, result: "changed", error: null } };
    changed.effect.requestHash = hashCanonicalRequest(changed as unknown as CanonicalJsonValue);
    expect(() => projectScheduledHistory(f.db, f.lease.record.runId, changed)).toThrow("idempotency_conflict");
    const conflict = await f.store.complete(changed);
    expect(!conflict.ok && conflict.error._tag).toBe("idempotency_conflict");
    f.db.exec("UPDATE task_run_logs SET result='corrupt bytes'");
    expect(() => projectScheduledHistory(f.db, f.lease.record.runId)).toThrow("corrupt_state");
  } finally { f.close(); }
});

test("owner deletion suppresses completion/replay resurrection and linked history protects cleanup authority", async () => {
  const f = await fixture();
  try {
    value(await f.store.complete(f.request));
    const protectedCleanup = value(await f.store.cleanupTerminal({ settledBefore: "2026-08-17T00:00:00.000Z", limit: 10 }));
    expect(protectedCleanup.removed).toBe(0);
    f.authority.delete(f.lease.record.taskId);
    f.db.exec("DELETE FROM task_run_logs; DELETE FROM scheduled_tasks");
    expect(value(await f.store.complete(f.request)).state).toBe("completed");
    expect(f.db.query("SELECT * FROM task_run_logs").all()).toEqual([]);
    expect(projectScheduledHistory(f.db, f.lease.record.runId)).toEqual({ state: "retired" });
  } finally { f.close(); }
});

test("unowned partial additions, index collisions and mixed-case temp shadows preserve the original schema", () => {
  for (const ddl of [
    "CREATE INDEX idx_task_run_logs_occurrence ON task_run_logs(result)",
    "ALTER TABLE task_run_logs ADD COLUMN occurrence_id TEXT",
    "CREATE TEMP TABLE TASK_RUN_LOGS(value TEXT)",
  ]) {
    const db = legacyDatabase();
    try {
      db.exec(ddl);
      const before = db.query("SELECT type,name,tbl_name,sql FROM main.sqlite_schema ORDER BY type,name").all();
      expect(() => initializeScheduledHistorySchema(db)).toThrow();
      expect(db.query("SELECT type,name,tbl_name,sql FROM main.sqlite_schema ORDER BY type,name").all()).toEqual(before);
    } finally { db.close(); }
  }
});

test("a definition deleted before completion commits authority without recreating its history", async () => {
  const f = await fixture();
  try {
    f.authority.delete(f.lease.record.taskId);
    f.db.exec("DELETE FROM scheduled_tasks");
    const completed = value(await f.store.complete(f.request));
    expect(completed.headDisposition).toBe("deleted");
    expect(f.db.query("SELECT * FROM task_run_logs").all()).toEqual([]);
    expect(value(await f.store.complete(f.request))).toEqual(completed);
    expect(f.db.query("SELECT * FROM task_run_logs").all()).toEqual([]);
  } finally { f.close(); }
});

test("an explicitly referenced legacy payload protects canonical history without invented linkage", async () => {
  const f = await fixture();
  try {
    const inserted = f.db.query("INSERT INTO task_run_logs(task_id,run_at,duration_ms,status,result,error) VALUES(?,'legacy-time',1,'success','legacy output',NULL)").run(f.lease.record.taskId);
    const { resultPayload: _unused, ...base } = f.request;
    const request = { ...base, effect: { ...base.effect, requestHash: "" }, resultRef: `task_run_log:${inserted.lastInsertRowid}` };
    request.effect.requestHash = hashCanonicalRequest(request as unknown as CanonicalJsonValue);
    value(await f.store.complete(request));
    expect(value(await f.store.cleanupTerminal({ settledBefore: "2026-08-17T00:00:00.000Z", limit: 10 })).removed).toBe(0);
    expect(f.db.query("SELECT occurrence_id,payload_version,payload_hash,result FROM task_run_logs").get())
      .toEqual({ occurrence_id: null, payload_version: null, payload_hash: null, result: "legacy output" });
  } finally { f.close(); }
});

test("versioned payload is closed, hash-bound, frozen and independently parsed by the fake", async () => {
  const f = await fixture();
  try {
    const { resultPayload: _unused, ...base } = f.request;
    const legacy = { ...base, effect: { ...base.effect, requestHash: "" }, resultRef: "result:legacy-opaque" };
    legacy.effect.requestHash = hashCanonicalRequest(legacy as unknown as CanonicalJsonValue);
    for (const parse of [normaliseComplete, fakeComplete]) {
      expect(parse(legacy)).not.toBeNull();
      const opaque = { ...legacy, effect: { ...legacy.effect, requestHash: "" }, resultRef: scheduledResultRef(f.lease.record.runId) };
      opaque.effect.requestHash = hashCanonicalRequest(opaque as unknown as CanonicalJsonValue);
      expect(parse(opaque)).not.toBeNull();
      const parsed = parse(f.request)!;
      expect(parsed.resultPayload).toEqual(f.request.resultPayload);
      expect(Object.isFrozen(parsed.resultPayload)).toBe(true);
      expect(parse({ ...f.request, resultPayload: { ...f.request.resultPayload, version: 2 } })).toBeNull();
      expect(parse({ ...f.request, resultPayload: { ...f.request.resultPayload, extra: true } })).toBeNull();
      expect(parse({ ...f.request, resultPayload: { ...f.request.resultPayload, result: "unhashed change" } })).toBeNull();
      expect(parse({ ...f.request, resultPayload: undefined })).toBeNull();
    }
  } finally { f.close(); }
});
