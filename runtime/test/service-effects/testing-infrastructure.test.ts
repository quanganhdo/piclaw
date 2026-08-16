import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import {
  hashCanonicalRequest,
  type NormalisedEffectTrace,
} from "../../src/service-effects/contracts/common.js";
import { SERVICE_WORK_STORE_CONTRACT_CASE_NAMES } from "../../src/service-effects/testing/contract-suites/service-work-store-contract.js";
import { SERVICE_OUTBOX_STORE_CONTRACT_CASE_NAMES } from "../../src/service-effects/testing/contract-suites/service-outbox-store-contract.js";
import { TERMINAL_SETTLEMENT_CONTRACT_CASE_NAMES } from "../../src/service-effects/testing/contract-suites/terminal-settlement-store-contract.js";
import {
  runParameterisedContractSuite,
  type ContractSubjectFactory,
  type ContractTestContext,
  type ParameterisedContractCase,
} from "../../src/service-effects/testing/contract-suite.js";
import { InMemoryEffectPayloadResolver } from "../../src/service-effects/testing/in-memory-payload-resolver.js";
import {
  ControlledBarrier,
  crashAndRestore,
  DelayedCompletion,
  EffectInterleavingController,
  ManualEffectClock,
  SequenceEffectIdSource,
} from "../../src/service-effects/testing/deterministic-controls.js";
import {
  assertCompleteEffectorCaseCatalogue,
  EFFECTOR_CASE_CATALOGUE,
  EFFECTOR_CONTRACT_IDS,
  SHARED_EFFECTOR_CASE_CATALOGUE,
  type SharedEffectorCase,
  type SharedEffectorCaseId,
} from "../../src/service-effects/testing/effector-case-catalogue.js";
import {
  DeterministicFaultPlan,
  STANDARD_FAULT_POINTS,
  type PlannedFault,
} from "../../src/service-effects/testing/fault-plan.js";
import { EffectTraceRecorder } from "../../src/service-effects/testing/trace-recorder.js";

