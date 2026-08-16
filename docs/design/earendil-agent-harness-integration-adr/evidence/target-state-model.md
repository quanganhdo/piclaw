# Target state, event and settlement model

Status: proposed architecture for the ADR decision.

The target uses two durable domains with explicit correlation:

1. Piclaw owns service acceptance, ordering, operation correlation, external delivery and terminal disposition.
2. Earendil Harness v3 owns its entry tree, current execution registers, usage ledger, tools/compaction state and resumable interpreter.

Piclaw does not recreate Earendil's execution interpreter or persist a duplicate harness journal. Earendil does not become the authority for external acceptance, timeline delivery or Piclaw terminal consumption.

## Identity hierarchy

| Identity | Owner | Lifetime | Purpose |
|---|---|---|---|
| `chatJid` | Piclaw | Chat/branch | Routing, authorisation and user-visible conversation |
| `sourceSeq` | Piclaw | Monotonic per chat | Canonical order for messages, steers, follow-ups, controls and cancellation intents |
| `operationId` | Piclaw | Accepted work operation | Exact service owner, terminal disposition and delivery correlation |
| `operationVersion` | Piclaw | Monotonic per operation | Compare-and-set fencing for intents and settlement |
| `sessionId` | Earendil | Durable harness session | Transcript and lane namespace |
| `lane` | Earendil | Session lane | Harness execution/tree branch |
| `runId` / Earendil `operationId` | Earendil | Prompt/compaction/navigation operation | Same durable Harness v3 operation identity; exact abort/resume target |
| `stepId` / attempt | Earendil | Durable step series | Retry, deferred and compaction correlation |
| projection receipt sequence | Piclaw web projector | One connection/watch generation | UI ordering and stale-callback rejection; not harness authority |
| `deliveryId` | Piclaw | One external delivery effect | Timeline/channel/log/notification idempotency |

The correlation table is durable:

```typescript
interface OperationHarnessCorrelation {
  operationId: string;
  operationVersion: number;
  sessionId: string;
  lane: string;
  harnessOperationId: string | null; // exposed publicly as runId
  harnessState: "not_started" | "running" | "suspended" | "aborting" | "finished";
  lastResultObserved: boolean;
  watchGeneration: number;
  lastProjectionReceiptSeq: number;
}
```

A Piclaw command with a stale `operationVersion` or mismatched Harness v3 operation ID returns a typed no-op before invoking Earendil. No fallback resolves "whatever is active".

## Piclaw accepted-source model

All external and trusted input uses one per-chat sequence.

```typescript
type AcceptedSourceKind =
  | "message"
  | "steer"
  | "follow_up"
  | "continuation"
  | "control"
  | "cancellation"
  | "scheduled_agent"
  | "internal";

interface AcceptedSource {
  chatJid: string;
  sourceSeq: number;
  sourceId: string;
  kind: AcceptedSourceKind;
  acceptedAt: string;
  targetOperationId: string | null;
  parentSourceSeq: number | null;
  payloadRef: string;
  provenance: SourceProvenance;
  state: "pending" | "claimed" | "consumed" | "disposed";
  dispositionReason: string | null;
}
```

Rules:

- `sourceSeq` is allocated in the same transaction as durable payload/timeline acceptance.
- A steer accepted during a run normally targets that exact Piclaw `operationId`.
- A follow-up can target the current operation for Earendil `followUp()` delivery or remain a Piclaw successor. Product semantics choose this at acceptance and persist the choice.
- Controls and cancellation are sources even when they produce no harness prompt.
- Trusted provenance changes authorisation, not ordering or durability.
- A source changes from pending to claimed once. It becomes consumed/disposed only through terminal settlement or an explicit owner-fenced disposition.

## Piclaw operation model

```typescript
type PiclawOperationPhase =
  | "accepted"
  | "claimed"
  | "starting_harness"
  | "executing"
  | "suspended"
  | "cancelling"
  | "settling"
  | "terminal";

type PiclawDisposition =
  | "completed"
  | "cancelled"
  | "failed"
  | "skipped"
  | "superseded";

interface PiclawOperationState {
  operationId: string;
  chatJid: string;
  version: number;
  phase: PiclawOperationPhase;
  primarySourceSeq: number;
  claimedSourceSeqs: number[];
  createdAt: string;
  deadlineAt: string | null;
  cancellation: null | {
    sourceSeq: number;
    cause: string;
    requestedAt: string;
  };
  harness: OperationHarnessCorrelation | null;
  terminal: null | {
    disposition: PiclawDisposition;
    terminalMessageRowId: number | null;
    errorCode: string | null;
    committedAt: string;
  };
}
```

