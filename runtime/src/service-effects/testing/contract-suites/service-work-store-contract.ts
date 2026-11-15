import type {
  CanonicalJsonValue,
  EffectIdentity,
} from "../../contracts/common.js";
import { hashCanonicalRequest } from "../../contracts/common.js";
import type {
  AcceptCancellationRequest,
  AcceptSourceRequest,
  AppendOperationIntentRequest,
  BindHarnessRequest,
  ClaimNextSourceRequest,
  OperationSnapshot,
  RecordQueuedInputRequest,
  ServiceWorkStore,
} from "../../contracts/service-work-store.js";
import {
  runParameterisedContractSuite,
  type ContractSubjectFactory,
  type ContractTestContext,
  type ParameterisedContractCase,
} from "../contract-suite.js";

export interface ServiceWorkInspection {
  readonly sources: readonly {
    chatJid: string;
    sourceSeq: number;
    state: string;
  }[];
  readonly intents: readonly {
    operationId: string;
    intentId: string;
    payloadRef: string;
  }[];
  readonly queues: readonly {
    operationId: string;
    sourceSeq: number;
    state: string;
  }[];
  readonly wakes: readonly string[];
  readonly nextByChat: Readonly<Record<string, number>>;
}
export type ServiceWorkMutationMethod =
  | "acceptSource"
  | "claimNext"
  | "appendIntent"
  | "acceptCancellation"
  | "bindHarness"
  | "recordQueuedInput";