describe("latent deterministic effect testing controls", () => {
  test("manual clock and sequence IDs are deterministic", () => {
    const clock = new ManualEffectClock("2026-02-03T04:05:06.000Z");
    const ids = new SequenceEffectIdSource("case", 3);

    expect(clock.now().toISOString()).toBe("2026-02-03T04:05:06.000Z");
    expect(clock.advance(250).toISOString()).toBe("2026-02-03T04:05:06.250Z");
    expect([ids.nextId(), ids.nextId()]).toEqual(["case-001", "case-002"]);
  });

  test("every standard fault can be injected at an exact occurrence", () => {
    for (const point of STANDARD_FAULT_POINTS) {
      const plan = new DeterministicFaultPlan([{ point, occurrence: 2 }]);
      expect(plan.hit(point)).toBeFalse();
      expect(plan.hit(point)).toBeTrue();
      expect(plan.hit(point)).toBeFalse();
    }
  });

  test("fault consumption survives deterministic crash and restore", () => {
    const plan = new DeterministicFaultPlan([
      { point: "lease_expiry", occurrence: 2 },
    ]);
    expect(plan.hit("lease_expiry")).toBeFalse();
    const snapshot = crashAndRestore(plan);
    expect(snapshot.consumed.lease_expiry).toBe(1);
    expect(plan.hit("lease_expiry")).toBeTrue();
  });

  test("controlled barrier releases current and future waiters without timers", async () => {
    const barrier = new ControlledBarrier();
    let passed = false;
    const waiting = barrier.wait().then(() => {
      passed = true;
    });
    await Promise.resolve();
    expect(passed).toBeFalse();
    barrier.release();
    await waiting;
    expect(passed).toBeTrue();
    await barrier.wait();
  });

  test("effect interleaving controller releases every effect and acknowledgement boundary independently", async () => {
    const controls = new EffectInterleavingController();
    const points = [
      "before_effect",
      "after_effect",
      "after_acknowledgement",
    ] as const;
    for (const point of points) {
      let passed = false;
      const waiting = controls.waitAt(point).then(() => {
        passed = true;
      });
      await Promise.resolve();
      expect(passed).toBeFalse();
      expect(controls.isReleased(point)).toBeFalse();
      controls.release(point);
      await waiting;
      expect(passed).toBeTrue();
      expect(controls.isReleased(point)).toBeTrue();
    }
  });

  test("delayed completion exposes deterministic resolve, late-ignore, and reject controls", async () => {
    const resolved = new DelayedCompletion<string>();
    expect(
      resolved.resolveIfCurrent("owner:1", "owner:2", "protected-value"),
    ).toBe("late_ignored");
    expect(resolved.settled).toBeFalse();
    expect(resolved.ignoredLateResults).toBe(1);
    expect(resolved.resolveIfCurrent("owner:2", "owner:2", "receipt-1")).toBe(
      "resolved",
    );
    expect(await resolved.promise).toBe("receipt-1");
    expect(resolved.settled).toBeTrue();
    expect(() => resolved.resolve("receipt-2")).toThrow("already settled");

    const rejected = new DelayedCompletion<never>();
    rejected.reject(new Error("disconnected"));
    expect(rejected.promise).rejects.toThrow("disconnected");
  });

  test("trace recorder preserves ordered immutable call/results and rejects protected fields", () => {
    const trace = new EffectTraceRecorder();
    trace.recordCall({
      contract: "sample",
      method: "increment",
      effectId: "effect-1",
      operationId: null,
      sourceSeq: null,
      version: 1,
    });
    trace.recordResult({
      contract: "sample",
      method: "increment",
      effectId: "effect-1",
      operationId: null,
      sourceSeq: null,
      version: 1,
      certainty: "applied",
      resultTag: "ok",
    });
    const inspected = trace.inspect();
    expect(inspected.map((entry) => entry.resultTag)).toEqual(["call", "ok"]);
    expect(Object.isFrozen(inspected)).toBeTrue();
    expect(Object.isFrozen(inspected[0])).toBeTrue();
    const restored = EffectTraceRecorder.fromSnapshot(trace.snapshot());
    expect(restored.inspect()).toEqual(inspected);
    expect(() =>
      trace.recordResult({
        contract: "sample",
        method: "increment",
        effectId: "effect-3",
        resultTag: "rejected",
        toolArguments: "protected",
      }),
    ).toThrow("Protected trace field rejected");
    expect(trace.inspect()).toHaveLength(2);
  });
});

interface SampleSnapshot {
  readonly value: number;
  readonly trace: ReturnType<EffectTraceRecorder["snapshot"]>;
}

class SampleCounterContract {
  value = 0;
  trace = new EffectTraceRecorder();

  constructor(private readonly context: ContractTestContext) {}

  increment(): void {
    if (this.context.faults.hit("before_effect"))
      throw new Error("before effect");
    this.value += 1;
    this.trace.append({
      contract: "sample-counter",
      method: "increment",
      effectId: this.context.ids.nextId(),
      operationId: null,
      sourceSeq: null,
      version: this.value,
      certainty: "applied",
      resultTag: "ok",
    });
  }

  snapshot(): SampleSnapshot {
    return { value: this.value, trace: this.trace.snapshot() };
  }

  restore(snapshot: SampleSnapshot): void {
    this.value = snapshot.value;
    this.trace = EffectTraceRecorder.fromSnapshot(snapshot.trace);
  }
}

function createSampleContext(
  faults: readonly PlannedFault[] = [],
): ContractTestContext {
  return {
    clock: new ManualEffectClock("2026-02-03T04:05:06.000Z"),
    ids: new SequenceEffectIdSource("sample", 2),
    faults: new DeterministicFaultPlan(faults),
  };
}

