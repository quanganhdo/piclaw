import { Database } from "bun:sqlite";
import { describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Result as ResultValue } from "@earendil-works/pi-agent-core";
import type {
  CanonicalJsonValue,
  EffectIdentity,
  NormalisedTraceInput,
} from "../../src/service-effects/contracts/common.js";
import { hashCanonicalRequest } from "../../src/service-effects/contracts/common.js";
import type {
  ClaimOutboxRequest,
  CleanupTerminalOutboxRequest,
  CompleteOutboxRequest,
  EnqueueOutboxRequest,
  OutboxKind,
  OutboxStoreError,
  ReclaimOutboxRequest,
} from "../../src/service-effects/contracts/service-outbox-store.js";
import type { ContractTestContext } from "../../src/service-effects/testing/contract-suite.js";
import {
  ManualEffectClock,
  SequenceEffectIdSource,
} from "../../src/service-effects/testing/deterministic-controls.js";
import { FakeServiceOutboxStore } from "../../src/service-effects/testing/fakes/fake-service-outbox-store.js";
import { DeterministicFaultPlan } from "../../src/service-effects/testing/fault-plan.js";
import { installServiceOutboxSchema } from "../../src/service-effects/current-piclaw/service-outbox-schema.js";
import {
  createCurrentPiclawServiceOutboxStore,
  createServiceOutboxEnqueueInserter,
  type ServiceOutboxAdapterRuntime,
} from "../../src/service-effects/current-piclaw/service-outbox-store.js";

