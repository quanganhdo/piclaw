import { Database } from "bun:sqlite";
import { expect, test } from "bun:test";
import "../helpers.js";
import { registerProcessAdmissionGuard } from "../../src/runtime/process-admission.js";
import { createCurrentPiclawScheduledRunStore } from "../../src/service-effects/current-piclaw/scheduled-run-store.js";
import { installScheduledRunCompositionSchema } from "../../src/service-effects/current-piclaw/scheduled-run-schema.js";
import { createScheduledTaskAuthority } from "../../src/service-effects/current-piclaw/scheduled-task-authority.js";

import { hashCanonicalRequest, type CanonicalJsonValue } from "../../src/service-effects/contracts/common.js";
import type { AcceptSourceRequest } from "../../src/service-effects/contracts/service-work-store.js";
import { createCurrentPiclawServiceWorkStore } from "../../src/service-effects/current-piclaw/service-work-store.js";
import { terminalOperation, TERMINAL_HARNESS } from "../../src/service-effects/testing/contract-suites/terminal-settlement-store-contract.js";
import { openSqliteSubject } from "./terminal-settlement-test-support.js";

test("EF-S07 checks admission inside the claim transaction after serial await, before replay", async () => {
  const db = new Database(":memory:");
  db.exec("PRAGMA foreign_keys=ON");
  installScheduledRunCompositionSchema(db);
  const built = createCurrentPiclawScheduledRunStore(db, { hitFault() { return false; }, recordTrace() {} });
  if (!built.ok) throw new Error("fixture construction failed");
  const store = built.value;
  createScheduledTaskAuthority(db).create({
    taskId: "task:admission", chatJid: "web:admission", kind: "shell", payloadRef: "payload:admission",
    modelLabel: null, scheduleType: "interval", scheduleValue: "60000", timezone: "UTC",
    notifyOnComplete: true, muted: false, cwd: null, timeoutSec: null, internalTask: null,
    redactionClass: "private", executionRepeatability: "repeatable",
    nextRunAt: "2026-08-16T01:00:00.000Z", authoredAt: "2026-08-16T00:00:00.000Z",
  });
  let sealed = false;
  const dispose = registerProcessAdmissionGuard(() => {
    expect(db.inTransaction).toBe(true);
    if (sealed) throw new Error("sealed");
  });
  const request = { now: "2026-08-16T01:00:00.000Z", limit: 10, workerId: "worker:test", leaseTokenPrefix: "prefix:test", leaseDurationMs: 60000, reclaimAuthorities: [] as const };
  const count = (table: string) => (db.query(`SELECT COUNT(*) AS n FROM ${table}`).get() as { n: number }).n;
  try {
    const pending = store.claimDue(request);
    sealed = true; // claim is suspended on its serial await
    const denied = await pending;
    expect(denied.ok).toBe(false);
    if (!denied.ok) expect(denied.error.certainty).toBe("not_applied");
    expect(count("service_effect_s07_occurrences")).toBe(0);
    expect(count("service_effect_s07_decisions")).toBe(0);
    sealed = false;
    const claimed = await store.claimDue(request);
    expect(claimed.ok && claimed.value.length).toBe(1);
    if (!claimed.ok) throw new Error("claim failed");
    const lease = claimed.value[0]!;
    sealed = true;
    expect((await store.claimDue(request)).ok).toBe(false); // replay is fenced too
    const fence = { runId: lease.record.runId, workerId: request.workerId, expectedAttempt: 1, expectedTaskRevision: 1, leaseToken: lease.leaseToken, now: request.now };
    expect((await store.renew({ ...fence, leaseExpiresAt: "2026-08-16T01:02:00.000Z" })).ok).toBe(true);
    expect(count("service_effect_s07_occurrences")).toBe(1);
  } finally { dispose(); db.close(); }
});