describe("generic parameterised contract-suite lifecycle", () => {
  test("runs a tiny test-local contract with fresh state and crash restore", async () => {
    const factory: ContractSubjectFactory<SampleCounterContract> = {
      name: "sample-counter",
      create: (context) => new SampleCounterContract(context),
      crashAndRestore: (subject, context) => {
        const snapshot = structuredClone(subject.snapshot());
        const restored = new SampleCounterContract(context);
        restored.restore(snapshot);
        return { subject: restored, context };
      },
      inspectTrace: (subject) => subject.trace.inspect(),
    };
    const cases: readonly ParameterisedContractCase<SampleCounterContract>[] = [
      {
        name: "ordinary effect",
        run: ({ subject }) => {
          subject.increment();
          expect(subject.value).toBe(1);
        },
      },
      {
        name: "crash restore",
        run: async (fixture) => {
          const originalContext = fixture.context;
          fixture.subject.increment();
          expect(fixture.context.faults.snapshot().consumed.before_effect).toBe(
            1,
          );
          const restored = await fixture.crashAndRestore();
          expect(fixture.context).toBe(originalContext);
          expect(restored.value).toBe(1);
          restored.increment();
          expect(restored.value).toBe(2);
          expect(fixture.context.faults.snapshot().consumed.before_effect).toBe(
            2,
          );
          expect(fixture.inspectTrace().map((entry) => entry.effectId)).toEqual(
            ["sample-01", "sample-02"],
          );
        },
      },
    ];

    const results = await runParameterisedContractSuite(
      factory,
      cases,
      createSampleContext,
    );
    expect(results.map((result) => result.caseName)).toEqual([
      "ordinary effect",
      "crash restore",
    ]);
    expect(results[0].trace).toHaveLength(1);
    expect(results[1].trace).toHaveLength(2);
    expect(Object.isFrozen(results)).toBeTrue();
    expect(Object.isFrozen(results[1])).toBeTrue();
    expect(Object.isFrozen(results[1].trace)).toBeTrue();
    expect(Object.isFrozen(results[1].trace[0])).toBeTrue();
    expect(() =>
      (results[1].trace as unknown as NormalisedEffectTrace[]).push(
        results[1].trace[0],
      ),
    ).toThrow();
  });

  test("restore disposal is explicit and the latest subject is always disposed once", async () => {
    const run = async (disposePrevious: boolean | undefined) => {
      let id = 0;
      const disposed: number[] = [];
      const factory: ContractSubjectFactory<{ id: number }> = {
        name: disposePrevious ? "explicit-disposal" : "default-disposal",
        create: () => ({ id: ++id }),
        crashAndRestore: () => ({
          subject: { id: ++id },
          context: createSampleContext(),
          disposePrevious,
        }),
        inspectTrace: () => [],
      };
      await runParameterisedContractSuite(
        factory,
        [{ name: "restore", run: (fixture) => fixture.crashAndRestore() }],
        createSampleContext,
        (subject) => void disposed.push(subject.id),
      );
      return disposed;
    };

    expect(await run(undefined)).toEqual([2]);
    expect(await run(false)).toEqual([2]);
    expect(await run(true)).toEqual([1, 2]);

    const disposed: number[] = [];
    expect(
      runParameterisedContractSuite(
        {
          name: "case-failure",
          create: () => ({ id: 1 }),
          crashAndRestore: (subject, context) => ({ subject, context }),
          inspectTrace: () => [],
        },
        [
          {
            name: "fail",
            run: () => {
              throw new Error("case failure");
            },
          },
        ],
        createSampleContext,
        (subject) => void disposed.push(subject.id),
      ),
    ).rejects.toThrow("case failure");
    expect(disposed).toEqual([1]);
  });

  test("restore and old-subject disposal failures still dispose the active subject", async () => {
    const restoreDisposed: number[] = [];
    expect(
      runParameterisedContractSuite(
        {
          name: "restore-failure",
          create: () => ({ id: 1 }),
          crashAndRestore: () => {
            throw new Error("restore failure");
          },
          inspectTrace: () => [],
        },
        [
          {
            name: "restore-fails",
            run: (fixture) => fixture.crashAndRestore(),
          },
        ],
        createSampleContext,
        (subject) => void restoreDisposed.push(subject.id),
      ),
    ).rejects.toThrow("restore failure");
    expect(restoreDisposed).toEqual([1]);

    const disposalAttempts: number[] = [];
    expect(
      runParameterisedContractSuite(
        {
          name: "old-dispose-failure",
          create: () => ({ id: 1 }),
          crashAndRestore: () => ({
            subject: { id: 2 },
            context: createSampleContext(),
            disposePrevious: true,
          }),
          inspectTrace: () => [],
        },
        [
          {
            name: "dispose-old-fails",
            run: (fixture) => fixture.crashAndRestore(),
          },
        ],
        createSampleContext,
        (subject) => {
          disposalAttempts.push(subject.id);
          if (subject.id === 1) throw new Error("old dispose failure");
        },
      ),
    ).rejects.toThrow("old dispose failure");
    expect(disposalAttempts).toEqual([1, 2]);
  });

  test("the first operational failure takes precedence over final disposal failure", async () => {
    const restoreAttempts: number[] = [];
    expect(
      runParameterisedContractSuite(
        {
          name: "restore-and-final-failure",
          create: () => ({ id: 1 }),
          crashAndRestore: () => {
            throw new Error("restore failure");
          },
          inspectTrace: () => [],
        },
        [{ name: "restore", run: (fixture) => fixture.crashAndRestore() }],
        createSampleContext,
        (subject) => {
          restoreAttempts.push(subject.id);
          throw new Error("final dispose failure");
        },
      ),
    ).rejects.toThrow("restore failure");
    expect(restoreAttempts).toEqual([1]);

    const caseAttempts: number[] = [];
    expect(
      runParameterisedContractSuite(
        {
          name: "case-and-final-failure",
          create: () => ({ id: 1 }),
          crashAndRestore: (subject, context) => ({ subject, context }),
          inspectTrace: () => [],
        },
        [
          {
            name: "case",
            run: () => {
              throw new Error("case failure");
            },
          },
        ],
        createSampleContext,
        (subject) => {
          caseAttempts.push(subject.id);
          throw new Error("final dispose failure");
        },
      ),
    ).rejects.toThrow("case failure");
    expect(caseAttempts).toEqual([1]);

    const oldAttempts: number[] = [];
    expect(
      runParameterisedContractSuite(
        {
          name: "old-and-final-disposal-failure",
          create: () => ({ id: 1 }),
          crashAndRestore: () => ({
            subject: { id: 2 },
            context: createSampleContext(),
            disposePrevious: true,
          }),
          inspectTrace: () => [],
        },
        [{ name: "old", run: (fixture) => fixture.crashAndRestore() }],
        createSampleContext,
        (subject) => {
          oldAttempts.push(subject.id);
          throw new Error(
            subject.id === 1 ? "old dispose failure" : "final dispose failure",
          );
        },
      ),
    ).rejects.toThrow("old dispose failure");
    expect(oldAttempts).toEqual([1, 2]);

    expect(
      runParameterisedContractSuite(
        {
          name: "final-disposal-failure",
          create: () => ({ id: 1 }),
          crashAndRestore: (subject, context) => ({ subject, context }),
          inspectTrace: () => [],
        },
        [{ name: "pass", run: () => undefined }],
        createSampleContext,
        () => {
          throw new Error("final dispose failure");
        },
      ),
    ).rejects.toThrow("final dispose failure");
  });

  test("rejects duplicate case names before creating a subject", async () => {
    let createCount = 0;
    const factory: ContractSubjectFactory<SampleCounterContract> = {
      name: "sample-counter",
      create: (context) => {
        createCount += 1;
        return new SampleCounterContract(context);
      },
      crashAndRestore: (subject, context) => ({ subject, context }),
      inspectTrace: (subject) => subject.trace.inspect(),
    };
    const duplicateCases: readonly ParameterisedContractCase<SampleCounterContract>[] =
      [
        { name: "duplicate", run: () => undefined },
        { name: "duplicate", run: () => undefined },
      ];
    expect(
      runParameterisedContractSuite(
        factory,
        duplicateCases,
        createSampleContext,
      ),
    ).rejects.toThrow("non-empty and unique");
    expect(createCount).toBe(0);
  });
});

