import "../helpers.js";

import { describe, expect, test } from "bun:test";
import { Type } from "typebox";
import { fauxAssistantMessage, fauxToolCall } from "@earendil-works/pi-ai";
import type { AgentHarnessTool, AgentLane, OperationResultRecord } from "@earendil-works/pi-agent-core";
import { BACKGROUND_CONTEXT } from "@earendil-works/pi-agent-core/harness/context";
import { reduceLaneSnapshot } from "@earendil-works/pi-agent-core/harness/runtime/reducer";

import {
  createSelectedHarnessFixture,
  type SelectedHarnessFixture,
} from "./fixtures/earendil-harness-direct-probe.js";
import {
  createDeterministicGate,
  DeterministicHarnessEventLog,
} from "./fixtures/earendil-harness-deterministic-controls.js";

const ctx = BACKGROUND_CONTEXT;
const RETRY_OPERATION = "01950000-0000-7000-8000-000000000201";

async function laneSnapshot(lane: AgentLane) {
  const watch = await lane.watch(ctx);
  try { return watch.snapshot; } finally { watch.unsubscribe(); }
}

async function closeFixture(fixture: SelectedHarnessFixture): Promise<void> {
  await fixture.harness.close(ctx);
  await fixture.repo.close(ctx);
}

function textEntries(snapshot: Awaited<ReturnType<typeof laneSnapshot>>, role: "assistant" | "user") {
  return snapshot.transcript.filter((entry) => entry.type === "message" && entry.message.role === role);
}

function compactionEntries(snapshot: Awaited<ReturnType<typeof laneSnapshot>>) {
  return snapshot.transcript.filter((entry) => entry.type === "compaction");
}

function settled(value: unknown): OperationResultRecord {
  if (!value || typeof value !== "object" || !("kind" in value) || value.kind !== "settled" || !("outcome" in value)) {
    throw new Error("Expected a settled Harness drive result.");
  }
  return value.outcome as OperationResultRecord;
}