test("EF-S01 fences ordinary source SQL admission but permits exact finish, cancellation and reconciliation", async () => {
  const subject = openSqliteSubject(":memory:", [], false);
  const db = subject.database;
  const harness = { ...TERMINAL_HARNESS };
  subject.seedOperation(terminalOperation({ phase: "executing", harness }));
  const made = createCurrentPiclawServiceWorkStore(db, { hitFault() { return false; }, recordTrace() {} });
  if (!made.ok) throw Error("fixture construction failed");
  const work = made.value;
  const effect = (id: string) => ({ idempotencyKey: id, requestHash: "", operationId: null,
    sourceSeq: null, provenanceRef: "host", redactionClass: "private" as const });
  const sealSource = (request: AcceptSourceRequest): AcceptSourceRequest => ({ ...request,
    effect: { ...request.effect, requestHash: hashCanonicalRequest(request as unknown as CanonicalJsonValue) } });
  const ordinary = sealSource({ effect: effect("ordinary"), chatJid: "web:new-admission", sourceId: "ordinary",
    kind: "message", payloadRef: "payload:ordinary", targetOperationId: null, parentSourceSeq: null,
    acceptedAt: "2026-08-14T09:00:00.000Z", createWakeIntent: true });
  const snapshot = () => ["chats", "sources", "operations", "decisions", "wake_intents"]
    .map(table => db.query(`SELECT * FROM service_effect_s01_${table}`).all());
  let calls = 0;
  const dispose = registerProcessAdmissionGuard(() => {
    calls++;
    expect(db.inTransaction).toBe(true);
    throw Error("sealed");
  });
  try {
    const before = snapshot();
    const denied = await work.acceptSource(ordinary);
    expect(denied.ok).toBe(false);
    if (!denied.ok) expect(denied.error.certainty).toBe("not_applied");
    expect(snapshot()).toEqual(before);
    expect(() => db.transaction(() => work.acceptSourceInTransaction(ordinary, db)).immediate()).toThrow();
    expect(snapshot()).toEqual(before);
    expect(calls).toBe(2);

    const original = await work.getOperation("operation-1");
    if (!original.ok || !original.value) throw Error("missing operation");
    const operation = original.value;
    const cancellation = sealSource({ ...ordinary, effect: effect("cancel"), chatJid: operation.chatJid,
      sourceId: "cancel", kind: "cancellation", targetOperationId: operation.operationId,
      parentSourceSeq: operation.primarySourceSeq, createWakeIntent: false });
    const cancelled = db.transaction(() => work.acceptAndCancelSourceInTransaction(cancellation,
      operation.version, "user", db)).immediate();
    expect(cancelled.phase).toBe("cancelling");
    expect(work.getSourceBySeq(operation.chatJid, cancelled.cancellation!.sourceSeq)?.state).toBe("claimed");
    const finish = { effect: { ...effect("finish"), operationId: operation.operationId, sourceSeq: operation.primarySourceSeq },
      expectedVersion: cancelled.version, expectedHarness: harness };
    const request = { ...finish, effect: { ...finish.effect,
      requestHash: hashCanonicalRequest({ method: "finishHarness.v1", ...finish } as unknown as CanonicalJsonValue) } };
    const finished = await work.finishHarness(request);
    expect(finished.ok).toBe(true);
    if (!finished.ok) throw Error("finish failed");
    expect(finished.value.phase).toBe("settling");
    expect(finished.value.harness).toEqual(harness);
    expect(Object.keys(finished.value.harness!).sort()).toEqual(['harnessOperationId','sessionId']);
    const committed = snapshot();
    expect(await work.finishHarness(request)).toEqual(finished);
    expect(await work.getOperation(operation.operationId)).toEqual(finished);
    const open = await work.listOpenOperations({ chatJid: operation.chatJid });
    expect(open.ok && open.value).toEqual([finished.value]);
    expect(snapshot()).toEqual(committed);
    expect(calls).toBe(2); // Existing work/control paths never consult NEW admission.
  } finally { dispose(); subject.dispose?.(); }
});
