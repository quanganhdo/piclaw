import type {
  CanonicalJsonValue,
  EffectIdentity,
  NormalisedEffectTrace,
} from "../../contracts/common.js";
import { hashCanonicalRequest } from "../../contracts/common.js";
import type { EnqueueOutboxRequest } from "../../contracts/service-outbox-store.js";
import type { HarnessCorrelation } from "../../contracts/service-work-store.js";
import type {
  CommitTerminalRequest,
  TerminalSettlementStore,
} from "../../contracts/terminal-settlement-store.js";
import type {
  ContractSubjectFactory,
  ContractTestContext,
  ParameterisedContractCase,
} from "../contract-suite.js";
import { runParameterisedContractSuite } from "../contract-suite.js";
import type {
  FakeTerminalDraftSeed,
  FakeTerminalOperationSeed,
} from "../fakes/fake-terminal-settlement-store.js";

export interface TerminalSettlementDurableView {
  readonly operation: {
    readonly operationId: string;
    readonly phase: string;
    readonly version: number;
    readonly activeOperationId: string | null;
    readonly disposition: string | null;
    readonly messageRowId: number | null;
    readonly consumedThroughSourceSeq: number;
  } | null;
  readonly sources: readonly {
    readonly sourceSeq: number;
    readonly state: string;
    readonly queuedState: string | null;
  }[];
  readonly messages: readonly {
    readonly rowId: number;
    readonly terminal: boolean;
    readonly threadId: number | null;
    readonly mediaIds: readonly number[];
    readonly content: string;
    readonly contentBlocks: CanonicalJsonValue | null;
  }[];
  readonly outboxIds: readonly string[];
  readonly commitCount: number;
  readonly projectionCount: number;
}

export interface TerminalSettlementPayloadSeed {
  readonly ref: string;
  readonly content: string;
  readonly mediaType?: string;
  readonly redactionClass?: "public" | "private" | "secret";
  readonly sha256?: string;
  readonly byteLength?: number;
}

export type TerminalSettlementObserverBehavior =
  | "false"
  | "true"
  | "throw"
  | "nonboolean"
  | "thenable";

export interface TerminalSettlementContractSubject {
  readonly store: TerminalSettlementStore;
  seedOperation(seed: FakeTerminalOperationSeed): void;
  seedDraft(seed: FakeTerminalDraftSeed): void;
  seedMedia(operationId: string, mediaId: number, role?: string): void;
  seedOutbox(request: EnqueueOutboxRequest): void;
  planFault(
    point: "before_effect" | "effect_then_lost_acknowledgement",
    occurrence?: number,
  ): void;
  planStatementFault(occurrence: number): void;
  setFaultBehavior(
    point: "before_effect" | "effect_then_lost_acknowledgement",
    behavior: TerminalSettlementObserverBehavior,
  ): void;
  setCheckpointBehavior(behavior: TerminalSettlementObserverBehavior): void;
  seedPayload(seed: TerminalSettlementPayloadSeed): void;
  mutatePayloadBytes(ref: string, byte: number): void;
  blockPayload(ref: string): { readonly started: Promise<void>; release(): void };
  holdWriterLock(): { release(): void };
  removePayload(ref: string): void;
  payloadResolutionCount(): number;
  inspectStatements(): readonly string[];
  corruptCommitRequestHash(operationId: string): void;
  inspectDurable(operationId?: string): TerminalSettlementDurableView;
  dispose?(): void | Promise<void>;
}

function namedOperation(index: number): FakeTerminalOperationSeed {
  const operationId = `observer-operation-${index}`;
  const chatJid = `web:observer-${index}`;
  return terminalOperation({
    operationId,
    chatJid,
    activeOperationId: operationId,
    sources: [
      { sourceSeq: 1, state: "claimed", operationId },
    ],
  });
}

function namedRequest(index: number): CommitTerminalRequest {
  const operationId = `observer-operation-${index}`;
  const chatJid = `web:observer-${index}`;
  return terminalRequest({
    key: `observer-key-${index}`,
    operationId,
    chatJid,
  });
}

function assert(value: unknown, message: string): asserts value {
  if (!value) throw new Error(message);
}

export const TERMINAL_HARNESS = Object.freeze({
  sessionId: "harness-session-1",
  lane: "main",
  harnessOperationId: "harness-run-1",
  state: "finished",
  watchGeneration: 2,
}) satisfies HarnessCorrelation;

export function terminalOperation(
  overrides: Partial<FakeTerminalOperationSeed> = {},
): FakeTerminalOperationSeed {
  return {
    operationId: "operation-1",
    chatJid: "web:terminal",
    version: 3,
    phase: "settling",
    harness: TERMINAL_HARNESS,
    activeOperationId: "operation-1",
    consumedThroughSourceSeq: 0,
    sources: [
      {
        sourceSeq: 1,
        state: "claimed",
        operationId: "operation-1",
      },
    ],
    ...overrides,
  };
}