class Runtime implements ServiceOutboxAdapterRuntime {
  readonly traces: NormalisedTraceInput[] = [];
  beforeValue: unknown = false;
  acknowledgementValue: unknown = false;
  throwBefore = false;
  throwAcknowledgement = false;
  hitFault(point: "before_effect" | "effect_then_lost_acknowledgement") {
    if (point === "before_effect") {
      if (this.throwBefore) throw new Error("planned before-effect failure");
      return this.beforeValue;
    }
    if (this.throwAcknowledgement) {
      throw new Error("planned acknowledgement failure");
    }
    return this.acknowledgementValue;
  }
  recordTrace(input: NormalisedTraceInput) {
    this.traces.push(input);
  }
}
function effect(key: string): EffectIdentity {
  return {
    idempotencyKey: key,
    requestHash: "",
    operationId: "opaque:operation",
    sourceSeq: 1,
    provenanceRef: "opaque:secret-provenance",
    redactionClass: "secret",
  };
}
function enqueue(
  id: string,
  extra: Partial<EnqueueOutboxRequest> = {},
): EnqueueOutboxRequest {
  const base = {
    effect: effect(`key:${id}`),
    outboxId: id,
    kind: "maintenance" as const,
    payloadRef: "opaque:secret-payload",
    destinationRef: "opaque:secret-destination",
    availableAt: "2026-08-13T10:00:00.000Z",
    enqueuedAt: "2026-08-13T09:00:00.000Z",
    repeatability: "repeatable" as const,
    ...extra,
  };
  return {
    ...base,
    effect: {
      ...base.effect,
      requestHash: hashCanonicalRequest(base as unknown as CanonicalJsonValue),
    },
  };
}
function claim(token: string): ClaimOutboxRequest {
  return {
    kinds: ["maintenance"],
    workerId: `worker:${token}`,
    leaseToken: `opaque:secret-${token}`,
    now: "2026-08-13T10:00:01.000Z",
    leaseExpiresAt: "2026-08-13T10:01:00.000Z",
  };
}
function open(path = ":memory:") {
  const database = new Database(path, { strict: true });
  database.exec("PRAGMA foreign_keys=ON;PRAGMA journal_mode=WAL");
  installServiceOutboxSchema(database);
  const runtime = new Runtime(),
    made = createCurrentPiclawServiceOutboxStore(database, runtime);
  if (!made.ok) throw new Error("store");
  return { database, runtime, store: made.value };
}
function fakeContext(): ContractTestContext {
  return {
    clock: new ManualEffectClock("2026-08-13T09:00:00.000Z"),
    ids: new SequenceEffectIdSource("s05-hardening"),
    faults: new DeterministicFaultPlan(),
  };
}
function typed(
  result: { ok: true } | { ok: false; error: OutboxStoreError },
  tag: OutboxStoreError["_tag"],
) {
  expect(result.ok).toBeFalse();
  if (!result.ok) {
    expect(result.error._tag).toBe(tag);
    expect(JSON.stringify(result.error)).not.toContain("SQLITE");
  }
}
describe("EF-S05 transaction composition and construction", () => {
  test("bounded construction and caller-owned insert rollback commit replay", async () => {
    const db = new Database(":memory:", { strict: true }),
      runtime = new Runtime();
    expect(createCurrentPiclawServiceOutboxStore(db, runtime).ok).toBeFalse();
    installServiceOutboxSchema(db);
    const made = createServiceOutboxEnqueueInserter(db);
    expect(made.ok).toBeTrue();
    if (!made.ok) return;
    typed(made.value.insert(enqueue("outside")), "invalid_transition");
    db.exec("BEGIN IMMEDIATE");
    expect(made.value.insert(enqueue("rollback")).ok).toBeTrue();
    db.exec("ROLLBACK");
    expect(
      (
        db.query("SELECT count(*) n FROM service_effect_s05_outbox").get() as {
          n: number;
        }
      ).n,
    ).toBe(0);
    db.exec("BEGIN IMMEDIATE");
    const committed = made.value.insert(enqueue("commit"));
    expect(committed.ok).toBeTrue();
    db.exec("COMMIT");
    db.exec("BEGIN IMMEDIATE");
    const replay = made.value.insert(enqueue("commit"));
    expect(replay.ok && replay.value.decision).toBe("replayed");
    db.exec("COMMIT");

    db.exec("BEGIN IMMEDIATE");
    typed(
      made.value.insert(enqueue("other", { outboxId: "commit" })),
      "idempotency_conflict",
    );
    typed(
      made.value.insert({
        ...enqueue("malformed"),
        payloadRef: "x".repeat(2049),
      }),
      "invalid_request",
    );
    db.exec("ROLLBACK");
    db.close();
  });

  test("caller-owned inserter observes both DML statements and observer faults rollback", () => {
    const database = new Database(":memory:", { strict: true });
    installServiceOutboxSchema(database);
    const statements: string[] = [];
    const observed = createServiceOutboxEnqueueInserter(database, {
      afterStatement(statement) {
        statements.push(statement);
      },
    });
    expect(observed.ok).toBeTrue();
    if (!observed.ok) return;
    database.exec("BEGIN IMMEDIATE");
    expect(observed.value.insert(enqueue("observed")).ok).toBeTrue();
    database.exec("COMMIT");
    expect(statements).toEqual(["outbox_insert", "outbox_decision_insert"]);

    for (const fault of ["outbox_insert", "outbox_decision_insert"] as const) {
      const faulted = createServiceOutboxEnqueueInserter(database, {
        afterStatement(statement) {
          if (statement === fault) throw new Error("checkpoint");
        },
      });
      expect(faulted.ok).toBeTrue();
      if (!faulted.ok) continue;
      database.exec("BEGIN IMMEDIATE");
      typed(faulted.value.insert(enqueue(`fault-${fault}`)), "storage_unavailable");
      database.exec("ROLLBACK");
      expect(
        (
          database
            .prepare(
              "SELECT count(*) n FROM service_effect_s05_outbox WHERE outbox_id=?",
            )
            .get(`fault-${fault}`) as { n: number }
        ).n,
      ).toBe(0);
    }
    database.close();
  });

  test("held-lock inserter is bounded and committed lost response replays fresh", () => {
    const dir = mkdtempSync(join(tmpdir(), "piclaw-s05-inserter-"));
    const path = join(dir, "store.sqlite");
    const owner = open(path);
    const contender = new Database(path, { strict: true });
    contender.exec("PRAGMA foreign_keys=ON;PRAGMA busy_timeout=0");
    try {
      const made = createServiceOutboxEnqueueInserter(contender);
      expect(made.ok).toBeTrue();
      if (!made.ok) return;
      owner.database.exec("BEGIN IMMEDIATE");
      contender.exec("BEGIN");
      typed(made.value.insert(enqueue("busy-inserter")), "storage_unavailable");
      contender.exec("ROLLBACK");
      owner.database.exec("ROLLBACK");

      contender.exec("BEGIN IMMEDIATE");
      expect(made.value.insert(enqueue("lost-response")).ok).toBeTrue();
      contender.exec("COMMIT");
      contender.close();
      const fresh = new Database(path, { strict: true });
      fresh.exec("PRAGMA foreign_keys=ON");
      const restored = createServiceOutboxEnqueueInserter(fresh);
      expect(restored.ok).toBeTrue();
      if (restored.ok) {
        fresh.exec("BEGIN IMMEDIATE");
        const replay = restored.value.insert(enqueue("lost-response"));
        expect(replay.ok && replay.value.decision).toBe("replayed");
        fresh.exec("COMMIT");
      }
      fresh.close();
    } finally {
      if (owner.database.inTransaction) owner.database.exec("ROLLBACK");
      owner.database.close();
      if (contender.open) contender.close();
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
describe("EF-S05 typed missing-row semantics", () => {
  test("exact-row mutations return not_found while get returns null", async () => {
    for (const fixture of [
      open(),
      { database: null, store: new FakeServiceOutboxStore(fakeContext()) },
    ]) {
      try {
        const base = {
          outboxId: "missing",
          workerId: "worker",
          expectedAttempt: 1,
          leaseToken: "lease",
        };
        for (const result of [
          await fixture.store.complete({
            ...base,
            receiptRef: null,
            completedAt: "2026-08-13T10:00:30.000Z",
          }),
          await fixture.store.fail({
            ...base,
            errorTag: "missing",
            certainty: "not_applied",
            retryAt: null,
            failedAt: "2026-08-13T10:00:30.000Z",
          }),
          await fixture.store.markUnknown({
            ...base,
            errorTag: "missing",
            certainty: "unknown",
            observedAt: "2026-08-13T10:00:30.000Z",
          }),
          await fixture.store.reclaim({
            ...base,
            now: "2026-08-13T10:02:00.000Z",
            leaseExpiresAt: "2026-08-13T10:03:00.000Z",
            authority: { kind: "repeatable" },
          }),
          await fixture.store.resolveUnknown({
            outboxId: "missing",
            expectedAttempt: 1,
            reconciliationRef: "absent",
            reconciledAt: "2026-08-13T10:02:00.000Z",
            resolution: { kind: "cancelled", reasonTag: "absent" },
          }),
        ]) {
          typed(result, "not_found");
        }
        const read = await fixture.store.get("missing");
        expect(read.ok && read.value).toBeNull();
      } finally {
        fixture.database?.close();
      }
    }
  });
});

describe("EF-S05 retained error-tag reachability", () => {
  test("every retained tag has one definitive public or composition path", async () => {
    const fixture = open();
    const tags = new Set<string>();
    const capture = (
      result: { ok: true } | { ok: false; error: OutboxStoreError },
    ) => {
      expect(result.ok).toBeFalse();
      if (!result.ok) tags.add(result.error._tag);
    };
    try {
      capture(
        await fixture.store.enqueue({
          unexpected: true,
        } as EnqueueOutboxRequest),
      );
      const first = enqueue("error-idempotency");
      await fixture.store.enqueue(first);
      const conflict = enqueue("error-idempotency-other", {
        effect: {
          ...effect("error-idempotency-other"),
          idempotencyKey: first.effect.idempotencyKey,
        },
      });
      capture(await fixture.store.enqueue(conflict));
      capture(
        await fixture.store.complete({
          outboxId: "error-missing",
          workerId: "worker:missing",
          expectedAttempt: 1,
          leaseToken: "lease:missing",
          receiptRef: null,
          completedAt: "2026-08-13T10:00:30.000Z",
        }),
      );
      const inserter = createServiceOutboxEnqueueInserter(fixture.database);
      expect(inserter.ok).toBeTrue();
      if (inserter.ok)
        capture(inserter.value.insert(enqueue("error-inserter")));

      fixture.runtime.beforeValue = true;
      capture(await fixture.store.enqueue(enqueue("error-storage")));
      fixture.runtime.beforeValue = false;

      fixture.database.exec("PRAGMA ignore_check_constraints=ON");
      fixture.database
        .query(
          "UPDATE service_effect_s05_outbox SET state='other' WHERE outbox_id='error-idempotency'",
        )
        .run();
      capture(await fixture.store.get("error-idempotency"));
      expect([...tags].sort()).toEqual([
        "corrupt_state",
        "idempotency_conflict",
        "invalid_request",
        "invalid_transition",
        "not_found",
        "storage_unavailable",
      ]);
    } finally {
      fixture.database.close();
    }
  });
});

describe("EF-S05 exact before-effect fault semantics", () => {
  test("false proceeds while true, rollback, throw, nonboolean and thenable are not_applied", async () => {
    const observations: Array<{ value?: unknown; throws?: boolean }> = [
      { value: true },
      { value: "in_transaction" },
      { value: "truthy" },
      { value: 1 },
      { value: Promise.resolve(false) },
      { throws: true },
    ];
    for (const [index, observation] of observations.entries()) {
      const sqlite = open();
      try {
        sqlite.runtime.beforeValue = observation.value;
        sqlite.runtime.throwBefore = observation.throws === true;
        const id = `sqlite-before-${index}`;
        const result = await sqlite.store.enqueue(enqueue(id));
        expect(result.ok).toBeFalse();
        if (!result.ok) expect(result.error.certainty).toBe("not_applied");
        const row = await sqlite.store.get(id);
        expect(row.ok && row.value).toBeNull();
      } finally {
        sqlite.database.close();
      }
    }
    const sqliteFalse = open();
    try {
      expect(
        (await sqliteFalse.store.enqueue(enqueue("sqlite-before-false"))).ok,
      ).toBeTrue();
    } finally {
      sqliteFalse.database.close();
    }

    for (const [index, observation] of observations.entries()) {
      const fake = new FakeServiceOutboxStore(fakeContext());
      if (observation.throws) fake.planFaultThrow("enqueue", "before_effect");
      else fake.planFaultValue("enqueue", "before_effect", observation.value);
      const id = `fake-before-${index}`;
      const result = await fake.enqueue(enqueue(id));
      expect(result.ok).toBeFalse();
      if (!result.ok) expect(result.error.certainty).toBe("not_applied");
      expect((await fake.get(id)).value).toBeNull();
    }
    const fakeFalse = new FakeServiceOutboxStore(fakeContext());
    fakeFalse.planFaultValue("enqueue", "before_effect", false);
    expect(
      (await fakeFalse.enqueue(enqueue("fake-before-false"))).ok,
    ).toBeTrue();
  });
});

describe("EF-S05 exact acknowledgement fault semantics", () => {
  test("only boolean true after commit reports unknown for SQLite and fake", async () => {
    for (const value of [false, "truthy", 1, null, Promise.resolve(true)]) {
      const sqlite = open();
      try {
        sqlite.runtime.acknowledgementValue = value;
        const result = await sqlite.store.enqueue(
          enqueue(`sqlite-${String(value)}`),
        );
        expect(result.ok).toBeTrue();
      } finally {
        sqlite.database.close();
      }
    }
    const throwing = open();
    try {
      throwing.runtime.throwAcknowledgement = true;
      expect(
        (await throwing.store.enqueue(enqueue("sqlite-throw"))).ok,
      ).toBeTrue();
    } finally {
      throwing.database.close();
    }
    const lost = open();
    try {
      lost.runtime.acknowledgementValue = true;
      const result = await lost.store.enqueue(enqueue("sqlite-true"));
      expect(result.ok).toBeFalse();
      if (!result.ok) expect(result.error.certainty).toBe("unknown");
      expect((await lost.store.get("sqlite-true")).ok).toBeTrue();
    } finally {
      lost.database.close();
    }

    for (const value of [false, "truthy", 1, null, Promise.resolve(true)]) {
      const fake = new FakeServiceOutboxStore(fakeContext());
      fake.planFaultValue("enqueue", "effect_then_lost_acknowledgement", value);
      expect(
        (await fake.enqueue(enqueue(`fake-${String(value)}`))).ok,
      ).toBeTrue();
    }
    const fakeThrow = new FakeServiceOutboxStore(fakeContext());
    fakeThrow.planFaultThrow("enqueue", "effect_then_lost_acknowledgement");
    expect((await fakeThrow.enqueue(enqueue("fake-throw"))).ok).toBeTrue();
    const fakeLost = new FakeServiceOutboxStore(fakeContext());
    fakeLost.planFaultValue(
      "enqueue",
      "effect_then_lost_acknowledgement",
      true,
    );
    const fakeResult = await fakeLost.enqueue(enqueue("fake-true"));
    expect(fakeResult.ok).toBeFalse();
    if (!fakeResult.ok) expect(fakeResult.error.certainty).toBe("unknown");
    expect((await fakeLost.get("fake-true")).ok).toBeTrue();
  });
});

describe("EF-S05 closed request snapshots", () => {
  test("SQLite and fake consume normalized nested requests, arrays and cursors", async () => {
    for (const fixture of [
      open(),
      { database: null, store: new FakeServiceOutboxStore(fakeContext()) },
    ]) {
      try {
        const enqueueRequest = enqueue(
          `snapshot-${fixture.database ? "sqlite" : "fake"}`,
        );
        const originalEnqueue = structuredClone(enqueueRequest);
        const enqueuePromise = fixture.store.enqueue(enqueueRequest);
        (enqueueRequest as { payloadRef: string }).payloadRef = "mutated";
        (enqueueRequest.effect as { provenanceRef: string }).provenanceRef =
          "mutated";
        (enqueueRequest.effect as { operationId: string }).operationId =
          "mutated";
        (enqueueRequest.effect as { sourceSeq: number }).sourceSeq = 999;
        const inserted = await enqueuePromise;
        expect(inserted.ok && inserted.value.record.payloadRef).toBe(
          "opaque:secret-payload",
        );
        expect(inserted.ok && inserted.value.record.provenanceRef).toBe(
          "opaque:secret-provenance",
        );
        expect(inserted.ok && inserted.value.record.operationId).toBe(
          "opaque:operation",
        );
        expect(inserted.ok && inserted.value.record.sourceSeq).toBe(1);
        const enqueueReplay = await fixture.store.enqueue(originalEnqueue);
        expect(enqueueReplay.ok && enqueueReplay.value.decision).toBe(
          "replayed",
        );
        if (!inserted.ok) continue;

        const claimRequest = claim(
          `snapshot-${fixture.database ? "sqlite" : "fake"}`,
        );
        const originalClaim = structuredClone(claimRequest);
        const claimPromise = fixture.store.claimNext(claimRequest);
        (claimRequest.kinds as OutboxKind[])[0] = "notification";
        (claimRequest as { workerId: string }).workerId = "mutated";
        (claimRequest as { leaseToken: string }).leaseToken = "mutated";
        (claimRequest as { now: string }).now = "2026-08-13T15:00:00.000Z";
        (claimRequest as { leaseExpiresAt: string }).leaseExpiresAt =
          "2026-08-13T16:00:00.000Z";
        const claimed = await claimPromise;
        expect(claimed.ok && claimed.value.lease?.workerId).toStartWith(
          "worker:snapshot-",
        );
        expect(claimed.ok && claimed.value.lease?.record.leaseToken).toBe(
          originalClaim.leaseToken,
        );
        expect(claimed.ok && claimed.value.lease?.record.claimedAt).toBe(
          originalClaim.now,
        );
        const claimReplay = await fixture.store.claimNext(originalClaim);
        expect(claimReplay.ok && claimReplay.value.decision).toBe("replayed");
        if (!claimed.ok || !claimed.value.lease) continue;

        const unknown = {
          outboxId: claimed.value.lease.record.outboxId,
          workerId: claimed.value.lease.workerId,
          expectedAttempt: 1,
          leaseToken: claimed.value.lease.record.leaseToken,
          errorTag: "ambiguous",
          certainty: "unknown" as const,
          observedAt: "2026-08-13T10:00:30.000Z",
        };
        await fixture.store.markUnknown(unknown);
        const listRequest = {
          kinds: ["maintenance"] as OutboxKind[],
          after: {
            stateChangedAt: "2026-08-13T09:00:00.000Z",
            outboxId: "before",
          },
          limit: 1,
        };
        const listPromise = fixture.store.listUnknown(listRequest);
        listRequest.kinds[0] = "notification";
        listRequest.after.stateChangedAt = "2026-08-13T15:00:00.000Z";
        listRequest.after.outboxId = "mutated";
        listRequest.limit = 100;
        const listed = await listPromise;
        expect(listed.ok && listed.value.records).toHaveLength(1);

        const resolutionRequest = {
          outboxId: unknown.outboxId,
          expectedAttempt: 1,
          reconciliationRef: "original",
          reconciledAt: "2026-08-13T10:02:00.000Z",
          resolution: { kind: "cancelled" as const, reasonTag: "operator" },
        };
        const originalResolution = structuredClone(resolutionRequest);
        const resolutionPromise =
          fixture.store.resolveUnknown(resolutionRequest);
        (resolutionRequest as { reconciliationRef: string }).reconciliationRef =
          "mutated";
        (resolutionRequest as { reconciledAt: string }).reconciledAt =
          "2026-08-13T15:00:00.000Z";
        (resolutionRequest.resolution as { reasonTag: string }).reasonTag =
          "mutated";
        const resolved = await resolutionPromise;
        expect(
          resolved.ok && resolved.value.record?.cancellationReasonTag,
        ).toBe("operator");
        expect(resolved.ok && resolved.value.record?.reconciliationRef).toBe(
          "original",
        );
        expect(resolved.ok && resolved.value.record?.reconciledAt).toBe(
          "2026-08-13T10:02:00.000Z",
        );
        const resolutionReplay =
          await fixture.store.resolveUnknown(originalResolution);
        expect(resolutionReplay.ok && resolutionReplay.value.decision).toBe(
          "replayed",
        );
      } finally {
        fixture.database?.close();
      }
    }
  });
  test("SQLite and fake snapshot every mutation authority before returning", async () => {
    for (const fixture of [
      open(),
      { database: null, store: new FakeServiceOutboxStore(fakeContext()) },
    ]) {
      const flavour = fixture.database ? "sqlite" : "fake";
      const seed = async (id: string) => {
        await fixture.store.enqueue(enqueue(id));
        const claimed = await fixture.store.claimNext(claim(id));
        if (!claimed.ok || !claimed.value.lease) throw new Error("claim");
        return claimed.value.lease;
      };
      try {
        const reclaimLease = await seed(`snapshot-reclaim-${flavour}`);
        const reclaimRequest: ReclaimOutboxRequest = {
          outboxId: reclaimLease.record.outboxId,
          expectedAttempt: 1,
          workerId: `worker:reclaim:${flavour}`,
          leaseToken: `lease:reclaim:${flavour}`,
          now: "2026-08-13T10:02:00.000Z",
          leaseExpiresAt: "2026-08-13T10:03:00.000Z",
          authority: { kind: "repeatable" },
        };
        const originalReclaim = structuredClone(reclaimRequest);
        const reclaimPromise = fixture.store.reclaim(reclaimRequest);
        Object.assign(reclaimRequest, {
          outboxId: "mutated",
          expectedAttempt: 9,
          workerId: "mutated",
          leaseToken: "mutated",
          now: "2026-08-13T15:00:00.000Z",
          leaseExpiresAt: "2026-08-13T16:00:00.000Z",
          authority: {
            kind: "reconciled_absent",
            reconciliationRef: "mutated",
          },
        });
        const reclaimed = await reclaimPromise;
        expect(reclaimed.ok && reclaimed.value.record?.workerId).toBe(
          originalReclaim.workerId,
        );
        expect(reclaimed.ok && reclaimed.value.record?.leaseToken).toBe(
          originalReclaim.leaseToken,
        );
        const reclaimReplay = await fixture.store.reclaim(originalReclaim);
        expect(reclaimReplay.ok && reclaimReplay.value.decision).toBe(
          "replayed",
        );

        const completeLease = await seed(`snapshot-complete-${flavour}`);
        const completeRequest = {
          outboxId: completeLease.record.outboxId,
          workerId: completeLease.workerId,
          expectedAttempt: 1,
          leaseToken: completeLease.record.leaseToken,
          receiptRef: `receipt:${flavour}`,
          completedAt: "2026-08-13T10:00:30.000Z",
        };
        const originalComplete = structuredClone(completeRequest);
        const completePromise = fixture.store.complete(completeRequest);
        Object.assign(completeRequest, {
          workerId: "mutated",
          leaseToken: "mutated",
          receiptRef: "mutated",
          completedAt: "2026-08-13T15:00:00.000Z",
        });
        const completed = await completePromise;
        expect(completed.ok && completed.value.record?.receiptRef).toBe(
          originalComplete.receiptRef,
        );
        expect(completed.ok && completed.value.record?.resultAt).toBe(
          originalComplete.completedAt,
        );
        const completeReplay = await fixture.store.complete(originalComplete);
        expect(completeReplay.ok && completeReplay.value.decision).toBe(
          "replayed",
        );

        const failLease = await seed(`snapshot-fail-${flavour}`);
        const failInput = {
          outboxId: failLease.record.outboxId,
          workerId: failLease.workerId,
          expectedAttempt: 1,
          leaseToken: failLease.record.leaseToken,
          errorTag: "retryable-original",
          certainty: "not_applied" as const,
          retryAt: "2026-08-13T10:02:00.000Z",
          failedAt: "2026-08-13T10:00:30.000Z",
        };
        const originalFail = structuredClone(failInput);
        const failPromise = fixture.store.fail(failInput);
        Object.assign(failInput, {
          workerId: "mutated",
          leaseToken: "mutated",
          errorTag: "mutated",
          retryAt: null,
          failedAt: "2026-08-13T15:00:00.000Z",
        });
        const failed = await failPromise;
        expect(failed.ok && failed.value.record?.lastErrorTag).toBe(
          originalFail.errorTag,
        );
        expect(failed.ok && failed.value.record?.retryAt).toBe(
          originalFail.retryAt,
        );
        const failReplay = await fixture.store.fail(originalFail);
        expect(failReplay.ok && failReplay.value.decision).toBe("replayed");

        const unknownLease = await seed(`snapshot-unknown-${flavour}`);
        const unknownInput = {
          outboxId: unknownLease.record.outboxId,
          workerId: unknownLease.workerId,
          expectedAttempt: 1,
          leaseToken: unknownLease.record.leaseToken,
          errorTag: "ambiguous-original",
          certainty: "unknown" as const,
          observedAt: "2026-08-13T10:00:30.000Z",
        };
        const originalUnknown = structuredClone(unknownInput);
        const unknownPromise = fixture.store.markUnknown(unknownInput);
        Object.assign(unknownInput, {
          workerId: "mutated",
          leaseToken: "mutated",
          errorTag: "mutated",
          observedAt: "2026-08-13T15:00:00.000Z",
        });
        const unknown = await unknownPromise;
        expect(unknown.ok && unknown.value.record?.lastErrorTag).toBe(
          originalUnknown.errorTag,
        );
        expect(unknown.ok && unknown.value.record?.resultAt).toBe(
          originalUnknown.observedAt,
        );
        const unknownReplay = await fixture.store.markUnknown(originalUnknown);
        expect(unknownReplay.ok && unknownReplay.value.decision).toBe(
          "replayed",
        );

        for (const [name, resolution] of [
          [
            "applied",
            { kind: "applied" as const, receiptRef: `receipt:${flavour}` },
          ],
          [
            "not-applied",
            {
              kind: "not_applied" as const,
              errorTag: "retryable-original",
              retryAt: "2026-08-13T10:03:00.000Z",
            },
          ],
          [
            "cancelled",
            { kind: "cancelled" as const, reasonTag: "operator-original" },
          ],
        ] as const) {
          const lease = await seed(`snapshot-resolve-${name}-${flavour}`);
          await fixture.store.markUnknown({
            outboxId: lease.record.outboxId,
            workerId: lease.workerId,
            expectedAttempt: 1,
            leaseToken: lease.record.leaseToken,
            errorTag: "ambiguous",
            certainty: "unknown",
            observedAt: "2026-08-13T10:00:30.000Z",
          });
          const resolutionInput = {
            outboxId: lease.record.outboxId,
            expectedAttempt: 1,
            reconciliationRef: `reconciliation:${name}:${flavour}`,
            reconciledAt: "2026-08-13T10:02:00.000Z",
            resolution,
          };
          const originalResolution = structuredClone(resolutionInput);
          const resolutionPromise =
            fixture.store.resolveUnknown(resolutionInput);
          Object.assign(resolutionInput, {
            outboxId: "mutated",
            expectedAttempt: 9,
            reconciliationRef: "mutated",
            reconciledAt: "2026-08-13T15:00:00.000Z",
          });
          Object.assign(resolutionInput.resolution, {
            receiptRef: "mutated",
            errorTag: "mutated",
            retryAt: null,
            reasonTag: "mutated",
          });
          const resolved = await resolutionPromise;
          expect(resolved.ok && resolved.value.record?.reconciliationRef).toBe(
            originalResolution.reconciliationRef,
          );
          if (originalResolution.resolution.kind === "applied") {
            expect(resolved.ok && resolved.value.record?.receiptRef).toBe(
              originalResolution.resolution.receiptRef,
            );
          } else if (originalResolution.resolution.kind === "not_applied") {
            expect(resolved.ok && resolved.value.record?.lastErrorTag).toBe(
              originalResolution.resolution.errorTag,
            );
            expect(resolved.ok && resolved.value.record?.retryAt).toBe(
              originalResolution.resolution.retryAt,
            );
          } else {
            expect(
              resolved.ok && resolved.value.record?.cancellationReasonTag,
            ).toBe(originalResolution.resolution.reasonTag);
          }
          const resolutionReplay =
            await fixture.store.resolveUnknown(originalResolution);
          expect(resolutionReplay.ok && resolutionReplay.value.decision).toBe(
            "replayed",
          );
        }

        const cleanupLease = await seed(`snapshot-cleanup-${flavour}`);
        await fixture.store.fail({
          outboxId: cleanupLease.record.outboxId,
          workerId: cleanupLease.workerId,
          expectedAttempt: 1,
          leaseToken: cleanupLease.record.leaseToken,
          errorTag: "fatal",
          certainty: "not_applied",
          retryAt: null,
          failedAt: "2026-08-13T10:00:30.000Z",
        });
        const cleanupInput = {
          cleanupId: `cleanup:snapshot:${flavour}`,
          before: "2026-08-13T11:00:00.000Z",
          after: {
            stateChangedAt: "2026-08-13T09:00:00.000Z",
            outboxId: "before",
          },
          limit: 1,
        };
        const originalCleanup = structuredClone(cleanupInput);
        const cleanupPromise = fixture.store.cleanupTerminal(cleanupInput);
        Object.assign(cleanupInput, {
          cleanupId: "mutated",
          before: "2026-08-13T09:00:00.000Z",
          limit: 100,
        });
        cleanupInput.after.stateChangedAt = "2026-08-13T15:00:00.000Z";
        cleanupInput.after.outboxId = "mutated";
        const cleaned = await cleanupPromise;
        expect(cleaned.ok && cleaned.value.result.deletedIds).toEqual([
          cleanupLease.record.outboxId,
        ]);
        const cleanupReplay =
          await fixture.store.cleanupTerminal(originalCleanup);
        expect(cleanupReplay.ok && cleanupReplay.value.decision).toBe(
          "replayed",
        );
      } finally {
        fixture.database?.close();
      }
    }
  });
});

describe("EF-S05 two-connection lease races", () => {
  test("one claim owner wins and stale result CAS cannot replace it", async () => {
    const dir = mkdtempSync(join(tmpdir(), "piclaw-s05-race-"));
    const path = join(dir, "store.sqlite");
    const left = open(path);
    const right = open(path);
    try {
      expect((await left.store.enqueue(enqueue("race"))).ok).toBeTrue();
      const [a, b] = await Promise.all([
        left.store.claimNext(claim("race-a")),
        right.store.claimNext(claim("race-b")),
      ]);
      expect(a.ok && b.ok).toBeTrue();
      const leases = [a, b].flatMap((result) =>
        result.ok && result.value.lease ? [result.value.lease] : [],
      );
      expect(leases).toHaveLength(1);
      const lease = leases[0];
      if (!lease) throw new Error("missing race winner");
      const stale = await right.store.complete({
        outboxId: lease.record.outboxId,
        workerId: "worker:stale",
        expectedAttempt: lease.record.attempt,
        leaseToken: "opaque:secret-stale",
        receiptRef: "opaque:secret-stale-receipt",
        completedAt: "2026-08-13T10:00:30.000Z",
      });
      expect(stale.ok && stale.value.decision).toBe("stale");
      const winner = await left.store.complete({
        outboxId: lease.record.outboxId,
        workerId: lease.workerId,
        expectedAttempt: lease.record.attempt,
        leaseToken: lease.record.leaseToken,
        receiptRef: "opaque:secret-winner-receipt",
        completedAt: "2026-08-13T10:00:31.000Z",
      });
      expect(winner.ok && winner.value.decision).toBe("applied");
    } finally {
      left.database.close();
      right.database.close();
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe("EF-S05 claim contention replay authority", () => {
  test("two connections preserve CAS-zero empty authority for replay and conflict", async () => {
    const dir = mkdtempSync(join(tmpdir(), "piclaw-s05-claim-cas-"));
    const path = join(dir, "store.sqlite");
    const left = open(path);
    const right = open(path);
    try {
      await left.store.enqueue(enqueue("claim-cas-zero"));
      left.database.exec(`
        CREATE TRIGGER force_claim_cas_zero
        BEFORE UPDATE ON service_effect_s05_outbox
        WHEN OLD.outbox_id='claim-cas-zero' AND NEW.state='started'
        BEGIN SELECT RAISE(IGNORE); END;
      `);
      const request = claim("claim-cas-zero");
      const first = await right.store.claimNext(request);
      expect(first.ok && first.value).toEqual({
        decision: "empty",
        lease: null,
      });
      left.database.exec("DROP TRIGGER force_claim_cas_zero");
      const replay = await left.store.claimNext(request);
      expect(replay.ok && replay.value).toEqual({
        decision: "replayed",
        lease: null,
      });
      typed(
        await right.store.claimNext({
          ...request,
          workerId: "worker:changed",
        }),
        "idempotency_conflict",
      );
      const fresh = await right.store.claimNext(claim("claim-cas-fresh"));
      expect(fresh.ok && fresh.value.lease?.record.outboxId).toBe(
        "claim-cas-zero",
      );
    } finally {
      left.database.close();
      right.database.close();
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe("EF-S05 concurrent outcome authority", () => {
  test("CAS-zero preserves the exact prior stale decision", async () => {
    const fixture = open();
    try {
      await fixture.store.enqueue(enqueue("outcome-cas-zero"));
      const claimed = await fixture.store.claimNext(claim("outcome-cas-zero"));
      if (!claimed.ok || !claimed.value.lease) throw new Error("claim");
      const lease = claimed.value.lease;
      const staleRequest = {
        outboxId: "outcome-cas-zero",
        workerId: "worker:stale",
        expectedAttempt: 1,
        leaseToken: "opaque:secret-stale",
        receiptRef: null,
        completedAt: "2026-08-13T10:00:30.000Z",
      };
      fixture.database
        .query(
          "INSERT INTO service_effect_s05_decisions(decision_key,method,request_hash,outcome,outbox_id,attempt,lease_token_hash,result_json) VALUES (?,?,?,?,?,?,NULL,NULL)",
        )
        .run(
          "outcome:outcome-cas-zero:1",
          "complete",
          hashCanonicalRequest(staleRequest as unknown as CanonicalJsonValue),
          "stale",
          "outcome-cas-zero",
          1,
        );
      fixture.database.exec(`
        CREATE TRIGGER force_outcome_cas_zero
        BEFORE UPDATE ON service_effect_s05_outbox
        WHEN OLD.outbox_id='outcome-cas-zero' AND NEW.state='completed'
        BEGIN SELECT RAISE(IGNORE); END;
      `);
      const correctRequest = {
        ...staleRequest,
        workerId: lease.workerId,
        leaseToken: lease.record.leaseToken,
      };
      const attempted = await fixture.store.complete(correctRequest);
      expect(attempted.ok && attempted.value.decision).toBe("stale");
      expect(
        fixture.database
          .query(
            "SELECT outcome FROM service_effect_s05_decisions WHERE decision_key='outcome:outcome-cas-zero:1'",
          )
          .get(),
      ).toEqual({ outcome: "stale" });
      const replay = await fixture.store.complete(staleRequest);
      expect(replay.ok && replay.value.decision).toBe("stale");
    } finally {
      fixture.database.close();
    }
  });

  test("failed stale-decision deletion rolls back the record CAS as corrupt", async () => {
    const fixture = open();
    try {
      await fixture.store.enqueue(enqueue("outcome-delete-zero"));
      const claimed = await fixture.store.claimNext(
        claim("outcome-delete-zero"),
      );
      if (!claimed.ok || !claimed.value.lease) throw new Error("claim");
      const lease = claimed.value.lease;
      const staleRequest = {
        outboxId: "outcome-delete-zero",
        workerId: "worker:stale",
        expectedAttempt: 1,
        leaseToken: "lease:stale",
        receiptRef: null,
        completedAt: "2026-08-13T10:00:30.000Z",
      };
      fixture.database
        .query(
          "INSERT INTO service_effect_s05_decisions(decision_key,method,request_hash,outcome,outbox_id,attempt,lease_token_hash,result_json) VALUES (?,?,?,?,?,?,NULL,NULL)",
        )
        .run(
          "outcome:outcome-delete-zero:1",
          "complete",
          hashCanonicalRequest(staleRequest as unknown as CanonicalJsonValue),
          "stale",
          "outcome-delete-zero",
          1,
        );
      fixture.database.exec(`
        CREATE TRIGGER force_decision_delete_zero
        BEFORE DELETE ON service_effect_s05_decisions
        WHEN OLD.decision_key='outcome:outcome-delete-zero:1'
        BEGIN SELECT RAISE(IGNORE); END;
      `);
      typed(
        await fixture.store.complete({
          ...staleRequest,
          workerId: lease.workerId,
          leaseToken: lease.record.leaseToken,
        }),
        "corrupt_state",
      );
      const record = await fixture.store.get("outcome-delete-zero");
      expect(record.ok && record.value?.state).toBe("started");
      expect(
        fixture.database
          .query(
            "SELECT outcome FROM service_effect_s05_decisions WHERE decision_key='outcome:outcome-delete-zero:1'",
          )
          .get(),
      ).toEqual({ outcome: "stale" });
    } finally {
      fixture.database.close();
    }
  });

  test("fake rollback preserves prior stale authority before replacement", async () => {
    const fake = new FakeServiceOutboxStore(fakeContext());
    await fake.enqueue(enqueue("outcome-fake-rollback"));
    const claimed = await fake.claimNext(claim("outcome-fake-rollback"));
    if (!claimed.ok || !claimed.value.lease) throw new Error("claim");
    const staleRequest = {
      outboxId: "outcome-fake-rollback",
      workerId: "worker:stale",
      expectedAttempt: 1,
      leaseToken: "lease:stale",
      receiptRef: null,
      completedAt: "2026-08-13T10:00:30.000Z",
    };
    const staleHash = hashCanonicalRequest(
      staleRequest as unknown as CanonicalJsonValue,
    );
    const snapshot = fake.inspectState();
    (snapshot.decisions as unknown as Record<string, Record<string, unknown>>)[
      "outcome:outcome-fake-rollback:1"
    ] = {
      method: "complete",
      hash: staleHash,
      outcome: "stale",
      outboxId: "outcome-fake-rollback",
      attempt: 1,
      tokenHash: null,
      cleanupResult: null,
    };
    fake.restoreMalformedForTesting(snapshot);
    fake.planFaultValue("complete", "before_effect", "in_transaction", 1);
    const rolledBack = await fake.complete({
      ...staleRequest,
      workerId: claimed.value.lease.workerId,
      leaseToken: claimed.value.lease.record.leaseToken,
    });
    typed(rolledBack, "storage_unavailable");
    expect(
      (
        fake.inspectState().decisions as unknown as Record<
          string,
          Record<string, unknown>
        >
      )["outcome:outcome-fake-rollback:1"]?.hash,
    ).toBe(staleHash);
    const replay = await fake.complete(staleRequest);
    expect(replay.ok && replay.value.decision).toBe("stale");
  });

  for (const outcome of ["complete", "fail", "markUnknown"] as const) {
    test(`one of two ${outcome} owners wins without authority overwrite`, async () => {
      const dir = mkdtempSync(join(tmpdir(), `piclaw-s05-${outcome}-`));
      const path = join(dir, "store.sqlite");
      const left = open(path);
      const right = open(path);
      try {
        await left.store.enqueue(enqueue(`race-${outcome}`));
        const claimed = await left.store.claimNext(claim(`race-${outcome}`));
        if (!claimed.ok || !claimed.value.lease) throw new Error("claim");
        const lease = claimed.value.lease;
        const base = {
          outboxId: lease.record.outboxId,
          workerId: lease.workerId,
          expectedAttempt: lease.record.attempt,
          leaseToken: lease.record.leaseToken,
        };
        const calls =
          outcome === "complete"
            ? [
                left.store.complete({
                  ...base,
                  receiptRef: "receipt:left",
                  completedAt: "2026-08-13T10:00:30.000Z",
                }),
                right.store.complete({
                  ...base,
                  receiptRef: "receipt:right",
                  completedAt: "2026-08-13T10:00:31.000Z",
                }),
              ]
            : outcome === "fail"
              ? [
                  left.store.fail({
                    ...base,
                    errorTag: "left",
                    certainty: "not_applied",
                    retryAt: null,
                    failedAt: "2026-08-13T10:00:30.000Z",
                  }),
                  right.store.fail({
                    ...base,
                    errorTag: "right",
                    certainty: "not_applied",
                    retryAt: null,
                    failedAt: "2026-08-13T10:00:31.000Z",
                  }),
                ]
              : [
                  left.store.markUnknown({
                    ...base,
                    errorTag: "left",
                    certainty: "unknown",
                    observedAt: "2026-08-13T10:00:30.000Z",
                  }),
                  right.store.markUnknown({
                    ...base,
                    errorTag: "right",
                    certainty: "unknown",
                    observedAt: "2026-08-13T10:00:31.000Z",
                  }),
                ];
        const results = await Promise.all(calls);
        expect(results.every((result) => result.ok)).toBeTrue();
        expect(
          results.filter(
            (result) => result.ok && result.value.decision === "applied",
          ),
        ).toHaveLength(1);
        expect(
          results.filter(
            (result) => result.ok && result.value.decision === "stale",
          ),
        ).toHaveLength(1);
        const authority = left.database
          .query(
            "SELECT method,request_hash FROM service_effect_s05_outcomes WHERE outbox_id=?",
          )
          .all(lease.record.outboxId);
        expect(authority).toHaveLength(1);
      } finally {
        left.database.close();
        right.database.close();
        rmSync(dir, { recursive: true, force: true });
      }
    });
  }
});

describe("EF-S05 durable replay authority", () => {
  test("replays immutable claim/outcome records and never reuses a cleaned lease token", async () => {
    const fixture = open();
    try {
      const enqueueRequest = enqueue("authority");
      await fixture.store.enqueue(enqueueRequest);
      const claimRequest = claim("authority");
      const claimed = await fixture.store.claimNext(claimRequest);
      if (!claimed.ok || !claimed.value.lease) throw new Error("claim");
      const lease = claimed.value.lease;
      const failRequest = {
        outboxId: "authority",
        workerId: lease.workerId,
        expectedAttempt: lease.record.attempt,
        leaseToken: lease.record.leaseToken,
        errorTag: "poison",
        certainty: "not_applied" as const,
        retryAt: null,
        failedAt: "2026-08-13T10:00:30.000Z",
      };
      await fixture.store.fail(failRequest);
      const enqueueReplay = await fixture.store.enqueue(enqueueRequest);
      expect(enqueueReplay.ok && enqueueReplay.value.record.state).toBe(
        "pending",
      );
      const claimReplay = await fixture.store.claimNext(claimRequest);
      expect(claimReplay.ok && claimReplay.value.lease?.record.state).toBe(
        "started",
      );
      const failReplay = await fixture.store.fail(failRequest);
      expect(failReplay.ok && failReplay.value.record?.state).toBe("failed");
      await fixture.store.cleanupTerminal({
        cleanupId: "authority-cleanup",
        before: "2026-08-13T11:00:00.000Z",
        after: null,
        limit: 10,
      });
      await fixture.store.enqueue(enqueue("authority-next"));
      const reused = await fixture.store.claimNext({
        ...claimRequest,
        now: "2026-08-13T12:00:00.000Z",
        leaseExpiresAt: "2026-08-13T12:01:00.000Z",
      });
      typed(reused, "idempotency_conflict");

      const decisions = JSON.stringify(
        fixture.database
          .query("SELECT * FROM service_effect_s05_decisions")
          .all(),
      );
      const leases = fixture.database
        .query("SELECT * FROM service_effect_s05_leases")
        .all() as Array<Record<string, unknown>>;
      const outcomes = fixture.database
        .query("SELECT * FROM service_effect_s05_outcomes")
        .all() as Array<Record<string, unknown>>;
      const resolutions = fixture.database
        .query("SELECT * FROM service_effect_s05_resolutions")
        .all() as Array<Record<string, unknown>>;
      for (const forbidden of [
        enqueueRequest.payloadRef,
        enqueueRequest.destinationRef,
        enqueueRequest.effect.provenanceRef,
        claimRequest.leaseToken,
        "opaque:secret-receipt",
        "opaque:secret-reconciliation",
      ]) {
        if (forbidden !== null) expect(decisions).not.toContain(forbidden);
      }
      expect(JSON.stringify(leases)).not.toContain(claimRequest.leaseToken);
      expect(leases[0]?.worker_id).toBe(claimRequest.workerId);
      expect(outcomes).toEqual([]);
      expect(resolutions).toEqual([]);

      await fixture.store.enqueue(
        enqueue("authority-resolution", { kind: "notification" }),
      );
      const resolutionClaim = await fixture.store.claimNext({
        ...claim("authority-resolution"),
        kinds: ["notification"],
      });
      if (!resolutionClaim.ok || !resolutionClaim.value.lease) {
        throw new Error("claim");
      }
      await fixture.store.markUnknown({
        outboxId: "authority-resolution",
        workerId: resolutionClaim.value.lease.workerId,
        expectedAttempt: 1,
        leaseToken: resolutionClaim.value.lease.record.leaseToken,
        errorTag: "ambiguous",
        certainty: "unknown",
        observedAt: "2026-08-13T10:00:30.000Z",
      });
      await fixture.store.resolveUnknown({
        outboxId: "authority-resolution",
        expectedAttempt: 1,
        reconciliationRef: "reconciliation:intended",
        reconciledAt: "2026-08-13T10:02:00.000Z",
        resolution: { kind: "cancelled", reasonTag: "operator" },
      });
      const resolutionRows = fixture.database
        .query(
          "SELECT * FROM service_effect_s05_resolutions WHERE outbox_id='authority-resolution'",
        )
        .all() as Array<Record<string, unknown>>;
      expect(resolutionRows).toHaveLength(1);
      expect(resolutionRows[0]?.reconciliation_ref).toBe(
        "reconciliation:intended",
      );
      expect(resolutionRows[0]?.cancellation_reason_tag).toBe("operator");
      expect(
        JSON.stringify(
          fixture.database
            .query("SELECT * FROM service_effect_s05_decisions")
            .all(),
        ),
      ).not.toContain("reconciliation:intended");

      const fake = new FakeServiceOutboxStore(fakeContext());
      await fake.enqueue(enqueue("authority-fake"));
      const fakeClaim = await fake.claimNext(claim("authority-fake"));
      expect(fakeClaim.ok && fakeClaim.value.lease).not.toBeNull();
      const fakeSnapshot = fake.inspectState();
      expect(JSON.stringify(fakeSnapshot.decisions)).not.toContain(
        "opaque:secret-",
      );
      expect(JSON.stringify(fakeSnapshot.leases)).not.toContain(
        "opaque:secret-authority-fake",
      );
    } finally {
      fixture.database.close();
    }
  });
});

describe("EF-S05 held immediate lock is bounded", () => {
  test("enqueue claim reclaim result and cleanup return not_applied then retry", async () => {
    const dir = mkdtempSync(join(tmpdir(), "piclaw-s05-busy-")),
      path = join(dir, "store.sqlite"),
      left = open(path),
      right = open(path);
    right.database.exec("PRAGMA busy_timeout=0");
    try {
      const withLock = async <T>(
        run: () => Promise<ResultValue<T, OutboxStoreError>>,
      ): Promise<ResultValue<T, OutboxStoreError>> => {
        left.database.exec("BEGIN IMMEDIATE");
        const blocked = await run();
        typed(blocked, "storage_unavailable");
        if (!blocked.ok) expect(blocked.error.certainty).toBe("not_applied");
        left.database.exec("ROLLBACK");
        return run();
      };
      expect(
        (await withLock(() => right.store.enqueue(enqueue("busy")))).ok,
      ).toBeTrue();
      expect(
        (await withLock(() => right.store.claimNext(claim("busy")))).ok,
      ).toBeTrue();
      const leased = await right.store.get("busy");
      if (!leased.ok || !leased.value) throw new Error();
      const reclaim: ReclaimOutboxRequest = {
        outboxId: "busy",
        expectedAttempt: 1,
        workerId: "worker:reclaim",
        leaseToken: "opaque:secret-reclaim",
        now: "2026-08-13T10:02:00.000Z",
        leaseExpiresAt: "2026-08-13T10:03:00.000Z",
        authority: { kind: "repeatable" },
      };
      expect(
        (await withLock(() => right.store.reclaim(reclaim))).ok,
      ).toBeTrue();
      const reclaimed = await right.store.get("busy");
      if (!reclaimed.ok || !reclaimed.value) throw new Error();
      const complete: CompleteOutboxRequest = {
        outboxId: "busy",
        workerId: "worker:reclaim",
        expectedAttempt: 2,
        leaseToken: "opaque:secret-reclaim",
        receiptRef: "opaque:secret-receipt",
        completedAt: "2026-08-13T10:02:30.000Z",
      };
      expect(
        (await withLock(() => right.store.complete(complete))).ok,
      ).toBeTrue();
      await right.store.enqueue(enqueue("fatal"));
      const c = await right.store.claimNext({
        ...claim("fatal"),
        now: "2026-08-13T10:04:00.000Z",
        leaseExpiresAt: "2026-08-13T10:05:00.000Z",
      });
      if (!c.ok || !c.value.lease) throw new Error();
      await right.store.fail({
        outboxId: "fatal",
        workerId: c.value.lease.workerId,
        expectedAttempt: 1,
        leaseToken: c.value.lease.record.leaseToken,
        errorTag: "poison",
        certainty: "not_applied",
        retryAt: null,
        failedAt: "2026-08-13T10:04:30.000Z",
      });
      const cleanup: CleanupTerminalOutboxRequest = {
        cleanupId: "busy-cleanup",
        before: "2026-08-13T11:00:00.000Z",
        after: null,
        limit: 10,
      };
      expect(
        (await withLock(() => right.store.cleanupTerminal(cleanup))).ok,
      ).toBeTrue();
    } finally {
      if (left.database.inTransaction) left.database.exec("ROLLBACK");
      left.database.close();
      right.database.close();
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
describe("EF-S05 closed row decoding", () => {
  test("public reads reject malformed enums, correlations, instants, hashes and counters", async () => {
    const corruptions = [
      "UPDATE service_effect_s05_outbox SET kind='other' WHERE outbox_id='decode'",
      "UPDATE service_effect_s05_outbox SET state='other' WHERE outbox_id='decode'",
      "UPDATE service_effect_s05_outbox SET request_hash='x' WHERE outbox_id='decode'",
      "UPDATE service_effect_s05_outbox SET attempt=-1 WHERE outbox_id='decode'",
      "UPDATE service_effect_s05_outbox SET enqueued_at='not-an-instant' WHERE outbox_id='decode'",
      "UPDATE service_effect_s05_outbox SET state='started',attempt=1,certainty=NULL WHERE outbox_id='decode'",
    ];
    for (const statement of corruptions) {
      const fixture = open();
      try {
        await fixture.store.enqueue(enqueue("decode"));
        expect((await fixture.store.get("decode")).ok).toBeTrue();
        fixture.database.exec("PRAGMA ignore_check_constraints=ON");
        fixture.database.exec(statement);
        typed(await fixture.store.get("decode"), "corrupt_state");
      } finally {
        fixture.database.close();
      }
    }
  });
});

describe("EF-S05 trace identity and observer containment", () => {
  test("applied replayed stale error and unknown traces preserve exact closed identity", async () => {
    for (const flavour of ["sqlite", "fake"] as const) {
      const sqlite = flavour === "sqlite" ? open() : null;
      const traces: NormalisedTraceInput[] = sqlite?.runtime.traces ?? [];
      const fake =
        flavour === "fake"
          ? new FakeServiceOutboxStore(fakeContext(), (trace) =>
              traces.push(trace),
            )
          : null;
      const store = sqlite?.store ?? fake;
      if (!store) throw new Error("store");
      try {
        const request = enqueue(`trace-applied-${flavour}`);
        await store.enqueue(request);
        await store.enqueue(request);
        const claimed = await store.claimNext(claim(`trace-claim-${flavour}`));
        if (!claimed.ok || !claimed.value.lease) throw new Error("claim");
        await store.complete({
          outboxId: request.outboxId,
          workerId: "worker:stale",
          expectedAttempt: 1,
          leaseToken: "lease:stale",
          receiptRef: null,
          completedAt: "2026-08-13T10:00:30.000Z",
        });
        await store.enqueue({
          ...request,
          unexpected: true,
        } as EnqueueOutboxRequest);
        await store.complete({
          outboxId: `trace-missing-${flavour}`,
          workerId: "worker:missing",
          expectedAttempt: 1,
          leaseToken: "lease:missing",
          receiptRef: null,
          completedAt: "2026-08-13T10:00:30.000Z",
        });
        const lostRequest = enqueue(`trace-lost-${flavour}`);
        if (sqlite) sqlite.runtime.acknowledgementValue = true;
        else fake?.planFault("enqueue", "effect_then_lost_acknowledgement", 1);
        const lost = await store.enqueue(lostRequest);
        expect(!lost.ok && lost.error.certainty).toBe("unknown");

        const expected = [
          {
            method: "enqueue",
            effectId: request.outboxId,
            operationId: request.effect.operationId,
            sourceSeq: request.effect.sourceSeq,
            version: null,
            resultTag: "applied",
            certainty: "not_applied",
          },
          {
            method: "enqueue",
            effectId: request.outboxId,
            operationId: request.effect.operationId,
            sourceSeq: request.effect.sourceSeq,
            version: null,
            resultTag: "replayed",
            certainty: "not_applied",
          },
          {
            method: "complete",
            effectId: request.outboxId,
            operationId: null,
            sourceSeq: null,
            version: 1,
            resultTag: "stale",
            certainty: null,
          },
          {
            method: "enqueue",
            effectId: "invalid",
            operationId: null,
            sourceSeq: null,
            version: null,
            resultTag: "invalid_request",
            certainty: "not_applied",
          },
          {
            method: "complete",
            effectId: `trace-missing-${flavour}`,
            operationId: null,
            sourceSeq: null,
            version: 1,
            resultTag: "not_found",
            certainty: "not_applied",
          },
          {
            method: "enqueue",
            effectId: lostRequest.outboxId,
            operationId: lostRequest.effect.operationId,
            sourceSeq: lostRequest.effect.sourceSeq,
            version: null,
            resultTag: "storage_unavailable",
            certainty: "unknown",
          },
        ];
        for (const entry of expected) {
          expect(
            traces.find(
              (trace) =>
                trace.method === entry.method &&
                trace.effectId === entry.effectId &&
                trace.resultTag === entry.resultTag,
            ),
          ).toEqual({ contract: "EF-S05", ...entry });
        }
        const beforeReads = traces.length;
        await store.get(request.outboxId);
        await store.listUnknown({
          kinds: ["maintenance"],
          after: null,
          limit: 1,
        });
        expect(traces).toHaveLength(beforeReads);
      } finally {
        sqlite?.database.close();
      }
    }
  });

  test("throwing trace observers cannot change SQLite or fake outcomes", async () => {
    const sqliteDatabase = new Database(":memory:", { strict: true });
    sqliteDatabase.exec("PRAGMA foreign_keys=ON");
    installServiceOutboxSchema(sqliteDatabase);
    const runtime: ServiceOutboxAdapterRuntime = {
      hitFault: () => false,
      recordTrace: () => {
        throw new Error("trace observer");
      },
    };
    const made = createCurrentPiclawServiceOutboxStore(sqliteDatabase, runtime);
    expect(made.ok).toBeTrue();
    if (made.ok)
      expect(
        (await made.value.enqueue(enqueue("trace-throw-sqlite"))).ok,
      ).toBeTrue();
    sqliteDatabase.close();
    const fake = new FakeServiceOutboxStore(fakeContext(), () => {
      throw new Error("trace observer");
    });
    expect((await fake.enqueue(enqueue("trace-throw-fake"))).ok).toBeTrue();
  });
});

describe("EF-S05 public corruption containment", () => {
  test("public SQLite and fake reads return corrupt_state for malformed durable rows", async () => {
    const sqlite = open();
    try {
      await sqlite.store.enqueue(enqueue("corrupt-public"));
      sqlite.database.exec("PRAGMA ignore_check_constraints=ON");
      sqlite.database
        .query(
          "UPDATE service_effect_s05_outbox SET state='other' WHERE outbox_id=?",
        )
        .run("corrupt-public");
      typed(await sqlite.store.get("corrupt-public"), "corrupt_state");
    } finally {
      sqlite.database.close();
    }

    const fake = new FakeServiceOutboxStore(fakeContext());
    await fake.enqueue(enqueue("corrupt-fake"));
    const snapshot = fake.inspectState();
    (snapshot.records["corrupt-fake"] as { state: string }).state = "other";
    fake.restoreMalformedForTesting(snapshot);
    typed(await fake.get("corrupt-fake"), "corrupt_state");
  });

  test("listUnknown closes malformed row and tuple cursor fields in SQLite and fake", async () => {
    for (const statement of [
      "UPDATE service_effect_s05_outbox SET state_changed_at='bad' WHERE outbox_id='corrupt-list'",
      "UPDATE service_effect_s05_outbox SET outbox_id='' WHERE outbox_id='corrupt-list'",
    ]) {
      const sqlite = open();
      try {
        await sqlite.store.enqueue(enqueue("corrupt-list"));
        const claimed = await sqlite.store.claimNext(claim("corrupt-list"));
        if (!claimed.ok || !claimed.value.lease) throw new Error("claim");
        await sqlite.store.markUnknown({
          outboxId: "corrupt-list",
          workerId: claimed.value.lease.workerId,
          expectedAttempt: 1,
          leaseToken: claimed.value.lease.record.leaseToken,
          errorTag: "ambiguous",
          certainty: "unknown",
          observedAt: "2026-08-13T10:00:30.000Z",
        });
        sqlite.database.exec("PRAGMA ignore_check_constraints=ON");
        sqlite.database.exec(statement);
        typed(
          await sqlite.store.listUnknown({
            kinds: ["maintenance"],
            after: null,
            limit: 1,
          }),
          "corrupt_state",
        );
      } finally {
        sqlite.database.close();
      }
    }

    for (const field of ["stateChangedAt", "outboxId"] as const) {
      const fake = new FakeServiceOutboxStore(fakeContext());
      await fake.enqueue(enqueue("corrupt-list-fake"));
      const claimed = await fake.claimNext(claim("corrupt-list-fake"));
      if (!claimed.ok || !claimed.value.lease) throw new Error("claim");
      await fake.markUnknown({
        outboxId: "corrupt-list-fake",
        workerId: claimed.value.lease.workerId,
        expectedAttempt: 1,
        leaseToken: claimed.value.lease.record.leaseToken,
        errorTag: "ambiguous",
        certainty: "unknown",
        observedAt: "2026-08-13T10:00:30.000Z",
      });
      const snapshot = fake.inspectState();
      (snapshot.records["corrupt-list-fake"] as Record<string, unknown>)[
        field
      ] = field === "outboxId" ? "" : "bad";
      fake.restoreMalformedForTesting(snapshot);
      typed(
        await fake.listUnknown({
          kinds: ["maintenance"],
          after: null,
          limit: 1,
        }),
        "corrupt_state",
      );
    }
  });

  test("cleanup replay closes malformed result cursor and decision authority in SQLite and fake", async () => {
    const request = {
      cleanupId: "corrupt-cleanup-matrix",
      before: "2026-08-13T11:00:00.000Z",
      after: null,
      limit: 1,
    };
    for (const [column, value] of [
      ["result_json", "{"],
      [
        "result_json",
        JSON.stringify({
          deletedIds: [],
          deletedCount: 0,
          nextCursor: { stateChangedAt: "bad", outboxId: "cursor" },
        }),
      ],
      ["method", "other"],
      ["request_hash", "x"],
      ["outcome", "other"],
    ] as const) {
      const sqlite = open();
      try {
        await sqlite.store.cleanupTerminal(request);
        sqlite.database.exec("PRAGMA ignore_check_constraints=ON");
        sqlite.database
          .query(
            `UPDATE service_effect_s05_decisions SET ${column}=? WHERE decision_key='cleanup:corrupt-cleanup-matrix'`,
          )
          .run(value);
        typed(await sqlite.store.cleanupTerminal(request), "corrupt_state");
      } finally {
        sqlite.database.close();
      }
    }

    for (const corrupt of [
      (decision: Record<string, unknown>) => {
        decision.method = "other";
      },
      (decision: Record<string, unknown>) => {
        decision.hash = "x";
      },
      (decision: Record<string, unknown>) => {
        decision.outcome = "other";
      },
      (decision: Record<string, unknown>) => {
        (decision.cleanupResult as Record<string, unknown>).deletedCount = -1;
      },
      (decision: Record<string, unknown>) => {
        (decision.cleanupResult as Record<string, unknown>).nextCursor = {
          stateChangedAt: "bad",
          outboxId: "cursor",
        };
      },
    ]) {
      const fake = new FakeServiceOutboxStore(fakeContext());
      await fake.cleanupTerminal(request);
      const snapshot = fake.inspectState();
      corrupt(
        snapshot.decisions[
          "cleanup:corrupt-cleanup-matrix"
        ] as unknown as Record<string, unknown>,
      );
      fake.restoreMalformedForTesting(snapshot);
      typed(await fake.cleanupTerminal(request), "corrupt_state");
    }
  });

  test("malformed decision, lease, outcome and cleanup authority stay closed", async () => {
    for (const scenario of [
      "decision",
      "lease",
      "outcome",
      "cleanup",
    ] as const) {
      const fixture = open();
      try {
        if (scenario === "decision") {
          const request = enqueue("corrupt-decision");
          await fixture.store.enqueue(request);
          fixture.database.exec("PRAGMA ignore_check_constraints=ON");
          fixture.database
            .query(
              "UPDATE service_effect_s05_decisions SET method='other' WHERE decision_key LIKE 'enqueue:%'",
            )
            .run();
          typed(await fixture.store.enqueue(request), "corrupt_state");
        } else if (scenario === "lease") {
          await fixture.store.enqueue(enqueue("corrupt-lease"));
          const request = claim("corrupt-lease");
          await fixture.store.claimNext(request);
          fixture.database.exec("PRAGMA ignore_check_constraints=ON");
          fixture.database
            .query("UPDATE service_effect_s05_leases SET attempt=-1")
            .run();
          typed(await fixture.store.claimNext(request), "corrupt_state");
        } else if (scenario === "outcome") {
          await fixture.store.enqueue(enqueue("corrupt-outcome"));
          const claimed = await fixture.store.claimNext(
            claim("corrupt-outcome"),
          );
          if (!claimed.ok || !claimed.value.lease) throw new Error("claim");
          const request = {
            outboxId: "corrupt-outcome",
            workerId: claimed.value.lease.workerId,
            expectedAttempt: 1,
            leaseToken: claimed.value.lease.record.leaseToken,
            receiptRef: null,
            completedAt: "2026-08-13T10:00:30.000Z",
          };
          await fixture.store.complete(request);
          fixture.database.exec("PRAGMA ignore_check_constraints=ON");
          fixture.database
            .query("UPDATE service_effect_s05_outcomes SET certainty='other'")
            .run();
          typed(await fixture.store.complete(request), "corrupt_state");
        } else {
          const request = {
            cleanupId: "corrupt-cleanup",
            before: "2026-08-13T11:00:00.000Z",
            after: null,
            limit: 1,
          };
          await fixture.store.cleanupTerminal(request);
          fixture.database.exec("PRAGMA ignore_check_constraints=ON");
          fixture.database
            .query(
              "UPDATE service_effect_s05_decisions SET result_json='[]' WHERE decision_key='cleanup:corrupt-cleanup'",
            )
            .run();
          typed(await fixture.store.cleanupTerminal(request), "corrupt_state");
        }
      } finally {
        fixture.database.close();
      }
    }
  });
});

describe("EF-S05 hostile input and redaction", () => {
  test("malformed closed requests never reach SQL and protected values stay out of traces/errors", async () => {
    const f = open();
    try {
      const valid = enqueue("redacted"),
        candidates: unknown[] = [
          { ...valid, extra: true },
          { ...valid, effect: { ...valid.effect, requestHash: "x" } },
          Object.defineProperty({}, "effect", {
            enumerable: true,
            get() {
              throw new Error("opaque:secret-payload");
            },
          }),
          new Proxy(valid, {
            ownKeys() {
              throw new Error("opaque:secret-destination");
            },
          }),
        ];
      for (const candidate of candidates)
        typed(
          await f.store.enqueue(candidate as EnqueueOutboxRequest),
          "invalid_request",
        );
      for (const candidate of [
        enqueue("oversized-id", { outboxId: "x".repeat(513) }),
        enqueue("oversized-payload", { payloadRef: "x".repeat(2049) }),
      ]) {
        typed(await f.store.enqueue(candidate), "invalid_request");
      }
      const good = await f.store.enqueue(valid);
      expect(good.ok).toBeTrue();
      const text = JSON.stringify(f.runtime.traces);
      for (const protectedValue of [
        valid.payloadRef,
        valid.destinationRef,
        valid.effect.provenanceRef,
        "opaque:secret-receipt",
        "opaque:secret-reconciliation",
      ])
        if (protectedValue !== null) expect(text).not.toContain(protectedValue);
      expect(text).not.toContain("opaque:secret-");
    } finally {
      f.database.close();
    }
  });
});