export interface ServiceWorkContractSubject {
  readonly store: ServiceWorkStore;
  inspect(): ServiceWorkInspection;
  planFault?(
    method: ServiceWorkMutationMethod,
    point: "before_effect" | "effect_then_lost_acknowledgement",
    occurrence: number,
  ): void;
  dispose?(): void | Promise<void>;
}

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}
function mutateAfterReturn<T extends object>(
  target: T,
  replacement: Partial<T>,
): void {
  for (const [key, value] of Object.entries(replacement)) {
    (target as Record<string, unknown>)[key] = value;
  }
}
const cases: readonly ParameterisedContractCase<ServiceWorkContractSubject>[] =
  [
    {
      name: "EF-S01-C1 concurrent acceptance produces consecutive source sequences",
      async run({ subject }) {
        const [a, b] = await Promise.all([
          subject.store.acceptSource(accept("a")),
          subject.store.acceptSource(accept("b")),
        ]);
        assert(a.ok && b.ok, "both acceptance calls must succeed");
        assert(
          [a.value.sourceSeq, b.value.sourceSeq].sort().join(",") === "1,2",
          "sequences must be consecutive",
        );
        assert(
          subject.inspect().nextByChat["chat-1"] === 3,
          "next-to-allocate must be three",
        );
      },
    },
    {
      name: "EF-S01-S07 every mutation consumes a closed request snapshot",
      async run({ subject }) {
        const acceptRequest = accept("snapshot-primary");
        const acceptPending = subject.store.acceptSource(acceptRequest);
        mutateAfterReturn(acceptRequest, {
          sourceId: "mutated-source",
          payloadRef: "mutated-payload",
          effect: {
            ...acceptRequest.effect,
            provenanceRef: "mutated-provenance",
          },
        });
        const accepted = await acceptPending;
        assert(
          accepted.ok && accepted.value.sourceId === "snapshot-primary",
          "accept snapshot",
        );

        const claimRequest = claim("snapshot-claim");
        const claimPending = subject.store.claimNext(claimRequest);
        mutateAfterReturn(claimRequest, {
          chatJid: "mutated-chat",
          newOperationId: "mutated-operation",
        });
        const claimed = await claimPending;
        assert(
          claimed.ok && claimed.value?.operation.operationId === "operation-1",
          "claim snapshot",
        );
        assert(claimed.value, "claim value");
        let operation = claimed.value.operation;

        const intentRequest = intent(operation, "snapshot-intent");
        const intentPending = subject.store.appendIntent(intentRequest);
        mutateAfterReturn(intentRequest, {
          intentId: "mutated-intent",
          payloadRef: "mutated-intent-payload",
        });
        const appended = await intentPending;
        assert(appended.ok, "intent snapshot");
        operation = appended.value;

        const bindRequest = binding(operation, "snapshot-bind");
        const bindPending = subject.store.bindHarness(bindRequest);
        mutateAfterReturn(bindRequest, {
          sessionId: "mutated-session",
          harnessOperationId: "mutated-harness",
        });
        const bound = await bindPending;
        assert(
          bound.ok && bound.value.harness?.sessionId === "session-1",
          "harness snapshot",
        );
        operation = bound.value;

        const targetRequest = accept("snapshot-target", {
          targetOperationId: operation.operationId,
        });
        const target = await subject.store.acceptSource(targetRequest);
        assert(target.ok, "target accepted");
        const queueRequest = queue(
          operation,
          target.value.sourceSeq,
          "snapshot-queue",
          "accepted",
        );
        const queuePending = subject.store.recordQueuedInput(queueRequest);
        mutateAfterReturn(queueRequest, {
          sourceSeq: target.value.sourceSeq + 100,
          state: "disposed",
        });
        const queued = await queuePending;
        assert(queued.ok, "queue snapshot");
        operation = queued.value;

        const cancellationSource = await subject.store.acceptSource(
          accept("snapshot-cancellation", {
            kind: "cancellation",
            targetOperationId: operation.operationId,
          }),
        );
        assert(cancellationSource.ok, "cancellation source accepted");
        const cancellationRequest = cancellation(
          operation,
          "snapshot-cancel",
          cancellationSource.value,
        );
        const cancellationPending =
          subject.store.acceptCancellation(cancellationRequest);
        mutateAfterReturn(cancellationRequest, {
          cause: "mutated-cause",
          sourceId: "mutated-cancellation",
        });
        const cancelled = await cancellationPending;
        assert(
          cancelled.ok && cancelled.value.cancellation?.cause === "operator",
          "cancellation snapshot",
        );
      },
    },
    {
      name: "EF-S01-C2 duplicate source equal replay and unequal conflict",
      async run({ subject }) {
        const request = accept("same");
        const first = await subject.store.acceptSource(request);
        const equal = await subject.store.acceptSource(request);
        assert(
          first.ok &&
            equal.ok &&
            equal.value.sourceSeq === first.value.sourceSeq,
          "equal replay must return original",
        );
        const conflict = await subject.store.acceptSource(
          withHash({ ...request, payloadRef: "payload:other" }),
        );
        assert(
          !conflict.ok && conflict.error._tag === "idempotency_conflict",
          "changed hash must conflict",
        );
      },
    },
    {
      name: "EF-S01-C3 rejected acceptance leaves no allocation gap",
      async run(fixture) {
        const failed = await fixture.subject.store.acceptSource(
          accept("before", { parentSourceSeq: 99 }),
        );
        assert(
          !failed.ok && failed.error.certainty === "not_applied",
          "rejected transaction must not apply",
        );
        const next = await fixture.subject.store.acceptSource(accept("after"));
        assert(
          next.ok && next.value.sourceSeq === 1,
          "rollback must not consume a sequence",
        );
      },
    },
    {
      name: "EF-S01-C4 stale frontier and stale operation version are no-ops",
      async run({ subject }) {
        await subject.store.acceptSource(accept("source"));
        const stale = await subject.store.claimNext(claim("claim-stale", 1));
        assert(
          !stale.ok &&
            stale.error._tag === "frontier_mismatch" &&
            stale.error.observedFrontier === 0,
          "nonzero frontier must fail",
        );
        const claimed = await subject.store.claimNext(claim("claim"));
        assert(claimed.ok && claimed.value, "claim must succeed");
        const version = await subject.store.appendIntent(
          intent(claimed.value.operation, "intent", 2),
        );
        assert(
          !version.ok && version.error._tag === "version_mismatch",
          "stale version must fail",
        );
        assert(
          subject.inspect().intents.length === 0,
          "stale mutation must not persist",
        );
      },
    },
    {
      name: "EF-S01-C5 two claimers observe one operation owner",
      async run({ subject }) {
        await subject.store.acceptSource(accept("one"));
        await subject.store.acceptSource(accept("two"));
        const [a, b] = await Promise.all([
          subject.store.claimNext(claim("claim-a", 0, "operation-a")),
          subject.store.claimNext(claim("claim-b", 0, "operation-b")),
        ]);
        assert(Number(a.ok) + Number(b.ok) === 1, "only one claimer wins");
        const loser = a.ok ? b : a;
        assert(
          !loser.ok && loser.error._tag === "owner_conflict",
          "loser sees active owner conflict",
        );
      },
    },
    {
      name: "EF-S01-C6 cancellation exact replay immutable and wrong owner distinct",
      async run({ subject }) {
        const operation = await seededOperation(subject.store);
        const source = await subject.store.acceptSource(
          accept("cancel-source", {
            kind: "cancellation",
            targetOperationId: operation.operationId,
          }),
        );
        assert(source.ok, "cancellation source accepted");
        const request = cancellation(operation, "cancel", source.value);
        const first = await subject.store.acceptCancellation(request);
        const equal = await subject.store.acceptCancellation(request);
        assert(
          first.ok && equal.ok && equal.value.version === first.value.version,
          "equal cancellation replay returns original version",
        );
        const changed = await subject.store.acceptCancellation(
          withHash({
            ...request,
            effect: { ...request.effect, idempotencyKey: "cancel:changed" },
            expectedVersion: first.value.version,
            cause: "changed",
          }),
        );
        assert(
          !changed.ok && changed.error._tag === "owner_conflict",
          "first cancellation is immutable",
        );
        const wrong = await subject.store.acceptCancellation(
          withHash({
            ...request,
            effect: {
              ...request.effect,
              idempotencyKey: "cancel:wrong",
              operationId: "wrong",
            },
          }),
        );
        assert(
          !wrong.ok && wrong.error._tag === "not_found",
          "wrong operation is distinct",
        );
      },
    },
    {
      name: "EF-S01-C7 another harness run cannot replace binding",
      async run({ subject }) {
        const operation = await seededOperation(subject.store);
        const request = binding(operation, "bind");
        const first = await subject.store.bindHarness(request);
        const replay = await subject.store.bindHarness(request);
        assert(
          first.ok && replay.ok && JSON.stringify(replay.value.harness) === JSON.stringify(first.value.harness) &&
            !Object.hasOwn(replay.value.harness!, "watchGeneration"),
          "binding replay preserves immutable identity without a generation mirror",
        );
        const changed = await subject.store.bindHarness(
          withHash({
            ...request,
            effect: { ...request.effect, idempotencyKey: "bind:changed" },
            expectedVersion: first.value.version,
            harnessOperationId: "run-other",
          }),
        );
        assert(
          !changed.ok && changed.error._tag === "owner_conflict",
          "changed run must conflict",
        );
      },
    },
    {
      name: "EF-S01-C8 queued input survives accepted queued consumed and disposed transitions",
      async run(fixture) {
        const operation = await seededOperation(fixture.subject.store);
        const target = await fixture.subject.store.acceptSource(
          accept("target", { targetOperationId: operation.operationId }),
        );
        assert(target.ok, "target source accepted");
        let current = operation;
        for (const state of ["accepted", "queued", "consumed"] as const) {
          const result = await fixture.subject.store.recordQueuedInput(
            queue(current, target.value.sourceSeq, `queue:${state}`, state),
          );
          assert(result.ok, `queue ${state} succeeds`);
          const inspection = fixture.subject.inspect();
          const queueState = inspection.queues.find(
            (entry) => entry.sourceSeq === target.value.sourceSeq,
          )?.state;
          const sourceState = inspection.sources.find(
            (entry) => entry.sourceSeq === target.value.sourceSeq,
          )?.state;
          assert(queueState === state, `queue row is ${state}`);
          assert(
            sourceState === (state === "accepted" ? "claimed" : state),
            `source state follows ${state}`,
          );
          current = result.value;
        }
        const restored = await fixture.crashAndRestore();
        const read = await restored.store.getOperation(operation.operationId);
        assert(
          read.ok && read.value?.version === current.version,
          "queue state and version survive restore",
        );
        assert(
          restored.inspect().queues.at(-1)?.state === "consumed",
          "consumed row survives",
        );
        assert(
          restored
            .inspect()
            .sources.find((entry) => entry.sourceSeq === target.value.sourceSeq)
            ?.state === "consumed",
          "consumed source state survives",
        );
        const disposeOperation = await seededOperationInChat(
          restored.store,
          "chat-dispose",
          "operation-dispose",
        );
        const disposeTarget = await restored.store.acceptSource(
          accept("dispose-target", {
            chatJid: "chat-dispose",
            targetOperationId: disposeOperation.operationId,
          }),
        );
        assert(disposeTarget.ok, "dispose target accepted");
        const accepted = await restored.store.recordQueuedInput(
          queue(
            disposeOperation,
            disposeTarget.value.sourceSeq,
            "queue:dispose:accepted",
            "accepted",
          ),
        );
        assert(accepted.ok, "dispose target recorded accepted");
        assert(
          restored
            .inspect()
            .sources.find(
              (entry) =>
                entry.chatJid === "chat-dispose" &&
                entry.sourceSeq === disposeTarget.value.sourceSeq,
            )?.state === "claimed",
          "accepted queue leaves source claimed",
        );
        const disposed = await restored.store.recordQueuedInput(
          queue(
            accepted.value,
            disposeTarget.value.sourceSeq,
            "queue:dispose",
            "disposed",
          ),
        );
        assert(
          disposed.ok && restored.inspect().queues.at(-1)?.state === "disposed",
          "accepted to disposed survives",
        );
        const disposedRestored = await fixture.crashAndRestore();
        assert(
          disposedRestored
            .inspect()
            .sources.find(
              (entry) =>
                entry.chatJid === "chat-dispose" &&
                entry.sourceSeq === disposeTarget.value.sourceSeq,
            )?.state === "disposed",
          "disposed source state survives restore",
        );
      },
    },
    {
      name: "EF-S01-C9 restart lists every open operation without claiming",
      async run(fixture) {
        const operation = await seededOperation(fixture.subject.store);
        const restored = await fixture.crashAndRestore();
        const list = await restored.store.listOpenOperations({ limit: 10 });
        assert(
          list.ok &&
            list.value.length === 1 &&
            list.value[0].operationId === operation.operationId,
          "open operation listed",
        );
        const frontier = await restored.store.getChatFrontier("chat-1");
        assert(
          frontier.ok &&
            frontier.value.consumedThroughSourceSeq === 0 &&
            frontier.value.activeOperationId === operation.operationId,
          "read does not advance frontier or claim",
        );
      },
    },
    {
      name: "EF-S01-C10 dropped or duplicate wakes do not alter durable state",
      async run({ subject }) {
        const source = await subject.store.acceptSource(
          accept("wake", { createWakeIntent: true }),
        );
        assert(
          source.ok && subject.inspect().wakes.length === 1,
          "wake intent stored with source",
        );
        const replay = await subject.store.acceptSource(
          accept("wake", { createWakeIntent: true }),
        );
        assert(
          replay.ok && subject.inspect().wakes.length === 1,
          "duplicate wake replay creates no second intent",
        );
        const frontier = await subject.store.getChatFrontier("chat-1");
        assert(
          frontier.ok && frontier.value.nextPendingSourceSeq === 1,
          "wake observation is irrelevant to durable pending truth",
        );
      },
    },
    {
      name: "EF-S01-S01 intent equal replay returns original after later versions",
      async run({ subject }) {
        let operation = await seededOperation(subject.store);
        const request = intent(operation, "intent");
        const first = await subject.store.appendIntent(request);
        assert(first.ok, "intent commits");
        const bound = await subject.store.bindHarness(
          binding(first.value, "bind-after-intent"),
        );
        assert(bound.ok, "later version commits");
        const replay = await subject.store.appendIntent(request);
        assert(
          replay.ok && replay.value.version === first.value.version,
          "old replay returns original result",
        );
        const semanticReplay = await subject.store.appendIntent(
          withHash({
            ...request,
            effect: { ...request.effect, idempotencyKey: "intent:new-key" },
          }),
        );
        assert(
          semanticReplay.ok &&
            semanticReplay.value.version === bound.value.version,
          "equal immutable intent under a new key returns the current aggregate without a version bump",
        );
        const changed = await subject.store.appendIntent(
          withHash({
            ...request,
            effect: { ...request.effect, idempotencyKey: "intent:changed" },
            payloadRef: "payload:changed",
          }),
        );
        assert(
          !changed.ok && changed.error._tag === "idempotency_conflict",
          "changed immutable intent conflicts",
        );
        assert(subject.inspect().intents.length === 1, "intent is immutable");
      },
    },
    {
      name: "EF-S01-S02 queue equal state with another key is invalid",
      async run({ subject }) {
        const operation = await seededOperation(subject.store);
        const target = await subject.store.acceptSource(
          accept("target", { targetOperationId: operation.operationId }),
        );
        assert(target.ok, "target accepted");
        const first = await subject.store.recordQueuedInput(
          queue(operation, target.value.sourceSeq, "queue:first", "accepted"),
        );
        assert(first.ok, "accepted queue state commits");
        const duplicateState = await subject.store.recordQueuedInput(
          queue(first.value, target.value.sourceSeq, "queue:other", "accepted"),
        );
        assert(
          !duplicateState.ok &&
            duplicateState.error._tag === "invalid_transition",
          "new identity cannot silently repeat state",
        );
      },
    },
    {
      name: "EF-S01-S03 list ordering pagination and hostile bounds are deterministic",
      async run({ subject }) {
        await seededOperation(subject.store);
        const first = await subject.store.listOpenOperations({ limit: 1 });
        assert(first.ok && first.value.length === 1, "bounded list");
        const page = await subject.store.listOpenOperations({
          afterOperationId: first.value[0].operationId,
          limit: 1,
        });
        assert(page.ok && page.value.length === 0, "cursor is exclusive");
        const invalid = await subject.store.listOpenOperations({ limit: 101 });
        assert(
          !invalid.ok && invalid.error._tag === "invalid_transition",
          "invalid limit is typed",
        );
      },
    },
    {
      name: "EF-S01-S04 every mutation replays its original closed result after later versions",
      async run({ subject }) {
        let operation = await seededOperation(subject.store);
        const intentRequest = intent(operation, "intent-replay");
        const intentResult = await subject.store.appendIntent(intentRequest);
        assert(intentResult.ok, "intent commits");
        operation = intentResult.value;
        const bindRequest = binding(operation, "bind-replay");
        const bindResult = await subject.store.bindHarness(bindRequest);
        assert(bindResult.ok, "binding commits");
        operation = bindResult.value;
        const target = await subject.store.acceptSource(
          accept("replay-target", { targetOperationId: operation.operationId }),
        );
        assert(target.ok, "queue source accepted");
        const queueRequest = queue(
          operation,
          target.value.sourceSeq,
          "queue-replay",
          "accepted",
        );
        const queueResult = await subject.store.recordQueuedInput(queueRequest);
        assert(queueResult.ok, "queue commits");
        operation = queueResult.value;
        const cancellationSource = await subject.store.acceptSource(
          accept("replay-cancel-source", {
            kind: "cancellation",
            targetOperationId: operation.operationId,
          }),
        );
        assert(cancellationSource.ok, "cancellation source accepted");
        const cancellationRequest = cancellation(
          operation,
          "cancel-replay",
          cancellationSource.value,
        );
        const cancellationResult =
          await subject.store.acceptCancellation(cancellationRequest);
        assert(cancellationResult.ok, "cancellation commits");
        for (const [label, replay, version] of [
          [
            "intent",
            subject.store.appendIntent(intentRequest),
            intentResult.value.version,
          ],
          [
            "binding",
            subject.store.bindHarness(bindRequest),
            bindResult.value.version,
          ],
          [
            "queue",
            subject.store.recordQueuedInput(queueRequest),
            queueResult.value.version,
          ],
          [
            "cancellation",
            subject.store.acceptCancellation(cancellationRequest),
            cancellationResult.value.version,
          ],
        ] as const) {
          const result = await replay;
          assert(
            result.ok && result.value.version === version,
            `${label} returns its original result`,
          );
        }
      },
    },
    {
      name: "EF-S01-S05 semantic equal cancellation and binding replay despite stale expected version",
      async run({ subject }) {
        let operation = await seededOperation(subject.store);
        const source = await subject.store.acceptSource(
          accept("cancel-semantic-source", {
            kind: "cancellation",
            targetOperationId: operation.operationId,
          }),
        );
        assert(source.ok, "cancellation source accepted");
        const cancellationRequest = cancellation(
          operation,
          "cancel-first",
          source.value,
        );
        const cancelled =
          await subject.store.acceptCancellation(cancellationRequest);
        assert(cancelled.ok, "cancellation commits");
        const cancellationReplay = await subject.store.acceptCancellation(
          withHash({
            ...cancellationRequest,
            effect: {
              ...cancellationRequest.effect,
              idempotencyKey: "cancel-semantic",
            },
          }),
        );
        assert(
          cancellationReplay.ok &&
            cancellationReplay.value.version === cancelled.value.version,
          "equal immutable cancellation replays before version CAS",
        );
        operation = await seededOperationInChat(
          subject.store,
          "chat-2",
          "operation-2",
        );
        const bindRequest = binding(operation, "bind-first");
        const bound = await subject.store.bindHarness(bindRequest);
        assert(bound.ok, "binding commits");
        const bindingReplay = await subject.store.bindHarness(
          withHash({
            ...bindRequest,
            effect: { ...bindRequest.effect, idempotencyKey: "bind-semantic" },
          }),
        );
        assert(
          bindingReplay.ok &&
            bindingReplay.value.version === bound.value.version,
          "equal immutable binding replays before version CAS",
        );
      },
    },
    {
      name: "EF-S01-R01 lost acknowledgements reconcile every mutation from durable decisions",
      async run(fixture) {
        assert(
          fixture.subject.planFault,
          "subject must expose deterministic adapter-local fault planning",
        );
        const acceptRequest = accept("lost-accept");
        await expectLostAndReplay(
          fixture,
          "acceptSource",
          acceptRequest,
          (store) => store.acceptSource(acceptRequest),
        );
        let operation = await seededOperation(fixture.subject.store);
        const intentRequest = intent(operation, "lost-intent");
        const intentResult = await expectLostAndReplay(
          fixture,
          "appendIntent",
          intentRequest,
          (store) => store.appendIntent(intentRequest),
        );
        operation = intentResult;
        const bindRequest = binding(operation, "lost-bind");
        const bindResult = await expectLostAndReplay(
          fixture,
          "bindHarness",
          bindRequest,
          (store) => store.bindHarness(bindRequest),
        );
        operation = bindResult;
        const target = await fixture.subject.store.acceptSource(
          accept("lost-queue-target", {
            targetOperationId: operation.operationId,
          }),
        );
        assert(target.ok, "queue target accepted");
        const acceptedQueue = queue(
          operation,
          target.value.sourceSeq,
          "lost-queue:accepted",
          "accepted",
        );
        operation = await expectLostAndReplay(
          fixture,
          "recordQueuedInput",
          acceptedQueue,
          (store) => store.recordQueuedInput(acceptedQueue),
        );
        assert(
          fixture.subject.planFault,
          "restored subject keeps fault planning seam",
        );
        const queuedQueue = queue(
          operation,
          target.value.sourceSeq,
          "lost-queue:queued",
          "queued",
        );
        operation = await expectLostAndReplay(
          fixture,
          "recordQueuedInput",
          queuedQueue,
          (store) => store.recordQueuedInput(queuedQueue),
        );
        assert(
          fixture.subject.planFault,
          "restored subject keeps fault planning seam",
        );
        const consumedQueue = queue(
          operation,
          target.value.sourceSeq,
          "lost-queue:consumed",
          "consumed",
        );
        operation = await expectLostAndReplay(
          fixture,
          "recordQueuedInput",
          consumedQueue,
          (store) => store.recordQueuedInput(consumedQueue),
        );
        const queuedDisposeTarget = await fixture.subject.store.acceptSource(
          accept("lost-queue-dispose-target", {
            targetOperationId: operation.operationId,
          }),
        );
        assert(queuedDisposeTarget.ok, "queued dispose target accepted");
        const disposeAccepted = await fixture.subject.store.recordQueuedInput(
          queue(
            operation,
            queuedDisposeTarget.value.sourceSeq,
            "lost-queue-dispose:accepted",
            "accepted",
          ),
        );
        assert(disposeAccepted.ok, "queued dispose accepted");
        const disposeQueued = await fixture.subject.store.recordQueuedInput(
          queue(
            disposeAccepted.value,
            queuedDisposeTarget.value.sourceSeq,
            "lost-queue-dispose:queued",
            "queued",
          ),
        );
        assert(disposeQueued.ok, "queued dispose queued");
        const queuedDisposed = withHash({
          ...queue(
            disposeQueued.value,
            queuedDisposeTarget.value.sourceSeq,
            "lost-queue-dispose:disposed",
            "queued",
          ),
          state: "disposed" as const,
        });
        operation = await expectLostAndReplay(
          fixture,
          "recordQueuedInput",
          queuedDisposed,
          (store) => store.recordQueuedInput(queuedDisposed),
        );
        const cancellationSource = await fixture.subject.store.acceptSource(
          accept("lost-cancel-source", {
            kind: "cancellation",
            targetOperationId: operation.operationId,
          }),
        );
        assert(cancellationSource.ok, "cancellation source accepted");
        const cancellationRequest = cancellation(
          operation,
          "lost-cancel",
          cancellationSource.value,
        );
        await expectLostAndReplay(
          fixture,
          "acceptCancellation",
          cancellationRequest,
          (store) => store.acceptCancellation(cancellationRequest),
        );
        await fixture.subject.store.acceptSource(
          accept("lost-claim-source", { chatJid: "chat-lost-claim" }),
        );
        const claimRequest = withHash({
          ...claim("lost-claim", 0, "operation-lost-claim"),
          chatJid: "chat-lost-claim",
        });
        await expectLostAndReplay(fixture, "claimNext", claimRequest, (store) =>
          store.claimNext(claimRequest),
        );
        const disposedOperation = await seededOperationInChat(
          fixture.subject.store,
          "chat-disposed",
          "operation-disposed",
        );
        const disposedTarget = await fixture.subject.store.acceptSource(
          accept("lost-disposed-target", {
            chatJid: "chat-disposed",
            targetOperationId: disposedOperation.operationId,
          }),
        );
        assert(disposedTarget.ok, "disposed target accepted");
        const disposedAccepted = queue(
          disposedOperation,
          disposedTarget.value.sourceSeq,
          "lost-disposed:accepted",
          "accepted",
        );
        const afterAccepted =
          await fixture.subject.store.recordQueuedInput(disposedAccepted);
        assert(afterAccepted.ok, "disposed queue accepted");
        const disposed = queue(
          afterAccepted.value,
          disposedTarget.value.sourceSeq,
          "lost-disposed:disposed",
          "disposed",
        );
        await expectLostAndReplay(
          fixture,
          "recordQueuedInput",
          disposed,
          (store) => store.recordQueuedInput(disposed),
        );
      },
    },
    {
      name: "EF-S01-S06 in-transaction faults roll back every mutation",
      async run(fixture) {
        assert(
          fixture.subject.planFault,
          "subject must expose deterministic adapter-local fault planning",
        );
        const acceptRequest = accept("rollback-accept");
        await expectRollback(fixture.subject, "acceptSource", () =>
          fixture.subject.store.acceptSource(acceptRequest),
        );
        assert(
          fixture.subject.inspect().sources.length === 0 &&
            fixture.subject.inspect().nextByChat["chat-1"] === undefined,
          "accept rollback leaves no allocation",
        );
        let operation = await seededOperation(fixture.subject.store);
        const intentRequest = intent(operation, "rollback-intent");
        await expectRollback(fixture.subject, "appendIntent", () =>
          fixture.subject.store.appendIntent(intentRequest),
        );
        assert(
          fixture.subject.inspect().intents.length === 0,
          "intent rollback leaves no row",
        );
        const bindRequest = binding(operation, "rollback-bind");
        await expectRollback(fixture.subject, "bindHarness", () =>
          fixture.subject.store.bindHarness(bindRequest),
        );
        let read = await fixture.subject.store.getOperation(
          operation.operationId,
        );
        assert(
          read.ok &&
            read.value?.harness === null &&
            read.value.version === operation.version,
          "binding rollback leaves version and correlation unchanged",
        );
        const target = await fixture.subject.store.acceptSource(
          accept("rollback-target", {
            targetOperationId: operation.operationId,
          }),
        );
        assert(target.ok, "queue target accepted");
        const queueRequest = queue(
          operation,
          target.value.sourceSeq,
          "rollback-queue",
          "accepted",
        );
        await expectRollback(fixture.subject, "recordQueuedInput", () =>
          fixture.subject.store.recordQueuedInput(queueRequest),
        );
        assert(
          fixture.subject.inspect().queues.length === 0,
          "queue rollback leaves no row",
        );
        const cancellationSource = await fixture.subject.store.acceptSource(
          accept("rollback-cancel-source", {
            kind: "cancellation",
            targetOperationId: operation.operationId,
          }),
        );
        assert(cancellationSource.ok, "cancellation source accepted");
        const cancellationRequest = cancellation(
          operation,
          "rollback-cancel",
          cancellationSource.value,
        );
        await expectRollback(fixture.subject, "acceptCancellation", () =>
          fixture.subject.store.acceptCancellation(cancellationRequest),
        );
        read = await fixture.subject.store.getOperation(operation.operationId);
        assert(
          read.ok &&
            read.value?.cancellation === null &&
            read.value.version === operation.version,
          "cancellation rollback leaves version and cancellation unchanged",
        );
        await fixture.subject.store.acceptSource(
          accept("rollback-claim-source", { chatJid: "chat-rollback-claim" }),
        );
        const claimRequest = withHash({
          ...claim("rollback-claim", 0, "operation-rollback-claim"),
          chatJid: "chat-rollback-claim",
        });
        await expectRollback(fixture.subject, "claimNext", () =>
          fixture.subject.store.claimNext(claimRequest),
        );
        const frontier = await fixture.subject.store.getChatFrontier(
          "chat-rollback-claim",
        );
        assert(
          frontier.ok &&
            frontier.value.activeOperationId === null &&
            frontier.value.nextPendingSourceSeq === 1,
          "claim rollback restores pending source and owner",
        );
      },
    },
  ];