function effect(
  key: string,
  operationId: string,
  sourceSeq: number | null,
  redactionClass: EffectIdentity["redactionClass"] = "secret",
): EffectIdentity {
  return {
    idempotencyKey: key,
    requestHash: "",
    operationId,
    sourceSeq,
    provenanceRef: "opaque:protected-provenance",
    redactionClass,
  };
}

export function terminalOutbox(
  id: string,
  operationId = "operation-1",
  sourceSeq: number | null = 1,
): EnqueueOutboxRequest {
  const base: EnqueueOutboxRequest = {
    effect: effect(`outbox-key:${id}`, operationId, sourceSeq),
    outboxId: id,
    kind: "timeline_broadcast",
    payloadRef: `opaque:protected-outbox:${id}`,
    destinationRef: "opaque:protected-destination",
    availableAt: "2026-08-14T10:00:00.000Z",
    enqueuedAt: "2026-08-14T10:00:00.000Z",
    repeatability: "repeatable",
  };
  return withHash(base);
}

interface RequestOptions {
  readonly key?: string;
  readonly operationId?: string;
  readonly chatJid?: string;
  readonly expectedVersion?: number;
  readonly expectedHarness?: HarnessCorrelation | null;
  readonly disposition?: CommitTerminalRequest["disposition"];
  readonly errorCode?: string | null;
  readonly terminalAuthorityRef?: string | null;
  readonly mode?: "insert" | "replace_placeholder" | "none";
  readonly placeholderRowId?: number | null;
  readonly threadId?: number | null;
  readonly mediaIds?: readonly number[];
  readonly contentRef?: string;
  readonly contentBlocksRef?: string | null;
  readonly sourceDispositions?: CommitTerminalRequest["sourceDispositions"];
  readonly outboxIntents?: readonly EnqueueOutboxRequest[];
  readonly committedAt?: string;
  readonly effectSourceSeq?: number | null;
  readonly redactionClass?: EffectIdentity["redactionClass"];
}

export function terminalRequest(
  options: RequestOptions = {},
): CommitTerminalRequest {
  const operationId = options.operationId ?? "operation-1";
  const chatJid = options.chatJid ?? "web:terminal";
  const mode = options.mode ?? "insert";
  const disposition = options.disposition ?? "completed";
  const content = {
    chatJid,
    contentRef: options.contentRef ?? "payload:terminal-content",
    threadId: options.threadId ?? null,
    mediaIds: options.mediaIds ?? [],
    contentBlocksRef: options.contentBlocksRef ?? null,
  };
  const timeline: CommitTerminalRequest["timeline"] =
    mode === "none"
      ? {
          mode: "none",
          placeholderRowId: null,
          chatJid,
          contentRef: null,
          threadId: null,
          mediaIds: [],
          contentBlocksRef: null,
        }
      : mode === "replace_placeholder"
        ? {
            mode,
            placeholderRowId: options.placeholderRowId ?? 40,
            ...content,
          }
        : { mode, placeholderRowId: null, ...content };
  const authorityRequired =
    disposition === "skipped" || disposition === "superseded";
  const base: CommitTerminalRequest = {
    effect: effect(
      options.key ?? "terminal-key-1",
      operationId,
      options.effectSourceSeq === undefined ? 1 : options.effectSourceSeq,
      options.redactionClass,
    ) as
      EffectIdentity & { readonly operationId: string },
    expectedChatJid: chatJid,
    expectedVersion: options.expectedVersion ?? 3,
    expectedHarness:
      options.expectedHarness === undefined
        ? TERMINAL_HARNESS
        : options.expectedHarness,
    disposition,
    errorCode:
      options.errorCode === undefined
        ? disposition === "failed"
          ? "HARNESS_FAILED"
          : null
        : options.errorCode,
    terminalAuthorityRef:
      options.terminalAuthorityRef === undefined
        ? authorityRequired
          ? "opaque:terminal-authority"
          : null
        : options.terminalAuthorityRef,
    timeline,
    sourceDispositions:
      options.sourceDispositions ??
      Object.freeze([{ sourceSeq: 1, state: "consumed", reason: "terminal" }]),
    outboxIntents: options.outboxIntents ?? Object.freeze([]),
    committedAt: options.committedAt ?? "2026-08-14T10:00:00.000Z",
  };
  return withHash(base);
}

function withHash<T extends { readonly effect: EffectIdentity }>(input: T): T {
  const base = {
    ...input,
    effect: { ...input.effect, requestHash: "" },
  };
  return {
    ...base,
    effect: {
      ...base.effect,
      requestHash: hashCanonicalRequest(base as unknown as CanonicalJsonValue),
    },
  } as T;
}

function untouched(view: TerminalSettlementDurableView): boolean {
  return (
    view.operation?.phase !== "terminal" &&
    view.operation?.disposition === null &&
    view.operation?.activeOperationId === view.operation?.operationId &&
    view.sources.every((source) => source.state === "claimed") &&
    view.messages.every((message) => !message.terminal) &&
    view.commitCount === 0
  );
}