describe("in-memory payload resolver", () => {
  test("accepts equal registration and rejects conflicting immutable references", () => {
    const resolver = new InMemoryEffectPayloadResolver();
    const first = resolver.putText(
      "payload:immutable",
      "same bytes",
      "text/plain",
    );
    const equal = resolver.putText(
      "payload:immutable",
      "same bytes",
      "text/plain",
    );
    expect(equal.sha256).toBe(first.sha256);
    expect(() =>
      resolver.putText("payload:immutable", "changed bytes", "text/plain"),
    ).toThrow("immutable");
    expect(() =>
      resolver.putText("payload:immutable", "same bytes", "application/json"),
    ).toThrow("immutable");

    resolver.makeTemporarilyUnavailable("payload:immutable");
    expect(resolver.peek("payload:immutable")).toBeNull();
    expect(() =>
      resolver.putText(
        "payload:immutable",
        "changed while unavailable",
        "text/plain",
      ),
    ).toThrow("immutable");
    const restored = resolver.putText(
      "payload:immutable",
      "same bytes",
      "text/plain",
    );
    expect(restored.sha256).toBe(first.sha256);
    expect(
      new TextDecoder().decode(resolver.peek("payload:immutable")?.bytes),
    ).toBe("same bytes");
  });
});

describe("EF-S05 fake implementation independence", () => {
  test("fake normalizer uses a distinct reader-combinator architecture", () => {
    const adapter = readFileSync(
      join(
        import.meta.dir,
        "../../src/service-effects/current-piclaw/service-outbox-request-normalizer.ts",
      ),
      "utf8",
    );
    const fake = readFileSync(
      join(
        import.meta.dir,
        "../../src/service-effects/testing/fakes/fake-service-outbox-request-normalizer.ts",
      ),
      "utf8",
    );
    const adapterStore = readFileSync(
      join(
        import.meta.dir,
        "../../src/service-effects/current-piclaw/service-outbox-store.ts",
      ),
      "utf8",
    );
    const fakeStore = readFileSync(
      join(
        import.meta.dir,
        "../../src/service-effects/testing/fakes/fake-service-outbox-store.ts",
      ),
      "utf8",
    );
    for (const source of [fake, fakeStore]) {
      expect(source).not.toContain("current-piclaw");
      expect(source).not.toContain("service-outbox-schema");
      expect(source).not.toContain("bun:sqlite");
    }
    expect(fake).not.toContain("service-outbox-request-normalizer");
    expect(fake).toContain("type Reader<T>");
    expect(fake).toContain("const parsers:");
    expect(adapter).not.toContain("type Reader<T>");
    expect(adapter).not.toContain("const parsers:");
    expect(fakeStore).toContain("#state: State");
    expect(fakeStore).toContain("records: Record<string, OutboxRecord>");
    expect(fakeStore).not.toContain("database.query");
    expect(fakeStore).not.toMatch(
      /\b(?:SELECT|INSERT|UPDATE|DELETE)\s+(?:FROM|INTO|service_effect)/,
    );
    expect(adapterStore).toContain("this.database");
    expect(adapterStore).toContain("SELECT * FROM");
  });
});