export const SERVICE_WORK_STORE_CONTRACT_CASE_NAMES = Object.freeze(
  cases.map((contractCase) => contractCase.name),
);

export function defineServiceWorkStoreContract(
  factory: ContractSubjectFactory<ServiceWorkContractSubject>,
  createContext: () => ContractTestContext,
) {
  return runParameterisedContractSuite(
    factory,
    cases,
    createContext,
    async (subject) => subject.dispose?.(),
  );
}

async function seededOperation(
  store: ServiceWorkStore,
): Promise<OperationSnapshot> {
  const source = await store.acceptSource(accept("primary"));
  assert(source.ok, "source accepted");
  const claimed = await store.claimNext(claim("claim"));
  assert(claimed.ok && claimed.value, "source claimed");
  return claimed.value.operation;
}
async function seededOperationInChat(
  store: ServiceWorkStore,
  chatJid: string,
  operationId: string,
): Promise<OperationSnapshot> {
  const source = await store.acceptSource(
    accept(`primary:${chatJid}`, { chatJid }),
  );
  assert(source.ok, "source accepted");
  const claimed = await store.claimNext(
    withHash({ ...claim(`claim:${chatJid}`, 0, operationId), chatJid }),
  );
  assert(claimed.ok && claimed.value, "source claimed");
  return claimed.value.operation;
}
function baseEffect(key: string): EffectIdentity {
  return {
    idempotencyKey: key,
    requestHash: "",
    operationId: null,
    sourceSeq: null,
    provenanceRef: "contract-suite",
    redactionClass: "private",
  };
}
function withHash<T extends { effect: EffectIdentity }>(request: T): T {
  const value = { ...request, effect: { ...request.effect, requestHash: "" } };
  return {
    ...value,
    effect: {
      ...value.effect,
      requestHash: hashCanonicalRequest(value as unknown as CanonicalJsonValue),
    },
  } as T;
}
function accept(
  id: string,
  options: Partial<AcceptSourceRequest> = {},
): AcceptSourceRequest {
  return withHash({
    effect: baseEffect(`source:chat-1:${id}`),
    chatJid: "chat-1",
    sourceId: id,
    kind: "message",
    payloadRef: `payload:${id}`,
    targetOperationId: null,
    parentSourceSeq: null,
    acceptedAt: "2026-08-13T07:00:00.000Z",
    createWakeIntent: false,
    ...options,
  });
}
function claim(
  key: string,
  expectedFrontier = 0,
  newOperationId = "operation-1",
): ClaimNextSourceRequest {
  return withHash({
    effect: baseEffect(key),
    chatJid: "chat-1",
    expectedFrontier,
    newOperationId,
    claimedAt: "2026-08-13T07:00:01.000Z",
  });
}
function ownedEffect(
  key: string,
  operationId: string,
): EffectIdentity & { operationId: string } {
  return { ...baseEffect(key), operationId };
}
function intent(
  op: OperationSnapshot,
  key: string,
  expectedVersion = op.version,
): AppendOperationIntentRequest {
  return withHash({
    effect: ownedEffect(key, op.operationId),
    expectedVersion,
    intentId: "intent-1",
    kind: "prompt",
    payloadRef: "payload:intent",
    createdAt: "2026-08-13T07:00:02.000Z",
  });
}
function cancellation(
  op: OperationSnapshot,
  key: string,
  source: { sourceId: string; sourceSeq: number } = {
    sourceId: "primary",
    sourceSeq: op.primarySourceSeq,
  },
): AcceptCancellationRequest {
  return withHash({
    effect: ownedEffect(key, op.operationId),
    expectedVersion: op.version,
    sourceId: source.sourceId,
    sourceSeq: source.sourceSeq,
    cause: "operator",
    requestedAt: "2026-08-13T07:00:03.000Z",
  });
}
function binding(op: OperationSnapshot, key: string): BindHarnessRequest {
  return withHash({
    effect: ownedEffect(key, op.operationId),
    expectedVersion: op.version,
    sessionId: "session-1",
    harnessOperationId: "run-1",
  });
}
function queue(
  op: OperationSnapshot,
  sourceSeq: number,
  key: string,
  state: RecordQueuedInputRequest["state"],
): RecordQueuedInputRequest {
  return withHash({
    effect: ownedEffect(key, op.operationId),
    expectedVersion: op.version,
    sourceSeq,
    queueKind: "follow_up",
    harnessEntryId:
      state === "accepted" || state === "disposed" ? null : "entry-1",
    state,
  });
}
async function expectLostAndReplay<T>(
  fixture: {
    subject: ServiceWorkContractSubject;
    crashAndRestore(): Promise<ServiceWorkContractSubject>;
  },
  method: ServiceWorkMutationMethod,
  request: unknown,
  invoke: (
    store: ServiceWorkStore,
  ) => Promise<
    { ok: true; value: T } | { ok: false; error: { certainty: string } }
  >,
): Promise<T> {
  assert(fixture.subject.planFault, `${method} exposes fault planner`);
  fixture.subject.planFault(method, "effect_then_lost_acknowledgement", 1);
  const lost = await invoke(fixture.subject.store);
  assert(
    !lost.ok && lost.error.certainty === "unknown",
    `${method} lost acknowledgement is unknown`,
  );
  const restored = await fixture.crashAndRestore();
  const replay = await invoke(restored.store);
  assert(replay.ok, `${method} reconciles from durable decision`);
  void request;
  return replay.value;
}
async function expectRollback(
  subject: ServiceWorkContractSubject,
  method: ServiceWorkMutationMethod,
  invoke: () => Promise<
    { ok: true; value: unknown } | { ok: false; error: { certainty: string } }
  >,
): Promise<void> {
  subject.planFault!(method, "before_effect", 2);
  const result = await invoke();
  assert(
    !result.ok && result.error.certainty === "not_applied",
    `${method} rollback is not applied`,
  );
}
