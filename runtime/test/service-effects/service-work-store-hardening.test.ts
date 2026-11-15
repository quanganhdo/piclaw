import { Database } from "bun:sqlite";
import { describe, expect, spyOn, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

import {
  hashCanonicalRequest,
  type CanonicalJsonValue,
  type EffectIdentity,
  type NormalisedTraceInput,
} from "../../src/service-effects/contracts/common.js";
import type {
  AcceptSourceRequest,
  ClaimNextSourceRequest,
  OperationSnapshot,
  ServiceWorkError,
} from "../../src/service-effects/contracts/service-work-store.js";
import { installServiceWorkSchema } from "../../src/service-effects/current-piclaw/service-work-schema.js";
import { FakeServiceWorkStore } from "../../src/service-effects/testing/fakes/fake-service-work-store.js";
import {
  ManualEffectClock,
  SequenceEffectIdSource,
} from "../../src/service-effects/testing/deterministic-controls.js";
import { DeterministicFaultPlan } from "../../src/service-effects/testing/fault-plan.js";
import {
  createCurrentPiclawServiceWorkStore,
  CurrentPiclawServiceWorkStore,
  type ServiceWorkAdapterRuntime,
} from "../../src/service-effects/current-piclaw/service-work-store.js";
import type { MutationMethod } from "../../src/service-effects/current-piclaw/service-work-request-normalizer.js";

class Runtime implements ServiceWorkAdapterRuntime {
  readonly traces: NormalisedTraceInput[] = [];
  hitFault(
    _point: "before_effect" | "effect_then_lost_acknowledgement",
    _method: MutationMethod,
  ): unknown {
    return false;
  }
  recordTrace(input: NormalisedTraceInput): void {
    this.traces.push(input);
  }
}

function mustCreateCurrentStore(
  database: Database,
  runtime: ServiceWorkAdapterRuntime,
): CurrentPiclawServiceWorkStore {
  const result = createCurrentPiclawServiceWorkStore(database, runtime);
  if (!result.ok) throw new Error("test store construction failed");
  return result.value;
}

function open(path = ":memory:"): {
  database: Database;
  runtime: Runtime;
  store: CurrentPiclawServiceWorkStore;
} {
  const database = new Database(path, { strict: true });
  installServiceWorkSchema(database);
  const runtime = new Runtime();
  return {
    database,
    runtime,
    store: mustCreateCurrentStore(database, runtime),
  };
}

function effect(key: string): EffectIdentity {
  return {
    idempotencyKey: key,
    requestHash: "",
    operationId: null,
    sourceSeq: null,
    provenanceRef: "opaque:provenance",
    redactionClass: "secret",
  };
}

function hashed<T extends { effect: EffectIdentity }>(request: T): T {
  const base = { ...request, effect: { ...request.effect, requestHash: "" } };
  return {
    ...base,
    effect: {
      ...base.effect,
      requestHash: hashCanonicalRequest(base as unknown as CanonicalJsonValue),
    },
  } as T;
}

function source(
  id: string,
  chatJid = "chat-1",
  key = `source:${id}`,
): AcceptSourceRequest {
  return hashed({
    effect: effect(key),
    chatJid,
    sourceId: id,
    kind: "message",
    payloadRef: `opaque:${id}`,
    targetOperationId: null,
    parentSourceSeq: null,
    acceptedAt: "2026-08-13T07:00:00.000Z",
    createWakeIntent: false,
  });
}

function claim(
  chatJid: string,
  operationId: string,
  key: string,
): ClaimNextSourceRequest {
  return hashed({
    effect: effect(key),
    chatJid,
    expectedFrontier: 0,
    newOperationId: operationId,
    claimedAt: "2026-08-13T07:00:01.000Z",
  });
}

function expectTypedFailure(
  result: { ok: true } | { ok: false; error: ServiceWorkError },
  tag: ServiceWorkError["_tag"],
): void {
  expect(result.ok).toBeFalse();
  if (!result.ok) {
    expect(result.error._tag).toBe(tag);
    expect(JSON.stringify(result.error)).not.toContain("SQLITE");
  }
}

async function exhaustedAdmission<T>(run: () => Promise<T>): Promise<T> {
  const clock = spyOn(performance, "now").mockReturnValueOnce(0).mockReturnValue(5001);
  try { return await run(); } finally { clock.mockRestore(); }
}

describe("EF-S01 schema and two-connection concurrency", () => {
  test("bounded construction hides setup and SQLite messages", async () => {
    const database = new Database(":memory:", { strict: true });
    const runtime = new Runtime();
    const beforeInstall = createCurrentPiclawServiceWorkStore(
      database,
      runtime,
    );
    expect(beforeInstall.ok).toBeFalse();
    if (!beforeInstall.ok) {
      expect(JSON.stringify(beforeInstall.error)).not.toContain("SQLite");
      expect(JSON.stringify(beforeInstall.error)).not.toContain("foreign-key");
    }
    installServiceWorkSchema(database);
    const constructed = createCurrentPiclawServiceWorkStore(database, runtime);
    expect(constructed.ok).toBeTrue();
    if (constructed.ok) {
      const result = await constructed.value.acceptSource(
        source("constructed"),
      );
      expect(result.ok).toBeTrue();
    }
    database.close();
  });
  test("failed installation rolls back every EF-S01 table", () => {
    const database = new Database(":memory:", { strict: true });
    database.exec(
      "CREATE VIEW service_effect_s01_operations AS SELECT 1 AS value",
    );
    expect(() => installServiceWorkSchema(database)).toThrow();
    const tables = database
      .query(
        "SELECT name FROM sqlite_master WHERE type='table' AND name LIKE 'service_effect_s01_%'",
      )
      .all();
    expect(tables).toHaveLength(0);
    database.close();
  });

  test("held immediate lock yields bounded not_applied then same-key retry succeeds", async () => {
    const directory = mkdtempSync(join(tmpdir(), "piclaw-s01-busy-"));
    const path = join(directory, "store.sqlite");
    const left = open(path);
    const right = open(path);
    try {
      right.database.exec("PRAGMA busy_timeout = 0");
      left.database.exec("BEGIN IMMEDIATE");
      const request = source("busy-source");
      const blocked = await exhaustedAdmission(() => right.store.acceptSource(request));
      expectTypedFailure(blocked, "storage_unavailable");
      if (!blocked.ok) expect(blocked.error.certainty).toBe("not_applied");
      left.database.exec("ROLLBACK");
      expect((await right.store.acceptSource(request)).ok).toBeTrue();

      const claimRequest = claim(
        "chat-1",
        "busy-claim-operation",
        "busy-claim",
      );
      left.database.exec("BEGIN IMMEDIATE");
      const claimBlocked = await exhaustedAdmission(() => right.store.claimNext(claimRequest));
      expectTypedFailure(claimBlocked, "storage_unavailable");
      if (!claimBlocked.ok)
        expect(claimBlocked.error.certainty).toBe("not_applied");
      left.database.exec("ROLLBACK");
      expect((await right.store.claimNext(claimRequest)).ok).toBeTrue();

      const operation = await seedOperation(
        right.store,
        "busy-chat",
        "busy-operation",
      );
      const target = await right.store.acceptSource(
        hashed({
          ...source("busy-target", "busy-chat"),
          targetOperationId: operation.operationId,
        }),
      );
      expect(target.ok).toBeTrue();
      if (!target.ok) return;
      const queueAccepted = await right.store.recordQueuedInput(
        queueRequest(
          operation,
          target.value.sourceSeq,
          "busy-queue:accepted",
          "accepted",
          null,
        ),
      );
      expect(queueAccepted.ok).toBeTrue();
      if (!queueAccepted.ok) return;
      left.database.exec("BEGIN IMMEDIATE");
      const cas = queueRequest(
        queueAccepted.value,
        target.value.sourceSeq,
        "busy-queue:queued",
        "queued",
        "busy-entry",
      );
      const casBlocked = await exhaustedAdmission(() => right.store.recordQueuedInput(cas));
      expectTypedFailure(casBlocked, "storage_unavailable");
      if (!casBlocked.ok)
        expect(casBlocked.error.certainty).toBe("not_applied");
      left.database.exec("ROLLBACK");
      expect((await right.store.recordQueuedInput(cas)).ok).toBeTrue();
    } finally {
      if (left.database.inTransaction) left.database.exec("ROLLBACK");
      left.database.close();
      right.database.close();
      rmSync(directory, { recursive: true, force: true });
    }
  });

  test("sequential independent writers allocate consecutive sources and one owner", async () => {
    const directory = mkdtempSync(join(tmpdir(), "piclaw-s01-race-"));
    const path = join(directory, "store.sqlite");
    const left = open(path);
    const right = open(path);
    try {
      const accepted = await Promise.all([
        left.store.acceptSource(source("a")),
        right.store.acceptSource(source("b")),
      ]);
      expect(accepted.every((result) => result.ok)).toBeTrue();
      expect(
        accepted
          .flatMap((result) => (result.ok ? [result.value.sourceSeq] : []))
          .sort(),
      ).toEqual([1, 2]);
      const claimed = await Promise.all([
        left.store.claimNext(claim("chat-1", "operation-a", "claim:a")),
        right.store.claimNext(claim("chat-1", "operation-b", "claim:b")),
      ]);
      expect(claimed.filter((result) => result.ok)).toHaveLength(1);
      expect(
        claimed.filter(
          (result) => !result.ok && result.error._tag === "owner_conflict",
        ),
      ).toHaveLength(1);
    } finally {
      left.database.close();
      right.database.close();
      rmSync(directory, { recursive: true, force: true });
    }
  });
});

describe("EF-S01 hostile boundaries and identity", () => {
  test("rejects malformed hashes, enums, timestamps, extra fields, getters and proxies before SQL", async () => {
    const fixture = open();
    try {
      const malformed = source("bad");
      const cyclic: Record<string, unknown> = {};
      cyclic.self = cyclic;
      const sparse: unknown[] = [];
      sparse.length = 2;
      const candidates: unknown[] = [
        { ...malformed, effect: { ...malformed.effect, requestHash: "x" } },
        hashed({
          ...malformed,
          kind: "unknown" as AcceptSourceRequest["kind"],
        }),
        hashed({ ...malformed, acceptedAt: "2026-08-13" }),
        hashed({ ...malformed, extra: true } as AcceptSourceRequest & {
          extra: boolean;
        }),
        { ...malformed, extra: cyclic },
        { ...malformed, extra: sparse },
        { ...malformed, extra: Symbol("invalid") },
        { ...malformed, extra: () => undefined },
        Object.defineProperty({}, "effect", {
          enumerable: true,
          get() {
            throw new Error("protected");
          },
        }),
        new Proxy(malformed, {
          ownKeys() {
            throw new Error("protected");
          },
        }),
      ];
      for (const candidate of candidates)
        expectTypedFailure(
          await fixture.store.acceptSource(candidate as AcceptSourceRequest),
          "invalid_transition",
        );
      expect((await fixture.store.getChatFrontier("chat-1")).ok).toBeTrue();
    } finally {
      fixture.database.close();
    }
  });

  test("canonical hashes are lowercase SHA-256 and omit transport-only fields", () => {
    const request = source("vector");
    expect(request.effect.requestHash).toMatch(/^[0-9a-f]{64}$/);
    const withAttempt = { ...request, attempt: 4, traceId: "ignored" };
    expect(
      hashCanonicalRequest(withAttempt as unknown as CanonicalJsonValue),
    ).toBe(request.effect.requestHash);
    expect(request.effect.requestHash).toBe(
      "17ed3a449b1e407dc6adf609001623d0203ecb7eaacb0c4b46c4fadf2979d0cf",
    );
  });

  test("equal source under a new effect key replays while changed source conflicts", async () => {
    const fixture = open();
    try {
      const first = source("same", "chat-1", "effect:first");
      const equal = source("same", "chat-1", "effect:second");
      const changed = hashed({
        ...equal,
        effect: effect("effect:third"),
        payloadRef: "opaque:changed",
      });
      const a = await fixture.store.acceptSource(first);
      const b = await fixture.store.acceptSource(equal);
      expect(
        a.ok && b.ok && a.value.sourceSeq === b.value.sourceSeq,
      ).toBeTrue();
      expectTypedFailure(
        await fixture.store.acceptSource(changed),
        "idempotency_conflict",
      );
    } finally {
      fixture.database.close();
    }
  });

  test("one idempotency key cannot alias across methods", async () => {
    const fixture = open();
    try {
      expect(
        (
          await fixture.store.acceptSource(
            source("one", "chat-1", "global-key"),
          )
        ).ok,
      ).toBeTrue();
      expectTypedFailure(
        await fixture.store.claimNext(
          claim("chat-1", "operation-1", "global-key"),
        ),
        "idempotency_conflict",
      );
    } finally {
      fixture.database.close();
    }
  });

  test("expected errors are retryable with the same key after durable state changes", async () => {
    const fixture = open();
    try {
      const missingOperationEffect = {
        ...effect("retry-key"),
        operationId: "operation-1" as string,
      };
      const intent = hashed({
        effect: missingOperationEffect,
        expectedVersion: 1,
        intentId: "intent-1",
        kind: "prompt" as const,
        payloadRef: "opaque:intent",
        createdAt: "2026-08-13T07:00:02.000Z",
      });
      expectTypedFailure(await fixture.store.appendIntent(intent), "not_found");
      expect((await fixture.store.acceptSource(source("later"))).ok).toBeTrue();
      expect(
        (
          await fixture.store.claimNext(
            claim("chat-1", "operation-1", "claim:later"),
          )
        ).ok,
      ).toBeTrue();
      expect((await fixture.store.appendIntent(intent)).ok).toBeTrue();
    } finally {
      fixture.database.close();
    }
  });

  test("binding identity is immutable and retired SDK observations reject before mutation", async () => {
    const fixture = open();
    try {
      const operation = await seedOperation(
        fixture.store,
        "chat-1",
        "operation-1",
      );
      const base = {
        effect: { ...effect("bind:first"), operationId: operation.operationId },
        expectedVersion: operation.version,
        sessionId: "session-1",
        harnessOperationId: "run-1",
      };
      const request = hashed(base);
      expect((await fixture.store.bindHarness(request)).ok).toBeTrue();
      for (const [key, patch] of [
        ["session", { sessionId: "session-2" }],
        ["lane", { lane: "other" }],
        ["run", { harnessOperationId: "run-2" }],
        ["state", { state: "suspended" as const }],
        ["generation", { watchGeneration: 8 }],
      ] as const) {
        const changed = hashed({
          ...request,
          ...patch,
          effect: { ...request.effect, idempotencyKey: `bind:${key}` },
        });
        expectTypedFailure(
          await fixture.store.bindHarness(changed),
          key === 'session' || key === 'run' ? 'owner_conflict' : 'invalid_transition',
        );
      }
    } finally {
      fixture.database.close();
    }
  });

  test("queue transition matrix supports dispose paths and rejects regressions", async () => {
    const fixture = open();
    try {
      let operation = await seedOperation(
        fixture.store,
        "chat-1",
        "operation-1",
      );
      const direct = await fixture.store.acceptSource(
        hashed({
          ...source("dispose-direct"),
          targetOperationId: operation.operationId,
        }),
      );
      expect(direct.ok).toBeTrue();
      if (!direct.ok) return;
      const accepted = await fixture.store.recordQueuedInput(
        queueRequest(
          operation,
          direct.value.sourceSeq,
          "direct:accepted",
          "accepted",
          null,
        ),
      );
      expect(accepted.ok).toBeTrue();
      if (!accepted.ok) return;
      const disposed = await fixture.store.recordQueuedInput(
        queueRequest(
          accepted.value,
          direct.value.sourceSeq,
          "direct:disposed",
          "disposed",
          null,
        ),
      );
      expect(disposed.ok).toBeTrue();
      if (!disposed.ok) return;
      expectTypedFailure(
        await fixture.store.recordQueuedInput(
          queueRequest(
            disposed.value,
            direct.value.sourceSeq,
            "direct:regress",
            "queued",
            "entry",
          ),
        ),
        "invalid_transition",
      );
      operation = disposed.value;
      const second = await fixture.store.acceptSource(
        hashed({
          ...source("dispose-queued"),
          targetOperationId: operation.operationId,
        }),
      );
      expect(second.ok).toBeTrue();
      if (!second.ok) return;
      const secondAccepted = await fixture.store.recordQueuedInput(
        queueRequest(
          operation,
          second.value.sourceSeq,
          "queued:accepted",
          "accepted",
          null,
        ),
      );
      expect(secondAccepted.ok).toBeTrue();
      if (!secondAccepted.ok) return;
      const queued = await fixture.store.recordQueuedInput(
        queueRequest(
          secondAccepted.value,
          second.value.sourceSeq,
          "queued:queued",
          "queued",
          "entry",
        ),
      );
      expect(queued.ok).toBeTrue();
      if (!queued.ok) return;
      expect(
        (
          await fixture.store.recordQueuedInput(
            queueRequest(
              queued.value,
              second.value.sourceSeq,
              "queued:disposed",
              "disposed",
              "entry",
            ),
          )
        ).ok,
      ).toBeTrue();
    } finally {
      fixture.database.close();
    }
  });

  test("read boundaries reject hostile identifiers consistently", async () => {
    const fixture = open();
    try {
      expectTypedFailure(
        await fixture.store.getOperation(" "),
        "invalid_transition",
      );
      expectTypedFailure(
        await fixture.store.getChatFrontier(" "),
        "invalid_transition",
      );
      const hostile = Object.defineProperty({}, "limit", {
        enumerable: true,
        get() {
          throw new Error("protected");
        },
      });
      expectTypedFailure(
        await fixture.store.listOpenOperations(hostile),
        "invalid_transition",
      );
    } finally {
      fixture.database.close();
    }
  });
});

describe("EF-S01 corruption, redaction and callback faults", () => {
  test("throwing fake trace observers are observational and redact protected values", async () => {
    const context = {
      clock: new ManualEffectClock("2026-08-13T07:00:00.000Z"),
      ids: new SequenceEffectIdSource("fake-trace"),
      faults: new DeterministicFaultPlan(),
    };
    const observed: NormalisedTraceInput[] = [];
    const store = new FakeServiceWorkStore(context, undefined, (input) => {
      observed.push(input);
      throw new Error("protected observer failure");
    });
    const request = source("secret-trace-source");
    const result = await store.acceptSource(request);
    expect(result.ok).toBeTrue();
    expect(store.inspectState().sources).toHaveLength(1);
    const serialized = JSON.stringify(observed);
    expect(serialized).not.toContain(request.payloadRef);
    expect(serialized).not.toContain(request.effect.provenanceRef);
    expect(store.trace.inspect()).toHaveLength(2);
  });

  test("fake normalizer is independently structured and never imports the adapter", async () => {
    const sourceText = await Bun.file(
      new URL(
        "../../src/service-effects/testing/fakes/fake-service-work-request-normalizer.ts",
        import.meta.url,
      ),
    ).text();
    expect(sourceText).toContain("function parseMutation");
    expect(sourceText).toContain("switch (method)");
    expect(sourceText).not.toContain(
      "current-piclaw/service-work-request-normalizer",
    );
    expect(sourceText).not.toContain("normaliseMutationRequest");
  });

  test("fault callback matrix is closed at pre-effect and in-transaction boundaries", async () => {
    const cases = [
      { name: "false", invoke: () => false, succeeds: true },
      { name: "true", invoke: () => true, succeeds: false },
      { name: "nonboolean", invoke: () => Symbol("invalid"), succeeds: false },
      {
        name: "throw",
        invoke: () => {
          throw new Error("protected");
        },
        succeeds: false,
      },
    ];
    for (const boundary of ["pre", "transaction"] as const) {
      for (const callbackCase of cases) {
        for (const implementation of ["sqlite", "fake"] as const) {
          let calls = 0;
          let hostile = true;
          const callback = (point: string) => {
            if (point !== "before_effect" || !hostile) return false;
            calls += 1;
            return boundary === "pre" || calls === 2
              ? callbackCase.invoke()
              : false;
          };
          const request = source(
            `fault-${boundary}-${callbackCase.name}-${implementation}`,
          );
          const context = {
            clock: new ManualEffectClock("2026-08-13T07:00:00.000Z"),
            ids: new SequenceEffectIdSource("fault-matrix"),
            faults: new DeterministicFaultPlan(),
          };
          const database =
            implementation === "sqlite"
              ? new Database(":memory:", { strict: true })
              : null;
          if (database) installServiceWorkSchema(database);
          const store =
            implementation === "sqlite"
              ? mustCreateCurrentStore(database!, {
                  hitFault: (point) => callback(point),
                  recordTrace: () => undefined,
                })
              : new FakeServiceWorkStore(context, callback);
          const result = await store.acceptSource(request);
          expect(result.ok).toBe(callbackCase.succeeds);
          if (!result.ok) expect(result.error.certainty).toBe("not_applied");
          hostile = false;
          if (!callbackCase.succeeds)
            expect((await store.acceptSource(request)).ok).toBeTrue();
          database?.close();
        }
      }
    }
  });
  test("fake hostile pre-effect fault callbacks are closed not_applied", async () => {
    for (const callback of [
      () => Symbol("invalid"),
      () => Promise.resolve(true),
      () => {
        throw new Error("protected");
      },
    ]) {
      const context = {
        clock: new ManualEffectClock("2026-08-13T07:00:00.000Z"),
        ids: new SequenceEffectIdSource("fake-hostile"),
        faults: new DeterministicFaultPlan(),
      };
      const store = new FakeServiceWorkStore(context, callback);
      const result = await store.acceptSource(source("fake-callback"));
      expectTypedFailure(result, "storage_unavailable");
      if (!result.ok) expect(result.error.certainty).toBe("not_applied");
      expect(store.inspectState().sources).toHaveLength(0);
      const restored = new FakeServiceWorkStore(context);
      restored.restore(store.snapshot());
      expect(
        (await restored.acceptSource(source("fake-callback"))).ok,
      ).toBeTrue();
    }
  });

  test("acknowledgement callback matrix reserves unknown for exact true", async () => {
    const cases = [
      { name: "false", invoke: () => false, succeeds: true },
      { name: "true", invoke: () => true, succeeds: false },
      { name: "nonboolean", invoke: () => Symbol("invalid"), succeeds: true },
      {
        name: "throw",
        invoke: () => {
          throw new Error("protected");
        },
        succeeds: true,
      },
    ];
    for (const callbackCase of cases) {
      for (const implementation of ["sqlite", "fake"] as const) {
        const callback = (point: string) =>
          point === "effect_then_lost_acknowledgement"
            ? callbackCase.invoke()
            : false;
        const request = source(`ack-${implementation}-${callbackCase.name}`);
        if (implementation === "sqlite") {
          const database = new Database(":memory:", { strict: true });
          installServiceWorkSchema(database);
          const store = mustCreateCurrentStore(database, {
            hitFault: (point) => callback(point),
            recordTrace: () => undefined,
          });
          const result = await store.acceptSource(request);
          expect(result.ok).toBe(callbackCase.succeeds);
          if (!result.ok) expect(result.error.certainty).toBe("unknown");
          expect((await store.acceptSource(request)).ok).toBe(
            callbackCase.succeeds,
          );
          database.close();
        } else {
          const context = {
            clock: new ManualEffectClock("2026-08-13T07:00:00.000Z"),
            ids: new SequenceEffectIdSource("fake-ack"),
            faults: new DeterministicFaultPlan(),
          };
          const store = new FakeServiceWorkStore(context, callback);
          const result = await store.acceptSource(request);
          expect(result.ok).toBe(callbackCase.succeeds);
          if (!result.ok) expect(result.error.certainty).toBe("unknown");
        }
      }
    }
  });
  test("malformed decisions and rows return closed corrupt_state", async () => {
    const fixture = open();
    try {
      const request = source("corrupt");
      expect((await fixture.store.acceptSource(request)).ok).toBeTrue();
      fixture.database
        .query(
          "UPDATE service_effect_s01_decisions SET result_json = ? WHERE idempotency_key = ?",
        )
        .run(
          '{"kind":"source","payload":"secret"}',
          request.effect.idempotencyKey,
        );
      expectTypedFailure(
        await fixture.store.acceptSource(request),
        "corrupt_state",
      );
      fixture.database.exec("PRAGMA ignore_check_constraints = ON");
      fixture.database
        .query(
          "UPDATE service_effect_s01_sources SET state = 'broken' WHERE chat_jid = 'chat-1'",
        )
        .run();
      fixture.database
        .query(
          "UPDATE service_effect_s01_sources SET source_hash = 'broken' WHERE chat_jid = 'chat-1' AND source_id = 'corrupt'",
        )
        .run();
      expectTypedFailure(
        await fixture.store.acceptSource(request),
        "corrupt_state",
      );
    } finally {
      fixture.database.close();
    }
  });

  test("traces and decisions omit opaque payload and provenance values", async () => {
    const fixture = open();
    try {
      const request = source("secret-source");
      expect((await fixture.store.acceptSource(request)).ok).toBeTrue();
      const traces = JSON.stringify(fixture.runtime.traces);
      const decision = fixture.database
        .query(
          "SELECT result_json FROM service_effect_s01_decisions WHERE idempotency_key = ?",
        )
        .get(request.effect.idempotencyKey) as { result_json: string };
      expect(traces).not.toContain(request.payloadRef);
      expect(traces).not.toContain(request.effect.provenanceRef);
      expect(decision.result_json).not.toContain(request.payloadRef);
      expect(decision.result_json).not.toContain(request.effect.provenanceRef);

      let operation = await seedOperation(
        fixture.store,
        "secret-chat",
        "secret-operation",
      );
      const intentPayload = "secret-intent-payload";
      const intent = await fixture.store.appendIntent(
        hashed({
          effect: {
            ...effect("secret-intent-key"),
            operationId: operation.operationId,
            provenanceRef: "secret-intent-provenance",
          },
          expectedVersion: operation.version,
          intentId: "secret-intent-id",
          kind: "prompt" as const,
          payloadRef: intentPayload,
          createdAt: "2026-08-13T07:00:02.000Z",
        }),
      );
      expect(intent.ok).toBeTrue();
      if (!intent.ok) return;
      operation = intent.value;
      const harness = await fixture.store.bindHarness(
        hashed({
          effect: {
            ...effect("secret-bind-key"),
            operationId: operation.operationId,
          },
          expectedVersion: operation.version,
          sessionId: "secret-session",
          harnessOperationId: "secret-run",
        }),
      );
      expect(harness.ok).toBeTrue();
      if (!harness.ok) return;
      operation = harness.value;
      const cancellationSource = await fixture.store.acceptSource(
        hashed({
          ...source("secret-cancel-source", "secret-chat"),
          kind: "cancellation" as const,
          targetOperationId: operation.operationId,
          payloadRef: "secret-cancellation-payload",
        }),
      );
      expect(cancellationSource.ok).toBeTrue();
      if (!cancellationSource.ok) return;
      const cancelled = await fixture.store.acceptCancellation(
        hashed({
          effect: {
            ...effect("secret-cancel-key"),
            operationId: operation.operationId,
            provenanceRef: "secret-cancel-provenance",
          },
          expectedVersion: operation.version,
          sourceId: cancellationSource.value.sourceId,
          sourceSeq: cancellationSource.value.sourceSeq,
          cause: "secret-cause",
          requestedAt: "2026-08-13T07:00:03.000Z",
        }),
      );
      expect(cancelled.ok).toBeTrue();
      const protectedValues = [
        intentPayload,
        "secret-intent-provenance",
        "secret-cancellation-payload",
        "secret-cancel-provenance",
        "secret-cause",
        "secret-session",
        "secret-lane",
        "secret-run",
      ];
      const observations = JSON.stringify(fixture.runtime.traces);
      for (const protectedValue of protectedValues)
        expect(observations).not.toContain(protectedValue);
      const decisions = fixture.database
        .query("SELECT result_json FROM service_effect_s01_decisions")
        .all() as Array<{ result_json: string }>;
      const durable = decisions.map((row) => row.result_json).join("\n");
      expect(durable).not.toContain(intentPayload);
      expect(durable).not.toContain("secret-intent-provenance");
      expect(durable).not.toContain("secret-cancellation-payload");
      expect(durable).not.toContain("secret-cancel-provenance");
      // Opaque operation identity/correlation and cancellation state are required replay aggregate fields.
      expect(durable).toContain("secret-session");
      expect(durable).toContain("secret-cause");
    } finally {
      fixture.database.close();
    }
  });

  test("throwing and nonboolean fault callbacks are bounded not_applied", async () => {
    for (const value of [
      Symbol("invalid"),
      Promise.resolve(true),
    ] as unknown[]) {
      const database = new Database(":memory:", { strict: true });
      installServiceWorkSchema(database);
      const runtime: ServiceWorkAdapterRuntime = {
        hitFault: () => value,
        recordTrace: () => undefined,
      };
      const store = mustCreateCurrentStore(database, runtime);
      const result = await store.acceptSource(source("callback"));
      expectTypedFailure(result, "storage_unavailable");
      if (!result.ok) expect(result.error.certainty).toBe("not_applied");
      database.close();
    }
    const database = new Database(":memory:", { strict: true });
    installServiceWorkSchema(database);
    const runtime: ServiceWorkAdapterRuntime = {
      hitFault: () => {
        throw new Error("protected");
      },
      recordTrace: () => {
        throw new Error("protected");
      },
    };
    const result = await mustCreateCurrentStore(database, runtime).acceptSource(
      source("throwing"),
    );
    expectTypedFailure(result, "storage_unavailable");
    database.close();
  });
});

async function seedOperation(
  store: CurrentPiclawServiceWorkStore,
  chatJid: string,
  operationId: string,
): Promise<OperationSnapshot> {
  const accepted = await store.acceptSource(
    source(`primary:${chatJid}`, chatJid),
  );
  if (!accepted.ok) throw new Error("seed acceptance failed");
  const claimed = await store.claimNext(
    claim(chatJid, operationId, `claim:${chatJid}`),
  );
  if (!claimed.ok || !claimed.value) throw new Error("seed claim failed");
  return claimed.value.operation;
}

function queueRequest(
  operation: OperationSnapshot,
  sourceSeq: number,
  key: string,
  state: "accepted" | "queued" | "consumed" | "disposed",
  harnessEntryId: string | null,
) {
  return hashed({
    effect: { ...effect(key), operationId: operation.operationId },
    expectedVersion: operation.version,
    sourceSeq,
    queueKind: "follow_up" as const,
    harnessEntryId,
    state,
  });
}