const cases: readonly ParameterisedContractCase<TerminalSettlementContractSubject>[] =
  Object.freeze([
    {
      name: "EF-S02-C1 rollback after every statement leaves no partial terminal state",
      async run({ subject }) {
        subject.seedOperation(terminalOperation());
        const request = terminalRequest({
          outboxIntents: [terminalOutbox("terminal-c1")],
        });
        let statement = 1;
        for (; statement <= 100; statement += 1) {
          subject.planStatementFault(statement);
          const result = await subject.store.commitTerminal(request);
          if (result.ok) break;
          assert(
            result.error._tag === "storage_unavailable" &&
              result.error.certainty === "not_applied",
            `statement ${statement} must roll back: ${result.error._tag}:${result.error.certainty}`,
          );
          assert(untouched(subject.inspectDurable()), `partial state at ${statement}`);
        }
        assert(statement > 1 && statement <= 100, "rollback sweep reached every executed statement");
        const executed = subject.inspectStatements();
        assert(executed.length === statement - 1, "statement trace cardinality matches sweep");
        assert(
          executed.every((entry, index) => entry.startsWith(`${index + 1}:`)),
          "statement trace occurrences are consecutive",
        );
      },
    },
    {
      name: "EF-S02-C2 commit followed by lost acknowledgement returns original result",
      async run({ subject }) {
        subject.seedOperation(terminalOperation());
        const request = terminalRequest();
        subject.planFault("effect_then_lost_acknowledgement");
        const lost = await subject.store.commitTerminal(request);
        assert(
          !lost.ok && lost.error.certainty === "unknown",
          "lost response must be unknown",
        );
        const replay = await subject.store.commitTerminal(request);
        assert(replay.ok && replay.value.operationVersion === 4, "replay original");
        assert(subject.inspectDurable().commitCount === 1, "one commit");
      },
    },
    {
      name: "EF-S02-C3 accepted cancellation authority authorises cancellation and rejects completion",
      async run({ subject }) {
        subject.seedOperation(
          terminalOperation({ cancellationSourceSeq: 1, phase: "settling" }),
        );
        const [completion, cancellation] = await Promise.all([
          subject.store.commitTerminal(terminalRequest({ key: "race-complete" })),
          subject.store.commitTerminal(
            terminalRequest({ key: "race-cancel", disposition: "cancelled" }),
          ),
        ]);
        assert(
          Number(completion.ok) + Number(cancellation.ok) === 1,
          "one winner",
        );
        assert(subject.inspectDurable().operation?.disposition === "cancelled", "cancel wins authority");
        assert(subject.inspectDurable().commitCount === 1, "one decision");
      },
    },
    {
      name: "EF-S02-C4 stale Piclaw version chat owner and complete harness correlation are no-ops",
      async run({ subject }) {
        subject.seedOperation(terminalOperation());
        for (const invalid of [
          terminalRequest({ key: "stale-version", expectedVersion: 2 }),
          terminalRequest({ key: "stale-chat", chatJid: "web:other" }),
          terminalRequest({
            key: "stale-harness",
            expectedHarness: { ...TERMINAL_HARNESS, watchGeneration: 1 },
          }),
        ]) {
          const result = await subject.store.commitTerminal(invalid);
          assert(!result.ok, "stale fence rejected");
          assert(untouched(subject.inspectDurable()), "stale fence is no-op");
        }
      },
    },
    {
      name: "EF-S02-C5 missing or duplicate media cannot create two terminal rows",
      async run({ subject }) {
        subject.seedOperation(terminalOperation());
        const missing = await subject.store.commitTerminal(
          terminalRequest({ key: "missing-media", mediaIds: [51] }),
        );
        assert(!missing.ok && missing.error._tag === "missing_media", "missing");
        const duplicate = await subject.store.commitTerminal(
          terminalRequest({ key: "duplicate-media", mediaIds: [51, 51] }),
        );
        assert(!duplicate.ok, "duplicate media rejected");
        subject.seedMedia("operation-1", 51);
        const committed = await subject.store.commitTerminal(
          terminalRequest({ key: "valid-media", mediaIds: [51] }),
        );
        assert(committed.ok, "valid media commits");
        const conflict = await subject.store.commitTerminal(
          terminalRequest({ key: "other-terminal", mediaIds: [51] }),
        );
        assert(
          !conflict.ok && conflict.error._tag === "already_terminal_conflict",
          "second terminal conflicts",
        );
        assert(subject.inspectDurable().messages.length === 1, "one row");
      },
    },
    {
      name: "EF-S02-C6 placeholder replacement preserves one terminal message",
      async run({ subject }) {
        subject.seedOperation(terminalOperation());
        subject.seedDraft({
          operationId: "operation-1",
          rowId: 40,
          revision: 2,
          chatJid: "web:terminal",
          threadId: null,
          contentRef: "payload:draft",
        });
        const result = await subject.store.commitTerminal(
          terminalRequest({ mode: "replace_placeholder", placeholderRowId: 40 }),
        );
        assert(result.ok && result.value.messageRowId === 40, "same row");
        const view = subject.inspectDurable();
        assert(view.messages.length === 1 && view.messages[0]?.terminal, "terminal replacement");
      },
    },
    {
      name: "EF-S02-C7 new-row settlement preserves one terminal message",
      async run({ subject }) {
        subject.seedOperation(terminalOperation());
        const result = await subject.store.commitTerminal(terminalRequest());
        assert(result.ok && result.value.messageRowId !== null, "message committed");
        const replay = await subject.store.commitTerminal(terminalRequest());
        assert(replay.ok && replay.value.messageRowId === result.value.messageRowId, "stable row");
        assert(subject.inspectDurable().messages.length === 1, "one terminal row");
      },
    },
    {
      name: "EF-S02-C8 outbox insertion failure rolls back disposition and timeline",
      async run({ subject }) {
        subject.seedOperation(terminalOperation());
        const requested = terminalOutbox("terminal-c8");
        subject.seedOutbox(terminalOutbox("terminal-c8-existing"));
        const conflict = {
          ...requested,
          outboxId: "terminal-c8-existing",
        };
        const request = terminalRequest({
          outboxIntents: [withHash(conflict)],
        });
        const result = await subject.store.commitTerminal(request);
        assert(!result.ok && result.error._tag === "idempotency_conflict", "outbox conflict");
        assert(untouched(subject.inspectDurable()), "outbox failure atomic");
      },
    },
    {
      name: "EF-S02-C9 frontier cannot cross pending or claimed work and no projection occurs before commit",
      async run({ subject }) {
        subject.seedOperation(
          terminalOperation({
            sources: [
              { sourceSeq: 1, state: "claimed", operationId: "operation-1" },
              { sourceSeq: 2, state: "pending", operationId: null },
              { sourceSeq: 3, state: "disposed", operationId: null },
            ],
          }),
        );
        const result = await subject.store.commitTerminal(terminalRequest({ mode: "none" }));
        assert(result.ok && result.value.consumedThroughSourceSeq === 1, "frontier stops");
        const view = subject.inspectDurable();
        assert(view.projectionCount === 0, "no projection");
        assert(view.sources[1]?.state === "pending", "foreign work untouched");
      },
    },
    {
      name: "EF-S02-R01 pre-effect no-op C1 rollback evidence held-lock retry and lost-ack restore converge",
      async run(fixture) {
        fixture.subject.seedOperation(namedOperation(80));
        fixture.subject.planFault("before_effect");
        const preEffect = await fixture.subject.store.commitTerminal(
          namedRequest(80),
        );
        assert(
          !preEffect.ok &&
            preEffect.error._tag === "storage_unavailable" &&
            preEffect.error.certainty === "not_applied",
          "pre-effect no-op",
        );
        assert(
          untouched(fixture.subject.inspectDurable("observer-operation-80")),
          "pre-effect leaves no state",
        );

        fixture.subject.seedOperation(terminalOperation());
        const request = terminalRequest({
          outboxIntents: [terminalOutbox("crash-oracle")],
        });
        const lock = fixture.subject.holdWriterLock();
        const blocked = await fixture.subject.store.commitTerminal(request);
        lock.release();
        assert(
          !blocked.ok &&
            blocked.error._tag === "storage_unavailable" &&
            blocked.error.certainty === "not_applied",
          "held writer lock is bounded and retryable",
        );
        assert(
          fixture.subject.inspectDurable().commitCount === 0,
          "held lock leaves no partial commit",
        );

        // EF-S02-C1 exhausts every named statement checkpoint; R01 reuses that
        // rollback oracle before proving postcommit crash restoration here.
        fixture.subject.planFault("effect_then_lost_acknowledgement");
        const lost = await fixture.subject.store.commitTerminal(request);
        assert(!lost.ok && lost.error.certainty === "unknown", "lost acknowledgement is unknown");
        const restored = await fixture.crashAndRestore();
        restored.removePayload("payload:terminal-content");
        const before = restored.payloadResolutionCount();
        const replay = await restored.store.commitTerminal(request);
        assert(replay.ok, "durable replay succeeds without payload");
        assert(restored.payloadResolutionCount() === before, "replay bypasses resolver");
        const view = restored.inspectDurable();
        assert(
          view.commitCount === 1 &&
            view.operation?.disposition === "completed" &&
            view.messages.length === 1 &&
            view.messages[0]?.terminal === true &&
            JSON.stringify(view.outboxIds) === JSON.stringify(["crash-oracle"]),
          "one durable disposition timeline and outbox set",
        );
        const byOperation = await restored.store.getTerminal("operation-1");
        const byKey = await restored.store.getTerminalByKey("terminal-key-1");
        assert(
          byOperation.ok &&
            byKey.ok &&
            JSON.stringify(byOperation.value) === JSON.stringify(replay.value) &&
            JSON.stringify(byKey.value) === JSON.stringify(replay.value),
          "stable restored reads",
        );
      },
    },
    {
      name: "EF-S02-S05 equal replay is stable and altered candidate conflicts before payload resolution",
      async run({ subject }) {
        subject.seedOperation(terminalOperation());
        const request = terminalRequest();
        const first = await subject.store.commitTerminal(request);
        const replay = await subject.store.commitTerminal(request);
        assert(first.ok && replay.ok, "equal replay");
        assert(JSON.stringify(first.value) === JSON.stringify(replay.value), "stable commit");
        const before = subject.payloadResolutionCount();
        subject.removePayload("payload:terminal-content");
        const conflict = await subject.store.commitTerminal(
          terminalRequest({ key: "altered-terminal-key" }),
        );
        assert(
          !conflict.ok && conflict.error._tag === "already_terminal_conflict",
          "altered candidate conflicts",
        );
        assert(subject.payloadResolutionCount() === before, "conflict bypasses resolver");
      },
    },
    {
      name: "EF-S02-S01 queued input follows exact source disposition",
      async run({ subject }) {
        subject.seedOperation(
          terminalOperation({
            sources: [
              { sourceSeq: 1, state: "claimed", operationId: "operation-1" },
              {
                sourceSeq: 2,
                state: "queued",
                kind: "steer",
                operationId: "operation-1",
                queuedState: "queued",
              },
            ],
          }),
        );
        const result = await subject.store.commitTerminal(
          terminalRequest({
            sourceDispositions: [
              { sourceSeq: 1, state: "consumed", reason: "primary" },
              { sourceSeq: 2, state: "disposed", reason: "terminal" },
            ],
          }),
        );
        assert(result.ok, "commit");
        const view = subject.inspectDurable();
        assert(
          view.sources[1]?.state === "disposed" &&
            view.sources[1]?.queuedState === "disposed",
          "queue settled once",
        );
      },
    },
    {
      name: "EF-S02-S02 outbox authority cannot cross operation sources",
      async run({ subject }) {
        subject.seedOperation(terminalOperation());
        const result = await subject.store.commitTerminal(
          terminalRequest({
            outboxIntents: [terminalOutbox("foreign-source", "operation-1", 99)],
          }),
        );
        assert(!result.ok && result.error._tag === "owner_conflict", "source authority");
        assert(untouched(subject.inspectDurable()), "authority failure no-op");
      },
    },
    {
      name: "EF-S02-S03 byte-equal pre-existing outbox rows are not EF-S02 insertion success",
      async run({ subject }) {
        subject.seedOperation(terminalOperation());
        const intent = terminalOutbox("preexisting-exact");
        subject.seedOutbox(intent);
        const result = await subject.store.commitTerminal(
          terminalRequest({ outboxIntents: [intent] }),
        );
        assert(!result.ok && result.error._tag === "idempotency_conflict", "preexisting row conflicts");
        assert(untouched(subject.inspectDurable()), "preexisting collision rolls back terminal state");
      },
    },
    {
      name: "EF-S02-S04 reads return immutable commit by operation and key",
      async run({ subject }) {
        subject.seedOperation(terminalOperation());
        const committed = await subject.store.commitTerminal(terminalRequest());
        assert(committed.ok, "commit");
        const byOperation = await subject.store.getTerminal("operation-1");
        const byKey = await subject.store.getTerminalByKey("terminal-key-1");
        assert(byOperation.ok && byKey.ok && byOperation.value && byKey.value, "reads");
        assert(Object.isFrozen(byOperation.value) && Object.isFrozen(byOperation.value.outboxIds), "immutable");
        assert(JSON.stringify(byOperation.value) === JSON.stringify(byKey.value), "same commit");
      },
    },
    {
      name: "EF-S02-S07 pre-effect callback accepts only exact false",
      async run({ subject }) {
        const behaviors: readonly TerminalSettlementObserverBehavior[] = [
          "false",
          "true",
          "throw",
          "nonboolean",
          "thenable",
        ];
        for (const [index, behavior] of behaviors.entries()) {
          subject.seedOperation(namedOperation(index + 10));
          subject.setFaultBehavior("before_effect", behavior);
          const result = await subject.store.commitTerminal(namedRequest(index + 10));
          if (behavior === "false") {
            assert(
              result.ok,
              `pre ${behavior} proceeds: ${result.ok ? "ok" : result.error._tag}`,
            );
          } else {
            assert(
              !result.ok &&
                result.error._tag === "storage_unavailable" &&
                result.error.certainty === "not_applied",
              `pre ${behavior} is not applied`,
            );
            assert(
              untouched(subject.inspectDurable(`observer-operation-${index + 10}`)),
              `pre ${behavior} leaves no durable state`,
            );
          }
        }
      },
    },
    {
      name: "EF-S02-S08 postcommit callback treats only exact true as lost acknowledgement",
      async run({ subject }) {
        const behaviors: readonly TerminalSettlementObserverBehavior[] = [
          "false",
          "true",
          "throw",
          "nonboolean",
          "thenable",
        ];
        for (const [index, behavior] of behaviors.entries()) {
          const operationIndex = index + 20;
          subject.seedOperation(namedOperation(operationIndex));
          subject.setFaultBehavior(
            "effect_then_lost_acknowledgement",
            behavior,
          );
          const result = await subject.store.commitTerminal(
            namedRequest(operationIndex),
          );
          if (behavior === "true") {
            assert(
              !result.ok &&
                result.error._tag === "storage_unavailable" &&
                result.error.certainty === "unknown",
              "exact true loses acknowledgement",
            );
          } else {
            assert(result.ok, `post ${behavior} preserves success`);
          }
          assert(
            subject.inspectDurable(`observer-operation-${operationIndex}`)
              .commitCount === 1,
            `post ${behavior} is durable`,
          );
        }
      },
    },
    {
      name: "EF-S02-S09 statement checkpoint accepts only exact false",
      async run({ subject }) {
        const behaviors: readonly TerminalSettlementObserverBehavior[] = [
          "false",
          "true",
          "throw",
          "nonboolean",
          "thenable",
        ];
        for (const [index, behavior] of behaviors.entries()) {
          const operationIndex = index + 30;
          subject.seedOperation(namedOperation(operationIndex));
          subject.setCheckpointBehavior(behavior);
          const result = await subject.store.commitTerminal(
            namedRequest(operationIndex),
          );
          if (behavior === "false") {
            assert(result.ok, "checkpoint false proceeds");
          } else {
            assert(
              !result.ok &&
                result.error._tag === "storage_unavailable" &&
                result.error.certainty === "not_applied",
              `checkpoint ${behavior} rolls back`,
            );
            assert(
              untouched(subject.inspectDurable(`observer-operation-${operationIndex}`)),
              `checkpoint ${behavior} no-op`,
            );
          }
        }
      },
    },
    {
      name: "EF-S02-S13 public reads reject malformed durable snapshots in both adapters",
      async run({ subject }) {
        subject.seedOperation(namedOperation(71));
        const committed = await subject.store.commitTerminal(namedRequest(71));
        assert(committed.ok, "corruption seed commit");
        subject.corruptCommitRequestHash("observer-operation-71");
        const [byOperation, byKey] = await Promise.all([
          subject.store.getTerminal("observer-operation-71"),
          subject.store.getTerminalByKey("observer-key-71"),
        ]);
        assert(
          !byOperation.ok && byOperation.error._tag === "corrupt_state",
          "operation read detects corruption",
        );
        assert(
          !byKey.ok && byKey.error._tag === "corrupt_state",
          "key read detects corruption",
        );
      },
    },
    {
      name: "EF-S02-S12 source sequence gaps below the chat frontier are corrupt",
      async run({ subject }) {
        const operation = namedOperation(70);
        subject.seedOperation({
          ...operation,
          sources: [
            { sourceSeq: 1, state: "claimed", operationId: operation.operationId },
            { sourceSeq: 3, state: "pending", operationId: null },
          ],
        });
        const result = await subject.store.commitTerminal(namedRequest(70));
        assert(
          !result.ok && result.error._tag === "corrupt_state",
          "frontier gap is corruption",
        );
        assert(
          subject.inspectDurable(operation.operationId).commitCount === 0,
          "frontier gap rolls back",
        );
      },
    },
    {
      name: "EF-S02-S11 queued-input ownership follows durable source state rather than source kind",
      async run({ subject }) {
        const variants = [
          { state: "claimed", queuedState: null, ok: true },
          { state: "claimed", queuedState: "accepted", ok: true },
          { state: "queued", queuedState: "queued", ok: true },
          { state: "queued", queuedState: null, ok: false },
          { state: "claimed", queuedState: "queued", ok: false },
          { state: "claimed", queuedState: "consumed", ok: false },
        ] as const;
        for (const [index, variant] of variants.entries()) {
          const operationIndex = index + 60;
          const operation = namedOperation(operationIndex);
          subject.seedOperation({
            ...operation,
            sources: [
              {
                sourceSeq: 1,
                state: variant.state,
                kind: "steer",
                operationId: operation.operationId,
                queuedState: variant.queuedState,
              },
            ],
          });
          const result = await subject.store.commitTerminal(
            namedRequest(operationIndex),
          );
          if (variant.ok) {
            assert(result.ok, `${variant.state}/${variant.queuedState} allowed`);
          } else {
            assert(
              !result.ok && result.error._tag === "corrupt_state",
              `${variant.state}/${variant.queuedState} corrupt`,
            );
            const durable = subject.inspectDurable(operation.operationId);
            assert(
              durable.commitCount === 0 && durable.operation?.phase !== "terminal",
              "queue corruption rolls back",
            );
          }
        }
      },
    },
    {
      name: "EF-S02-S10 independent resolvers reject malformed payloads and snapshot bytes",
      async run({ subject }) {
        const redactions = ["public", "private", "secret"] as const;
        let redactionIndex = 80;
        for (const payloadKind of ["content", "blocks"] as const) {
          for (const requestClass of redactions) {
            for (const payloadClass of redactions) {
              redactionIndex += 1;
              const operation = namedOperation(redactionIndex);
              const contentRef = `payload:redaction-content-${redactionIndex}`;
              const blocksRef = `payload:redaction-blocks-${redactionIndex}`;
              subject.seedOperation(operation);
              subject.seedPayload({
                ref: contentRef,
                content: "redaction content",
                redactionClass: requestClass,
              });
              if (payloadKind === "blocks") {
                subject.seedPayload({
                  ref: blocksRef,
                  content: '[{"type":"text","value":"redaction"}]',
                  mediaType: "application/json",
                  redactionClass: payloadClass,
                });
              } else {
                subject.seedPayload({
                  ref: contentRef,
                  content: "redaction content",
                  redactionClass: payloadClass,
                });
              }
              const candidate = terminalRequest({
                key: `redaction-key-${redactionIndex}`,
                operationId: operation.operationId,
                chatJid: operation.chatJid,
                contentRef,
                contentBlocksRef: payloadKind === "blocks" ? blocksRef : null,
                redactionClass: requestClass,
              });
              const result = await subject.store.commitTerminal(candidate);
              const compatible = requestClass === payloadClass;
              assert(
                result.ok === compatible,
                `${payloadKind} ${requestClass}/${payloadClass} exact redaction policy`,
              );
              if (!compatible) {
                assert(
                  !result.ok && result.error._tag === "storage_unavailable",
                  "redaction mismatch is bounded not_applied",
                );
                assert(
                  untouched(subject.inspectDurable(operation.operationId)),
                  "redaction mismatch leaves no durable state",
                );
              }
            }
          }
        }

        const malformed = [
          {
            suffix: "media-type",
            seed: {
              ref: "payload:bad-media-type",
              content: "bad",
              mediaType: "application/octet-stream",
            },
            expected: "storage_unavailable",
            blocks: false,
          },
          {
            suffix: "digest",
            seed: {
              ref: "payload:bad-digest",
              content: "bad",
              sha256: "0".repeat(64),
            },
            expected: "storage_unavailable",
            blocks: false,
          },
          {
            suffix: "length",
            seed: {
              ref: "payload:bad-length",
              content: "bad",
              byteLength: 99,
            },
            expected: "storage_unavailable",
            blocks: false,
          },
          {
            suffix: "blocks",
            seed: {
              ref: "payload:bad-blocks",
              content: "{not-json",
              mediaType: "application/json",
            },
            expected: "corrupt_state",
            blocks: true,
          },
        ] as const;
        for (const [index, item] of malformed.entries()) {
          const operationIndex = index + 40;
          subject.seedOperation(namedOperation(operationIndex));
          subject.seedPayload(item.seed);
          const request = namedRequest(operationIndex);
          assert(request.timeline.mode === "insert", "named request inserts");
          const candidate = item.blocks
            ? {
                ...request,
                timeline: {
                  ...request.timeline,
                  contentBlocksRef: item.seed.ref,
                },
              }
            : {
                ...request,
                timeline: { ...request.timeline, contentRef: item.seed.ref },
              };
          const result = await subject.store.commitTerminal(withHash(candidate));
          assert(
            !result.ok && result.error._tag === item.expected,
            `${item.suffix} rejected equally: ${result.ok ? "ok" : result.error._tag}`,
          );
          assert(
            untouched(subject.inspectDurable(`observer-operation-${operationIndex}`)),
            `${item.suffix} no-op`,
          );
        }

        const operationIndex = 50;
        subject.seedOperation(namedOperation(operationIndex));
        subject.seedPayload({
          ref: "payload:snapshot-blocks",
          content: '[{"type":"text","value":"original"}]',
          mediaType: "application/json",
        });
        const barrier = subject.blockPayload("payload:snapshot-blocks");
        const request = namedRequest(operationIndex);
        assert(request.timeline.mode === "insert", "snapshot request inserts");
        const pending = subject.store.commitTerminal(
          withHash({
            ...request,
            timeline: {
              ...request.timeline,
              contentBlocksRef: "payload:snapshot-blocks",
            },
          }),
        );
        const first = await Promise.race([
          barrier.started.then(() => "started" as const),
          pending.then((early) => ({ early })),
        ]);
        if (first !== "started") {
          throw new Error(
            `snapshot resolve ended early: ${first.early.ok ? "ok" : first.early.error._tag}`,
          );
        }
        subject.mutatePayloadBytes("payload:terminal-content", 120);
        barrier.release();
        const result = await pending;
        assert(result.ok, "snapshot commit");
        const terminal = subject
          .inspectDurable(`observer-operation-${operationIndex}`)
          .messages.find((message) => message.terminal);
        assert(terminal?.content === "terminal content", "content bytes snapshotted");
        assert(
          JSON.stringify(terminal.contentBlocks) ===
            '[{"type":"text","value":"original"}]',
          "block bytes snapshotted",
        );
      },
    },
    {
      name: "EF-S02-S06 exact trace matrix is redacted and reads are untraced",
      async run(fixture) {
        const run = async (
          request: CommitTerminalRequest,
          resultTag: string,
          certainty: NormalisedEffectTrace["certainty"],
          traceIdentity: {
            readonly effectId?: string;
            readonly operationId?: string | null;
            readonly version?: number | null;
          } = {},
        ) => {
          const before = fixture.inspectTrace().length;
          await fixture.subject.store.commitTerminal(request);
          const effectId = traceIdentity.effectId ?? request.effect.idempotencyKey;
          const operationId =
            traceIdentity.operationId === undefined
              ? request.effect.operationId
              : traceIdentity.operationId;
          const version =
            traceIdentity.version === undefined
              ? request.expectedVersion
              : traceIdentity.version;
          assert(
            JSON.stringify(fixture.inspectTrace().slice(before)) ===
              JSON.stringify([
                {
                  contract: "EF-S02",
                  method: "commitTerminal",
                  effectId,
                  operationId,
                  sourceSeq: null,
                  version,
                  certainty: null,
                  resultTag: "call",
                },
                {
                  contract: "EF-S02",
                  method: "commitTerminal",
                  effectId,
                  operationId,
                  sourceSeq: null,
                  version,
                  certainty,
                  resultTag,
                },
              ]),
            `exact trace ${resultTag}/${certainty}: ${JSON.stringify(fixture.inspectTrace().slice(before))}`,
          );
        };

        const applied = namedRequest(100);
        fixture.subject.seedOperation(namedOperation(100));
        await run(applied, "applied", "applied");
        await run(applied, "replayed", "applied");
        await run(
          terminalRequest({
            key: "observer-other-100",
            operationId: "observer-operation-100",
            chatJid: "web:observer-100",
          }),
          "already_terminal_conflict",
          "not_applied",
        );

        const version = withHash({ ...namedRequest(101), expectedVersion: 99 });
        fixture.subject.seedOperation(namedOperation(101));
        await run(version, "version_mismatch", "not_applied");

        const ownerBase = namedRequest(102);
        const owner = withHash({
          ...ownerBase,
          expectedChatJid: "web:wrong",
          timeline: { ...ownerBase.timeline, chatJid: "web:wrong" },
        });
        fixture.subject.seedOperation(namedOperation(102));
        await run(owner, "owner_conflict", "not_applied");

        const invalid = structuredClone(namedRequest(103));
        Reflect.set(invalid.effect, "idempotencyKey", "");
        await run(invalid, "invalid_request", "not_applied", {
          effectId: "invalid",
          operationId: null,
          version: null,
        });

        await run(namedRequest(104), "not_found", "not_applied");

        const missingBase = namedRequest(105);
        assert(missingBase.timeline.mode !== "none", "missing-media request writes timeline");
        const missing = withHash({
          ...missingBase,
          timeline: { ...missingBase.timeline, mediaIds: [999] },
        });
        fixture.subject.seedOperation(namedOperation(105));
        await run(missing, "missing_media", "not_applied");

        fixture.subject.seedOperation(namedOperation(106));
        fixture.subject.setFaultBehavior("before_effect", "true");
        await run(namedRequest(106), "storage_unavailable", "not_applied");
        fixture.subject.setFaultBehavior("before_effect", "false");

        fixture.subject.seedOperation(namedOperation(107));
        fixture.subject.setFaultBehavior(
          "effect_then_lost_acknowledgement",
          "true",
        );
        await run(namedRequest(107), "storage_unavailable", "unknown");
        fixture.subject.setFaultBehavior(
          "effect_then_lost_acknowledgement",
          "false",
        );

        const beforeReads = fixture.inspectTrace();
        await fixture.subject.store.getTerminal("observer-operation-100");
        await fixture.subject.store.getTerminalByKey("observer-key-100");
        assert(
          JSON.stringify(fixture.inspectTrace()) === JSON.stringify(beforeReads),
          "public reads are explicitly untraced",
        );
        assertTerminalTraceRedaction(fixture.inspectTrace());
      },
    },
  ]);

export const TERMINAL_SETTLEMENT_CONTRACT_CASE_NAMES = Object.freeze(
  cases.map((contractCase) => contractCase.name),
);

export async function defineTerminalSettlementStoreContract(
  factory: ContractSubjectFactory<TerminalSettlementContractSubject>,
  createContext: () => ContractTestContext,
) {
  return runParameterisedContractSuite(
    factory,
    cases,
    createContext,
    (subject) => subject.dispose?.(),
  );
}

export function assertTerminalTraceRedaction(
  trace: readonly NormalisedEffectTrace[],
): void {
  const encoded = JSON.stringify(trace);
  assert(!encoded.includes("protected"), "trace leaked protected ref");
  assert(!encoded.includes("payload:terminal-content"), "trace leaked payload ref");
}