describe("selected 0.85.1 broader public Harness semantics (inactive evidence only)", () => {
  test("HC-010 manual compaction publishes one structural result and ordered events", async () => {
    const fixture = await createSelectedHarnessFixture({
      responses: [fauxAssistantMessage("ordinary response"), fauxAssistantMessage("summary text")],
      compaction: { enabled: true, reserveTokens: 1, keepRecentTokens: 1 },
    });
    const log = new DeterministicHarnessEventLog();
    const unsubscribeStart = fixture.harness.events.on("compaction_start", log.listener);
    const unsubscribeEnd = fixture.harness.events.on("compaction_end", log.listener);
    try {
      const lane = await fixture.harness.lane("main", ctx);
      expect((await lane.prompt("large input ".repeat(100), undefined, ctx)).ok).toBeTrue();
      const compacted = await lane.compact({ customInstructions: "preserve exact identifiers" }, ctx);
      expect(compacted.ok).toBeTrue();
      if (!compacted.ok) throw compacted.error;
      expect(compacted.value.compaction.kind).toBe("compaction");
      expect(compacted.value.compaction.status).toBe("completed");
      const snapshot = await laneSnapshot(lane);
      expect(snapshot.operation).toBeNull();
      expect(snapshot.lastResult).toEqual(compacted.value.compaction);
      expect(await lane.getResult(compacted.value.compaction.operationId, ctx)).toEqual(compacted.value.compaction);
      expect(compactionEntries(snapshot)).toHaveLength(1);
      // The summarized assistant entry is represented by the compaction entry,
      // while its retained tail remains explicit on that entry.
      expect(textEntries(snapshot, "assistant")).toHaveLength(0);
      expect(log.types()).toEqual(["compaction_start", "compaction_end"]);
      expect(fixture.faux.state.callCount).toBe(2);
    } finally {
      unsubscribeStart(); unsubscribeEnd();
      await closeFixture(fixture);
    }
  });

  test("HC-010 unsummarized navigation publishes one result, target tip and structural events", async () => {
    const fixture = await createSelectedHarnessFixture({ responses: [fauxAssistantMessage("first"), fauxAssistantMessage("second")] });
    try {
      const lane = await fixture.harness.lane("main", ctx);
      expect((await lane.prompt("one", undefined, ctx)).ok).toBeTrue();
      expect((await lane.prompt("two", undefined, ctx)).ok).toBeTrue();
      const before = await laneSnapshot(lane);
      const firstUser = before.transcript.find((entry) => entry.type === "message" && entry.message.role === "user");
      expect(firstUser).toBeDefined();
      if (!firstUser) throw new Error("Expected first user entry.");
      const events = new DeterministicHarnessEventLog();
      const unsubscribeStart = fixture.harness.events.on("navigation_start", events.listener);
      const unsubscribeEnd = fixture.harness.events.on("navigation_end", events.listener);
      try {
        const navigated = await lane.navigateTree(firstUser.id, { summarize: false, label: "checkpoint" }, ctx);
        expect(navigated.ok).toBeTrue();
        if (!navigated.ok) throw navigated.error;
        expect(navigated.value.navigation).toMatchObject({ kind: "navigation", status: "completed", tipId: firstUser.id });
        const after = await laneSnapshot(lane);
        expect(after.tipId).toBe(firstUser.id);
        expect(after.lastResult).toEqual(navigated.value.navigation);
        expect(events.types()).toEqual(["navigation_start", "navigation_end"]);
      } finally { unsubscribeStart(); unsubscribeEnd(); }
    } finally { await closeFixture(fixture); }
  });

  test("HC-011 retry wait survives reattachment with captured policy", async () => {
    const fixture = await createSelectedHarnessFixture({
      responses: [fauxAssistantMessage([], { stopReason: "error", errorMessage: "network timeout" })],
      // No public clock injection exists. Keep this deadline longer than the
      // test runner timeout so reattachment cannot validly advance it.
      retry: { enabled: true, maxRetries: 1, baseDelayMs: 3_600_000 },
    });
    const scheduled = new DeterministicHarnessEventLog();
    const unsubscribe = fixture.harness.events.on("retry_scheduled", scheduled.listener);
    const lane = await fixture.harness.lane("main", ctx);
    const metadata = fixture.session.metadata;
    try {
      expect((await lane.accept({ kind: "prompt", operationId: RETRY_OPERATION, prompt: "retry" }, ctx)).ok).toBeTrue();
      const waiting = await lane.drive({ operationId: RETRY_OPERATION, waitForRetry: false }, ctx);
      expect(waiting.ok).toBeTrue();
      if (!waiting.ok || waiting.value.kind !== "waiting") throw new Error("Expected retry waiting.");
      expect(waiting.value).toMatchObject({ operationId: RETRY_OPERATION, reason: "retry" });
      const originalNotBefore = waiting.value.notBefore;
      expect((await lane.inspectExecution(ctx)).current?.id).toBe(RETRY_OPERATION);
      expect(fixture.faux.state.callCount).toBe(1);
      expect(scheduled.types()).toEqual(["retry_scheduled"]);
      unsubscribe();
      await fixture.harness.close(ctx);

      const reopenedSession = await fixture.repo.open(metadata, ctx);
      const restored = await createSelectedHarnessFixture({
        repo: fixture.repo,
        session: reopenedSession,
        faux: fixture.faux,
        // Changed process defaults must not replace the captured operation policy.
        retry: { enabled: false, maxRetries: 0, baseDelayMs: 0 },
      });
      try {
        expect(restored.open).toEqual([expect.objectContaining({ operationId: RETRY_OPERATION, kind: "run" })]);
        const stillWaiting = await (await restored.harness.lane("main", ctx)).drive({ operationId: RETRY_OPERATION, waitForRetry: false }, ctx);
        expect(stillWaiting.ok).toBeTrue();
        if (!stillWaiting.ok || stillWaiting.value.kind !== "waiting") throw new Error("Expected restored retry waiting.");
        expect(stillWaiting.value).toMatchObject({ operationId: RETRY_OPERATION, reason: "retry", notBefore: originalNotBefore });
        expect(fixture.faux.state.callCount).toBe(1);
      } finally { await restored.harness.close(ctx); }
    } finally {
      unsubscribe();
      await fixture.harness.close(ctx);
      await fixture.repo.close(ctx);
    }
  });

  test("HC-011 zero-delay retry advances once and settles", async () => {
    const fixture = await createSelectedHarnessFixture({
      responses: [
        fauxAssistantMessage([], { stopReason: "error", errorMessage: "network timeout" }),
        fauxAssistantMessage("retried once"),
      ],
      retry: { enabled: true, maxRetries: 1, baseDelayMs: 0 },
    });
    try {
      const lane = await fixture.harness.lane("main", ctx);
      const result = await lane.prompt("retry now", undefined, ctx);
      expect(result.ok).toBeTrue();
      if (!result.ok || result.value.status === "suspended") throw new Error("Expected terminal retry result.");
      expect(result.value.status).toBe("completed");
      expect(fixture.faux.state.callCount).toBe(2);
    } finally { await closeFixture(fixture); }
  });

  test("HC-012/HC-020 deferred suspension preserves exact identity and one poll per resume", async () => {
    const fixture = await createSelectedHarnessFixture({
      responses: [fauxAssistantMessage("deferred completion")],
      providerOptions: { deferred: { pendingFetches: 1, pollAfterMs: 1 } },
      streamOptions: { deferred: true },
    });
    const lane = await fixture.harness.lane("main", ctx);
    const metadata = fixture.session.metadata;
    try {
      const prompt = await lane.prompt("defer", undefined, ctx);
      expect(prompt.ok).toBeTrue();
      if (!prompt.ok || prompt.value.status !== "suspended") throw new Error("Expected suspended run.");
      const operationId = prompt.value.operationId;
      const deferredHandle = structuredClone(prompt.value.deferred);
      expect(fixture.faux.state).toMatchObject({ callCount: 1, deferredFetchCount: 0 });
      await fixture.harness.close(ctx);

      const firstSession = await fixture.repo.open(metadata, ctx);
      const first = await createSelectedHarnessFixture({ repo: fixture.repo, session: firstSession, faux: fixture.faux });
      try {
        expect(first.open).toEqual([expect.objectContaining({ operationId, kind: "run" })]);
        const resumed = await (await first.harness.lane("main", ctx)).resume(ctx);
        expect(resumed.ok).toBeTrue();
        if (!resumed.ok || resumed.value.status !== "suspended") throw new Error("Expected repeated suspension.");
        expect(resumed.value.operationId).toBe(operationId);
        expect(resumed.value.deferred).toEqual(deferredHandle);
        const firstSnapshot = await laneSnapshot(await first.harness.lane("main", ctx));
        expect(firstSnapshot.operation?.deferred?.handle).toEqual(deferredHandle);
        expect(fixture.faux.state).toMatchObject({ callCount: 1, deferredFetchCount: 1 });
      } finally { await first.harness.close(ctx); }

      const secondSession = await fixture.repo.open(metadata, ctx);
      const second = await createSelectedHarnessFixture({ repo: fixture.repo, session: secondSession, faux: fixture.faux });
      try {
        expect(second.open).toEqual([expect.objectContaining({ operationId, kind: "run" })]);
        const secondLane = await second.harness.lane("main", ctx);
        const secondSnapshot = await laneSnapshot(secondLane);
        expect(secondSnapshot.operation?.deferred?.handle).toEqual(deferredHandle);
        const resumed = await secondLane.resume(ctx);
        expect(resumed.ok).toBeTrue();
        if (!resumed.ok || resumed.value.status === "suspended") throw new Error("Expected terminal record.");
        expect(resumed.value).toMatchObject({ operationId, status: "completed" });
        expect(fixture.faux.state).toMatchObject({ callCount: 1, deferredFetchCount: 2, cancelledDeferred: [] });
        expect(await (await second.harness.lane("main", ctx)).getResult(operationId, ctx)).toEqual(resumed.value);
      } finally { await second.harness.close(ctx); }
    } finally {
      await fixture.harness.close(ctx);
      await fixture.repo.close(ctx);
    }
  });

  test("HC-020 deferred abort cancels the exact provider handle and settles once", async () => {
    const fixture = await createSelectedHarnessFixture({
      responses: [fauxAssistantMessage("never completed")],
      providerOptions: { deferred: { pendingFetches: 2, pollAfterMs: 1 } },
      streamOptions: { deferred: true },
    });
    try {
      const lane = await fixture.harness.lane("main", ctx);
      const prompt = await lane.prompt("cancel deferred", undefined, ctx);
      expect(prompt.ok).toBeTrue();
      if (!prompt.ok || !("deferred" in prompt.value)) throw new Error("Expected deferred handle.");
      const operationId = prompt.value.operationId;
      const handle = prompt.value.deferred;
      const aborted = await lane.abort(ctx);
      expect(aborted.ok).toBeTrue();
      if (!aborted.ok) throw aborted.error;
      expect(aborted.value.operationId).toBe(operationId);
      expect(fixture.faux.state.cancelledDeferred).toEqual([handle]);
      expect(await lane.getResult(operationId, ctx)).toMatchObject({ operationId, status: "aborted" });
      expect((await laneSnapshot(lane)).operation).toBeNull();
    } finally { await closeFixture(fixture); }
  });

  test("HC-012 unavailable restored identity fails in band without provider execution", async () => {
    const fixture = await createSelectedHarnessFixture();
    try {
      const lane = await fixture.harness.lane("main", ctx);
      await lane.setModel({ provider: "missing", modelId: "missing" }, ctx);
      const result = await lane.prompt("missing", undefined, ctx);
      expect(result.ok).toBeTrue();
      if (!result.ok || result.value.status === "suspended") throw new Error("Expected terminal failure record.");
      expect(result.value).toMatchObject({ kind: "run", status: "failed", error: { code: "model_unavailable" } });
      expect(fixture.faux.state.callCount).toBe(0);
      expect((await laneSnapshot(lane)).operation).toBeNull();
    } finally { await closeFixture(fixture); }
  });

  test("HC-013 accepted operation restores by public inventory without duplicate provider effect", async () => {
    const fixture = await createSelectedHarnessFixture({ responses: [fauxAssistantMessage("restored once")] });
    const lane = await fixture.harness.lane("main", ctx);
    const metadata = fixture.session.metadata;
    const operationId = "01950000-0000-7000-8000-000000000213";
    try {
      expect((await lane.accept({ kind: "prompt", operationId, prompt: "restore" }, ctx)).ok).toBeTrue();
      expect(fixture.faux.state.callCount).toBe(0);
      await fixture.harness.close(ctx);
      const session = await fixture.repo.open(metadata, ctx);
      const restored = await createSelectedHarnessFixture({ repo: fixture.repo, session, faux: fixture.faux });
      try {
        expect(restored.open).toEqual([expect.objectContaining({ operationId, kind: "run", lane: "main" })]);
        const restoredLane = await restored.harness.lane("main", ctx);
        expect((await restoredLane.inspectExecution(ctx)).current?.id).toBe(operationId);
        const result = await restoredLane.drive({ operationId }, ctx);
        expect(result.ok).toBeTrue();
        if (!result.ok) throw result.error;
        expect(settled(result.value)).toMatchObject({ operationId, status: "completed" });
        expect(fixture.faux.state.callCount).toBe(1);
        const again = await restoredLane.drive({ operationId }, ctx);
        expect(again.ok).toBeTrue();
        expect(fixture.faux.state.callCount).toBe(1);
      } finally { await restored.harness.close(ctx); }
    } finally {
      await fixture.harness.close(ctx);
      await fixture.repo.close(ctx);
    }
  });

  test("HC-021 abort-first prevents provider admission", async () => {
    const fixture = await createSelectedHarnessFixture({ responses: [fauxAssistantMessage("must not run")] });
    try {
      const lane = await fixture.harness.lane("main", ctx);
      const operationId = "01950000-0000-7000-8000-000000000221";
      expect((await lane.accept({ kind: "prompt", operationId, prompt: "abort first" }, ctx)).ok).toBeTrue();
      const aborted = await lane.requestAbort(operationId, ctx);
      expect(aborted.ok).toBeTrue();
      const driven = await lane.drive({ operationId }, ctx);
      expect(driven.ok).toBeTrue();
      if (!driven.ok) throw driven.error;
      expect(settled(driven.value)).toMatchObject({ operationId, status: "aborted" });
      expect(fixture.faux.state.callCount).toBe(0);
    } finally { await closeFixture(fixture); }
  });

  test("HC-021 admission-first gives the running tool the operation abort signal", async () => {
    const started = createDeterministicGate();
    const release = createDeterministicGate();
    let signal: AbortSignal | undefined;
    let calls = 0;
    const tool: AgentHarnessTool = {
      name: "admission_probe",
      label: "Admission probe",
      description: "Observe selected-release cancellation admission",
      parameters: Type.Object({}),
      replay: "never",
      async execute(_id, _params, _update, _toolContext, _invocation, context) {
        calls += 1;
        signal = context.abortSignal;
        started.release();
        await release.promise;
        return { content: [{ type: "text", text: "late" }], details: {} };
      },
    };
    const fixture = await createSelectedHarnessFixture({
      tools: [tool],
      responses: [fauxAssistantMessage(fauxToolCall("admission_probe", {}), { stopReason: "toolUse" })],
    });
    try {
      const lane = await fixture.harness.lane("main", ctx);
      const operationId = "01950000-0000-7000-8000-000000000222";
      expect((await lane.accept({ kind: "prompt", operationId, prompt: "admit first" }, ctx)).ok).toBeTrue();
      const driving = lane.drive({ operationId }, ctx);
      await started.promise;
      expect(signal?.aborted).toBeFalse();
      expect((await lane.requestAbort(operationId, ctx)).ok).toBeTrue();
      expect(signal?.aborted).toBeTrue();
      release.release();
      const result = await driving;
      expect(result.ok).toBeTrue();
      if (!result.ok) throw result.error;
      expect(settled(result.value)).toMatchObject({ operationId, status: "aborted" });
      expect(calls).toBe(1);
    } finally {
      release.release();
      await closeFixture(fixture);
    }
  });

  test("HC-009 abort drains steer/follow-up and preserves next-run input", async () => {
    const fixture = await createSelectedHarnessFixture({ responses: [fauxAssistantMessage("must not run")] });
    try {
      const lane = await fixture.harness.lane("main", ctx);
      const operationId = "01950000-0000-7000-8000-000000000209";
      expect((await lane.accept({ kind: "prompt", operationId, prompt: "abort queues" }, ctx)).ok).toBeTrue();
      const steer = await lane.steer("steer", undefined, ctx);
      const followUp = await lane.followUp("follow", undefined, ctx);
      const nextRun = await lane.nextRun("next", undefined, ctx);
      expect(steer.ok && followUp.ok && nextRun.ok).toBeTrue();
      const aborted = await lane.requestAbort(operationId, ctx);
      expect(aborted.ok).toBeTrue();
      if (!aborted.ok) throw aborted.error;
      expect(aborted.value.steer).toHaveLength(1);
      expect(aborted.value.followUp).toHaveLength(1);
      const queued = await laneSnapshot(lane);
      expect(queued.queues.map((item) => item.kind)).toEqual(["nextRun"]);
      const driven = await lane.drive({ operationId }, ctx);
      expect(driven.ok).toBeTrue();
      if (!driven.ok) throw driven.error;
      expect(settled(driven.value).status).toBe("aborted");
      expect((await laneSnapshot(lane)).queues.map((item) => item.entryId)).toEqual([nextRun.ok ? nextRun.value.entryId : ""]);
      expect(fixture.faux.state.callCount).toBe(0);
    } finally { await closeFixture(fixture); }
  });

  test("HC-018 public reducer folds ordinary lane events to the resnapshot", async () => {
    const fixture = await createSelectedHarnessFixture({ responses: [fauxAssistantMessage("folded")] });
    try {
      const lane = await fixture.harness.lane("main", ctx);
      const watch = await lane.watch(ctx);
      const folded = structuredClone(watch.snapshot);
      const rebases: string[] = [];
      try {
        watch.start((event) => {
          if (reduceLaneSnapshot(folded, event) === "rebase") rebases.push(event.type);
        });
        expect((await lane.prompt("fold", undefined, ctx)).ok).toBeTrue();
        const fresh = await watch.resnapshot(ctx);
        expect(rebases).toEqual([]);
        expect(folded).toEqual(fresh);
      } finally { watch.unsubscribe(); }
    } finally { await closeFixture(fixture); }
  });

  test("HC-023 concurrent observers join one lane-owned Drive", async () => {
    const fixture = await createSelectedHarnessFixture({ responses: [fauxAssistantMessage("shared drive")] });
    try {
      const lane = await fixture.harness.lane("main", ctx);
      const operationId = "01950000-0000-7000-8000-000000000223";
      expect((await lane.accept({ kind: "prompt", operationId, prompt: "join" }, ctx)).ok).toBeTrue();
      const [first, second] = await Promise.all([
        lane.drive({ operationId }, ctx),
        lane.drive({ operationId }, ctx),
      ]);
      expect(first).toEqual(second);
      expect(first.ok).toBeTrue();
      expect(fixture.faux.state.callCount).toBe(1);
      expect((await laneSnapshot(lane)).operation).toBeNull();
    } finally { await closeFixture(fixture); }
  });
});