describe("typed effector case catalogue", () => {
  test("EF-S01 suite maps required cases and labels extras supplementary", () => {
    const ids = SERVICE_WORK_STORE_CONTRACT_CASE_NAMES.map(
      (name) => name.split(" ", 1)[0],
    );
    const catalogue = EFFECTOR_CASE_CATALOGUE.find(
      (entry) => entry.contractId === "EF-S01",
    );
    expect(catalogue).toBeDefined();
    expect(ids.filter((id) => /^EF-S01-C\d+$/.test(id))).toEqual(
      catalogue?.requiredCases.map((entry) => entry.caseId),
    );
    expect(ids.filter((id) => id === "EF-S01-R01")).toEqual(["EF-S01-R01"]);
    expect(
      ids.every((id) => /^EF-S01-(?:C(?:10|[1-9])|R01|S\d{2})$/.test(id)),
    ).toBeTrue();
  });

  test("EF-S02 suite maps exact C1-C9 and R01 with labelled supplements", () => {
    const ids = TERMINAL_SETTLEMENT_CONTRACT_CASE_NAMES.map(
      (name) => name.split(" ", 1)[0],
    );
    const catalogue = EFFECTOR_CASE_CATALOGUE.find(
      (entry) => entry.contractId === "EF-S02",
    );
    expect(catalogue).toBeDefined();
    expect(ids.filter((id) => /^EF-S02-C\d+$/.test(id))).toEqual(
      catalogue?.requiredCases.map((entry) => entry.caseId),
    );
    expect(ids.filter((id) => id === "EF-S02-R01")).toEqual(["EF-S02-R01"]);
    expect(TERMINAL_SETTLEMENT_CONTRACT_CASE_NAMES).toContain(
      `${catalogue?.crashOracle.oracleId} ${catalogue?.crashOracle.description}`,
    );
    expect(
      ids.every((id) => /^EF-S02-(?:C[1-9]|R01|S\d{2})$/.test(id)),
    ).toBeTrue();
    expect(ids.filter((id) => /^EF-S02-S\d{2}$/.test(id)).sort()).toEqual(
      Array.from({ length: 13 }, (_, index) =>
        `EF-S02-S${String(index + 1).padStart(2, "0")}`,
      ),
    );
    for (const required of catalogue?.requiredCases ?? []) {
      expect(TERMINAL_SETTLEMENT_CONTRACT_CASE_NAMES).toContain(
        `${required.caseId} ${required.description}`,
      );
    }
  });

  test("EF-S05 suite maps exact C1-C8 and R01 with labelled supplements", () => {
    const ids = SERVICE_OUTBOX_STORE_CONTRACT_CASE_NAMES.map(
      (name) => name.split(" ", 1)[0],
    );
    const catalogue = EFFECTOR_CASE_CATALOGUE.find(
      (entry) => entry.contractId === "EF-S05",
    );
    expect(catalogue).toBeDefined();
    expect(ids.filter((id) => /^EF-S05-C\d+$/.test(id))).toEqual(
      catalogue?.requiredCases.map((entry) => entry.caseId),
    );
    expect(ids.filter((id) => id === "EF-S05-R01")).toEqual(["EF-S05-R01"]);
    expect(
      ids.every((id) => /^EF-S05-(?:C[1-8]|R01|S\d{2})$/.test(id)),
    ).toBeTrue();
  });

  test("covers EF-S01 through EF-S08 and EF-H01 exactly once", () => {
    expect(() => assertCompleteEffectorCaseCatalogue()).not.toThrow();
    expect(EFFECTOR_CASE_CATALOGUE.map((entry) => entry.contractId)).toEqual(
      EFFECTOR_CONTRACT_IDS,
    );
  });

  test("maps every entry to unique named cases, prerequisites, faults, and one crash oracle", () => {
    const caseIds = new Set<string>();
    const oracleIds = new Set<string>();
    for (const entry of EFFECTOR_CASE_CATALOGUE) {
      expect(entry.suiteEntryPoint).toMatch(/^define[A-Z].+Contract$/);
      expect(entry.requiredCases.length).toBeGreaterThanOrEqual(6);
      expect(entry.faultPoints.length).toBeGreaterThan(0);
      expect(entry.crashOracle.description.length).toBeGreaterThan(20);
      expect(entry.crashOracle.oracleId).toBe(`${entry.contractId}-R01`);
      expect(oracleIds.has(entry.crashOracle.oracleId)).toBeFalse();
      oracleIds.add(entry.crashOracle.oracleId);
      expect(entry.futureIssue).toBeGreaterThanOrEqual(972);
      for (const requiredCase of entry.requiredCases) {
        expect(requiredCase.caseId).toStartWith(`${entry.contractId}-C`);
        expect(requiredCase.description.length).toBeGreaterThan(10);
        expect(caseIds.has(requiredCase.caseId)).toBeFalse();
        caseIds.add(requiredCase.caseId);
      }
      for (const prerequisite of entry.prerequisites) {
        expect(EFFECTOR_CONTRACT_IDS).toContain(prerequisite);
      }
    }
    expect(oracleIds.size).toBe(EFFECTOR_CONTRACT_IDS.length);
  });

  test("catalogue collectively maps every standard fault point", () => {
    const mapped = new Set(
      EFFECTOR_CASE_CATALOGUE.flatMap((entry) => entry.faultPoints),
    );
    expect([...mapped].sort()).toEqual([...STANDARD_FAULT_POINTS].sort());
  });

  test("rejects duplicate catalogue entries, case IDs, and crash oracles", () => {
    const first = EFFECTOR_CASE_CATALOGUE[0];
    expect(() =>
      assertCompleteEffectorCaseCatalogue([...EFFECTOR_CASE_CATALOGUE, first]),
    ).toThrow("exactly once");
    expect(() =>
      assertCompleteEffectorCaseCatalogue([
        {
          ...first,
          requiredCases: [first.requiredCases[0], first.requiredCases[0]],
        },
        ...EFFECTOR_CASE_CATALOGUE.slice(1),
      ]),
    ).toThrow("misplaced or duplicated");
    expect(() =>
      assertCompleteEffectorCaseCatalogue([
        first,
        { ...EFFECTOR_CASE_CATALOGUE[1], crashOracle: first.crashOracle },
        ...EFFECTOR_CASE_CATALOGUE.slice(2),
      ]),
    ).toThrow("misplaced or duplicated");
  });

  test("all shared links resolve through a closed registry and are unique per entry", () => {
    const registered = new Set(
      SHARED_EFFECTOR_CASE_CATALOGUE.map((entry) => entry.caseId),
    );
    for (const entry of EFFECTOR_CASE_CATALOGUE) {
      expect(new Set(entry.sharedCaseLinks).size).toBe(
        entry.sharedCaseLinks.length,
      );
      for (const link of entry.sharedCaseLinks)
        expect(registered.has(link)).toBeTrue();
    }
  });

  test("rejects unknown or duplicate shared links and duplicate registry IDs", () => {
    const first = EFFECTOR_CASE_CATALOGUE[0];
    const unknownLink = "shared:unknown" as SharedEffectorCaseId;
    expect(() =>
      assertCompleteEffectorCaseCatalogue([
        { ...first, sharedCaseLinks: [...first.sharedCaseLinks, unknownLink] },
        ...EFFECTOR_CASE_CATALOGUE.slice(1),
      ]),
    ).toThrow("link is unknown");
    expect(() =>
      assertCompleteEffectorCaseCatalogue([
        {
          ...first,
          sharedCaseLinks: [...first.sharedCaseLinks, first.sharedCaseLinks[0]],
        },
        ...EFFECTOR_CASE_CATALOGUE.slice(1),
      ]),
    ).toThrow("link is duplicated");
    expect(() =>
      assertCompleteEffectorCaseCatalogue(EFFECTOR_CASE_CATALOGUE, [
        ...SHARED_EFFECTOR_CASE_CATALOGUE,
        SHARED_EFFECTOR_CASE_CATALOGUE[0],
      ] as readonly SharedEffectorCase[]),
    ).toThrow("case is duplicated");
  });

  test("catalogue has stable semantic content without protected payloads", () => {
    const digest = hashCanonicalRequest(
      EFFECTOR_CASE_CATALOGUE.map((entry) => ({
        contractId: entry.contractId,
        futureIssue: entry.futureIssue,
        suiteEntryPoint: entry.suiteEntryPoint,
        requiredCases: entry.requiredCases,
        faultPoints: entry.faultPoints,
        crashOracle: entry.crashOracle,
      })),
    );
    expect(digest).toMatch(/^[a-f0-9]{64}$/);
    expect(JSON.stringify(EFFECTOR_CASE_CATALOGUE)).not.toMatch(
      /message body|media bytes|tool arguments|tool results|secret value/i,
    );
  });
});