The persisted operation log contains immutable intent/disposition rows plus a current projection. The projection is rebuildable from the log and may be updated transactionally for fast claims.

### Allowed service transitions

| Current | Event | Next | Required command |
|---|---|---|---|
| none | source accepted and eligible | accepted | enqueue wake outbox |
| accepted | claim succeeds | claimed | open/load harness lane |
| claimed | harness lane ready | starting_harness | append correlation intent |
| starting_harness | Earendil operation accepted | executing | persist returned Harness v3 `runId`/operation ID; start watch projection |
| executing | steer/follow-up accepted | executing | append source and deliver exact-run queue command |
| executing | Earendil suspended | suspended | persist harness snapshot/missing identities |
| suspended | resumable and owner valid | executing | call exact lane `resume()` |
| executing/suspended | cancellation accepted | cancelling | persist first cancellation; call exact-run abort |
| executing/suspended/cancelling | terminal candidate | settling | commit terminal transaction |
| settling | commit succeeds | terminal | append deliveries/maintenance wakes |
| any non-terminal | stale result | unchanged | record bounded diagnostic only |

## Earendil execution model

Harness v3 [`harness.md`](https://github.com/earendil-works/pi/blob/5f7195c51eac43cdf329f813a7ef020d7bd74527/packages/agent/docs/harness.md) is the authoritative target execution design. Released `0.84.1` remains implemented baseline evidence; draft PR #8076 at `fd389abc4677b4e0fa5dc9b2bbd2e63418f079b4` is current but incomplete development evidence. Harness v3 specifies:

- immutable `Entry` tree, mutable typed registers and append-only `UsageRow` ledger;
- `lane.state` naming at most one current operation;
- immutable `op.meta` and replaceable total `op.state` as the durable program counter;
- intent → process-local `EffectGate` admission → external effect → settlement around hooks, providers, tools and timers;
- direct `AgentHarness`/`AgentLane` operations whose public `runId` is the durable operation ID;
- tool replay through `effect_pending`, persisted effective args and `safe`/`never` declarations;
- compaction/navigation as first-class operations;
- cancellation as orthogonal durable control committed before signal pull;
- terminal transactions that delete `op.*`, clear the lane operation and write `lane.lastResult`;
- restart restore by bounded current-register reads and exact hydration, without history folding or a reducer;
- total storage-version migrations for current registers/open operations;
- per-lane mutation serialisation, backend writer leases and administrative precise rewrite.

Piclaw reads Earendil state through the exported harness/session/watch methods and `getLastResult()`. Recovery uses bounded selected-version point reads; it does not depend on private helpers or PR #7784's v2 `findRecords()` proposal. Piclaw does not mutate Earendil storage except through selected-version public contracts and does not persist duplicate Earendil operation records.

A live operation task and its `EffectGate` are process-local. They arbitrate local ownership and abort-versus-admission only. They disappear on process loss; durable `op.state` then drives activation recovery. Because no durable effect-start marker exists, a crash after admission but before settlement is an unknown outcome, not proof that the effect was absent.

## Harness events and Piclaw projection

Harness v3 specifies typed `HarnessEvent`, `HookMap`, `LaneSnapshot` and `SessionSnapshot` contracts. A watch atomically captures a snapshot and starts buffering; Piclaw sends the snapshot before calling `start()`, which flushes buffered events and then delivers live events without a registration gap.

Piclaw treats:

- `entry_added` as proof of durable transcript mutation;
- operation promise results and `lane.lastResult` as terminal execution authority;
- events as projection input that may contain sensitive content and must be redacted;
- snapshot/watch reconnection as the state-recovery mechanism, not process-event replay.

Harness v3 events have no durable event sequence, and cross-lane events are process ordered. Piclaw therefore creates a versioned **web projection DTO** with Piclaw operation ID, correlated Earendil operation ID, watch generation, receipt sequence and allowlisted public data. This DTO exists only for SSE/UI transport and cannot drive harness execution.

## Service commands

```typescript
type ServiceCommandV1 =
  | { v: 1; type: "wake_chat"; chatJid: string; frontier: number; idempotencyKey: string }
  | { v: 1; type: "open_harness"; operationId: string; expectedVersion: number; sessionId: string; lane: string }
  | { v: 1; type: "prompt"; operationId: string; expectedVersion: number; lane: string; inputRef: string }
  | { v: 1; type: "queue_input"; operationId: string; expectedVersion: number; expectedHarnessOperationId: string; sourceSeq: number; queue: "steer" | "followUp" }
  | { v: 1; type: "abort"; operationId: string; expectedVersion: number; expectedHarnessOperationId: string; cancellationSourceSeq: number }
  | { v: 1; type: "resume"; operationId: string; expectedVersion: number; expectedHarnessOperationId: string }
  | { v: 1; type: "settle"; operationId: string; expectedVersion: number; terminalCandidateRef: string }
  | { v: 1; type: "deliver"; deliveryId: string; operationId: string; channel: string; payloadRef: string }
  | { v: 1; type: "maintenance"; operationId: string; maintenanceKind: string };
```

Every command result is appended before the next transition. An `effect_may_have_happened` result triggers reconciliation by idempotency key or expected version. For Earendil-owned work, passing `EffectGate.assertOpen()` does not change that certainty: only durable settlement proves a harness result, and tool replay remains limited to the selected `safe`/`never` semantics.

## Atomic terminal settlement

One Piclaw SQLite transaction performs:

1. verify `operationId`, version and non-terminal phase;
2. verify the terminal candidate's correlated Harness v3 operation ID or authorised service-only terminal source;
3. insert the immutable disposition;
4. insert or bind the terminal timeline row and media references;
5. mark claimed source intents consumed/disposed with reasons;
6. advance the per-chat accepted-source frontier through consecutive terminally disposed sources;
7. release active operation ownership;
8. insert successor, delivery, notification and maintenance outbox intents;
9. increment operation version and commit.

If timeline/media storage cannot share the transaction, the operation enters `settling` with a persisted terminal intent and idempotency key. A reconciler completes the same protocol; no output is broadcast and no frontier is advanced before the terminal row is durable.

SSE and notifications run from outbox records after commit. Delivery failure cannot roll back operation completion. Duplicate delivery claims return the existing result.

## Cancellation model

Cancellation has two ordered stages:

1. Piclaw accepts a cancellation source against exact `operationId` and expected version. The first accepted cancellation wins.
2. Piclaw calls `abort()` on the correlated `AgentLane`; Earendil propagates its AbortSignal to owned `HarnessTool`/`ExecutionEnv` work.

Rules:

- missing/mismatched operations return `not_found`/`owner_mismatch` without calling the harness;
- repeated exact cancellation returns the stored cancellation/disposition;
- an Earendil `NoActiveOperation` result does not erase Piclaw cancellation; reconciliation determines whether the run finished first or was already aborted;
- late terminal harness output cannot replace a committed cancelled disposition;
- tool process groups receive the same abort signal and owner IDs;
- restart reads both Piclaw cancellation and Harness v3 `control.cancel_requested`/current-operation state before acting.

## Restart reconciliation

For each chat with non-terminal Piclaw work:

1. read the Piclaw operation/source projection and immutable log;
2. open the correlated Earendil session and obtain each relevant lane's public restored snapshot plus `getLastResult()` when idle; use bounded current-state reads and do not query history or v2 records;
3. compare Piclaw `operationId ↔ sessionId/lane/harnessOperationId` correlation;
4. classify one of the cases below;
5. append a Piclaw reconciliation event before issuing a command.

| Piclaw state | Earendil state | Action |
|---|---|---|
| claimed/starting | no run | safely start prompt with stored input/idempotency key |
| executing | same open run | resume/watch according to harness status |
| cancelling | same open run, not aborting | issue exact abort |
| cancelling | same run aborting | wait/reconcile |
| executing | run terminal, Piclaw not terminal | build terminal candidate and settle |
| terminal | open same run | abort/close as stale execution; never unset Piclaw terminal |
| non-terminal | different run | quarantine owner mismatch; operator/recovery policy decides |
| non-terminal | corrupt current registers/referenced entries | fail/quarantine according to selected harness fault semantics; no automatic unsafe mutation replay |
| source pending | no operation | claim in FIFO order and wake |
| `never` tool unresolved | open/suspended run | containment; do not replay; require result reconciliation or explicit disposition |

Steers/follow-ups exist in Piclaw accepted-source state and, after successful exact-operation delivery, in Harness v3 queue state plus `pending.entry`. Piclaw distinguishes accepted-but-undelivered from delivered. Restart reissues delivery only after the selected harness snapshot/state proves that the entry ID is neither pending nor consumed, under the documented idempotency policy.

## Replay record

A replay fixture contains:

```typescript
interface ReplayFixtureV1 {
  v: 1;
  name: string;
  piclawInitial: PiclawServiceSnapshot;
  earendilInitial: EarendilStorageSnapshot;
  inputs: ReplayInput[];
  injectedResults: EffectResult[];
  expected: {
    piclawLog: NormalisedServiceEvent[];
    earendilTransactions: NormalisedStorageTransaction[];
    earendilCurrentState: NormalisedHarnessState;
    commands: NormalisedCommand[];
    deliveries: NormalisedDelivery[];
    terminal: NormalisedTerminalState;
  };
}
```

Normalisation replaces timestamps and generated IDs with stable symbols while preserving equality and ordering relationships. Full model/tool text may be stored only in a secure fixture when necessary; ordinary golden fixtures use payload hashes and bounded public projections.

Replay runs at two layers:

1. the Piclaw service reducer consumes one service event and emits service commands;
2. service fakes or direct Earendil calls return results as service events;
3. the Harness v3 fixture advances through manual drive using the selected `ActionInfo`/effects surface;
4. an instrumented `Storage.commit()` records Earendil transactions while current registers/entries/usage remain the durable oracle;
5. repeat until both layers are quiescent;
6. compare Piclaw events/commands/deliveries plus Earendil transactions/current state and both terminal outcomes.

## Fault points

Every mutating command is tested with:

- throw before effect;
- effect then throw before acknowledgement;
- acknowledgement then crash before event append;
- duplicate command/result;
- delayed result after replacement;
- restart between each durable write;
- cancellation concurrent with completion;
- malformed/corrupt Harness v3 current register or referenced entry;
- unavailable model/tool identity;
- delivery success followed by completion-write failure;
- crash after `EffectGate` admission and before harness settlement;
- close while a live lane task owns an external effect;
- open-operation migration at every transaction boundary;
- precise rewrite racing a reader, writer, backup or restart.

The expected result is one disposition, no lost accepted source, no unsafe mutation replay and bounded reconciliation.

## Projection model

The web/client projection key is:

```text
(chatJid, operationId, harnessOperationId, watchGeneration, receiptSeq)
```

The server drops events from a mismatched Piclaw/Harness v3 operation correlation. The client drops an older watch/connection generation or non-increasing receipt sequence. A fresh `/agent/status` response includes the current Piclaw operation authority and correlated harness snapshot status. Presentation-only waiting/watchdog states never erase authority.

Terminal projection starts only after Piclaw settlement commits. Intermediate harness text can be shown as a draft but is not a terminal timeline row without a Piclaw commit result.

## Scheduler model

A due agent task becomes `scheduled_agent` accepted source with a task-run idempotency key. The scheduler owns:

- schedule claim and next-run calculation;
- one Piclaw operation;
- one timeline delivery intent;
- one run-log record;
- optional Pushover intent.

The harness owns only execution. It cannot write the timeline directly for scheduled runs. Shell tasks retain their existing execution/delivery semantics behind separate effectors.

## Safety properties

The reference model and contract suite assert:

- one active Piclaw operation per chat lane;
- source sequences never decrease or disappear;
- terminal implies one disposition and released owner;
- frontier never crosses pending/claimed source;
- cancellation cause is immutable;
- every Harness v3 operation is correlated to one Piclaw operation;
- stale/mismatched run result cannot settle;
- each delivery ID completes at most once;
- restored `effect_pending` tool work is re-executed only when persisted and current declarations are both `safe`;
- protected payload classes never appear in public projection;
- recovery and reconciliation commands are bounded;
- at most one process-local live task owns a lane, but durable open state survives its loss;
- effect admission never upgrades an unknown outcome to `not_applied`;
- selected session backends pass conformance, migration and rewrite-race contracts.
