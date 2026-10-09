# Pi 1.0.0 durable architecture and HC/PC crosswalk (#1493)

Rui approved this design on 3 October 2026: an isolated execution plane using experimental `@earendil-works/pi-durable@1.0.0`, with Piclaw retaining its service-effect authority. Pi-durable qualification, implementation and activation are explicitly out of the current scope. This assessment adds no durable dependency, importer, schema, registration or activation.

The active track remains adoption of mainline Pi 1.0.0 or a separately assessed subsequent update. #1494 and all other durable work require a new scope decision before they resume; they are not prerequisites for current-loop adoption.

The existing coding-agent loop migrated independently through [#1497](https://github.com/rcarmo/piclaw/pull/1497). Historical Harness and Pico3 evidence through 0.99.1 stays frozen. The old lane, Drive, Gate and operation-result APIs were removed; their semantic requirements are mapped below.

## Sources and evidence classes

Assessment baseline: Piclaw `d3c9e9b6b4983f467df8bfa6c9676e864dc5344e`, 2 October 2026. Published pi-durable `1.0.0` has gitHead `a13d35a742c6ef8462812a28fbe1d8c8b7431c32`. The [source receipt](receipts/earendil-100-durable-source.json) records registry archive integrity, published-file hashes and the spec identity. Inspection does not measure execution semantics.

The pinned [spec][spec] is 4,601 lines, Git blob `e30cc93687cd8dadf502b57688e8eeaddb097774`, SHA-256 `889acf45f5911f0d079e5a931701abe662dd6117f2bfddca71a85047f0e2ace3`. It was retrieved at the exact gitHead and compared byte-for-byte with the reviewed copy. The package does not ship `docs/spec.md`; tagged spec and npm archive are separate sources. Section numbers below refer to this spec, not upstream `main`.

| Class | Meaning here |
|---|---|
| Measured | Existing [Bun 1.4.2 probe](receipts/earendil-100-durable-paused-probe.json): public imports; paused Memory open/root/inspect; configure through one conversation watch frame; stop/close; zero provider calls and guarded network/child attempts. No fresh runtime execution here. |
| Documented | Pinned specification checked against published declarations/JavaScript. Fresh #1494 execution is required before acceptance. |
| Unsupported | An old primitive or required guarantee has no equivalent public contract. A host proposal does not make it supported. |
| Unverified | Integration invariant, fault case or runtime/storage behaviour without admitted 1.0.0 tests here. |
| Proposed | Future Piclaw design and fixture obligations requiring approval/implementation. |

The prior probe used a Bun preload guard, not an OS network namespace. It exercised no provider, JSONL or SQLite execution. Only observation and idle-close behaviour was measured; no HC or PC row is fully accepted.

## Replacement contracts

| Historical concept | 1.0.0 contract and consequence |
|---|---|
| `AgentHarness`, SessionRepo, Branch, AgentLane | `Harness.open(Storage, options, context)`; explicitly owned conversations, `fork()`, immutable entries and typed documents. Lazy root ID 1 is local to one store, never a global chat identity. |
| Current operation / operation result | Task checkpoints and terminal task outcomes; a run spans generations; submissions settle `done` or `unanswered`. No single replacement operation ID/result row. |
| Tagged lane inbox | `Conversation.submit()` and `pi.inbox`; `whenBusy: steer/followUp/reject`; conversation-scoped `requestId` deduplication. No `nextRun` mode. |
| Drive / permit / `Gate.admit()` | Paused open plus automatic scheduling; progress APIs also wake recovered work. No exported per-effect Gate or manual Drive. |
| Typed values/lists and usage rows | Typed JSON documents, immutable entries and `pi.usage` aggregates. Compaction spend can have no transcript entry. |
| Watch stub | Functioning snapshot-first watches and derived `watchEvents()`; more than 100 pending frames/batches coalesce to a snapshot. |
| Storage migration/fork protocol | Separate task, document and SQL-schema versions; public Memory/JSONL/portable SQLite. No admitted converter from old Harness/Pico3 formats. |

Relevant public exports are the root, `/env`, `/tools`, `/storage/memory`, `/storage/jsonl`, `/storage/sqlite` and `/testing`. Published JS paths below are provenance references; consumers must import exported paths only. `/storage/sqlite/node` is a Node adapter, not a Bun qualification result.

## Host authority and identity

The [service-effect contracts](../../../../runtime/src/service-effects/contracts/) retain their responsibilities. Legacy Harness correlation fields need a separately reviewed versioned migration; putting a task ID into `harnessOperationId` does not make it an equivalent operation identity.

| Boundary | Piclaw retains | Durable execution supplies |
|---|---|---|
| EF-S01 `ServiceWorkStore` | Authenticated source acceptance/order, request hash/idempotency, exact owner claim, cancellation fence, reconciliation | Submission/task identities and state to correlate after host acceptance |
| EF-S02 `TerminalSettlementStore` | Atomic disposition, timeline/media binding, source consumption/disposal, frontier, owner release and outbox intents | Committed submission/task outcomes and answer entries as evidence |
| EF-S05 `ServiceOutboxStore` | Delivery identity, leases, attempts, acknowledgement and ambiguous-send reconciliation | No delivery authority |
| EF-S07 `ScheduledRunStore` | Occurrence identity, claim, run log and completion | Outcome for the claimed agent occurrence; shell tasks keep their existing path |
| EF-S08 `AgentProjectionSink` | Exact owner, watch generation, receipt order, protected-field filtering and committed-terminal reference | Observations only; no durable delivery or terminal authority |

Proposed correlation keeps the Piclaw operation/run/attempt/generation and source sequence, a store-incarnation ID, conversation/submission IDs, relevant task IDs and answer-entry references. Durable numeric IDs are store-local. Several generation tasks can serve one run; none alone substitutes for the host operation. Host idempotency binds the immutable request hash and source identity. Upstream `requestId` rejects a change of submission type, but the host must also detect changed content under a reused key.

Piclaw may hold accepted-but-undispatched work. Once dispatched, the upstream inbox owns execution placement; Piclaw tracks source disposition without independently advancing a duplicate execution queue. Follow-ups can start a successor before host settlement. Until successor admission is proved authorised, keep follow-ups in the host acceptance queue and submit after the predecessor's EF-S02 settlement. `followUp` cannot implement a next-operation barrier by itself.

## Admission, recovery and cancellation proposal

1. Acquire exclusive host ownership before opening a disposable execution store. Recover the host log and bind owner/incarnation fences. SQLite transaction serialization alone cannot establish ownership of a Harness or its external effects.
2. Install reviewed definitions, resolve authorised model/credential scopes and deny-by-default effect capabilities. Open paused. Open can commit recovery normalisation (`running` to `pending`); it is not read-only, although no handler dispatches during open.
3. Reconcile with observation APIs only: `inspect()`, `getTask()`, `submission()`, `Submission.status()`, snapshots, usage, conversation reads/watches and task graph. Authorise every recoverable task/subtree that could run, not just the next message.
4. Complete EF-S01 acceptance and exact-owner binding before progress calls: `resume()`, conversation `submit()`/`compact()`/`abort()`, submission `wait()`, Harness `waitForTask()`/`waitForIdle()` and conversation `waitForIdle()`. These can wake unrelated recovered work in the same Harness. Viewers must not use them as status reads.
5. Keep effects denied until authorisation completes. There is no public per-task scheduling permit. If authorised and unauthorised work cannot be separated safely, stop at that qualification boundary; do not resume a mixed store. Separate store ownership domains are a design option, not implemented isolation.
6. Commit exact host cancellation before durable abort. `abortTask(id)` marks one task; conversation abort covers ordinary owned work, withdraws queued inputs and keeps queued writes. Neither identifies a whole host operation across successor generations. Fence successor dispatch and reconcile task ownership before selecting the target. `Submission.abort()` only withdraws queued work; placed work reports `already_placed`.
7. Cancelling a wait cancels only the wait. Task abort cascades bottom-up. Background subtrees lie outside ordinary idle/abort traversal unless explicitly included and require their own owner/budget/disposal policy. A `completing` outcome becomes terminal only after ordinary owned work drains.
8. Reconcile outcomes into EF-S02, then project through EF-S08 and deliver through EF-S05. Task completion, a lost frame or a detached observer cannot advance Piclaw's frontier.

Close seals admission/reservations, signals invocations, ends states/watches, drains admitted commits and joins task/tool/hook code before closing Storage (§2.2). It writes no task outcome. Non-cooperative code can keep close pending indefinitely; already-running watch callbacks remain caller-owned. Cancelling a close wait does not cancel shutdown. Reopen requires fresh handles. Retain host ownership until closure or a proven process-termination/reconciliation protocol completes; forced termination leaves uncertain external effects.

## Effects, policy and reload

- Public `Models` supplies model access. Piclaw must enforce scoped credentials, provider selection, privacy, quota and budget. Neither usage aggregates nor registry selection authorises spending. Credentials must not enter documents, requests, checkpoints, tool details or traces.
- Model/thinking/stream options are captured with a prepared request. Retry policy, compaction thresholds and queue modes are live settings (§2.2, §7.1). Attempts/deadlines are checkpointed; retry policy is not immutable. Provider-internal and durable-generation retries need separate budgets.
- Tool preparation checks the offered name/current schema, applies `beforeTool`, then commits final arguments and replay policy (§7.3). Recovery skips `beforeTool`. Replay permission/budget checks must also guard `execute()`/environment/provider boundaries; hooks alone cannot enforce them.
- Omitted replay is `unsafe`. Rerun requires stored **and** current `safe`; missing tools are unsafe. Other uncertain calls produce interrupted results from committed partial output. Classify each external effect's idempotency; never mark it safe merely to permit recovery.
- Intent → external effect → settlement leaves an unknown-outcome window (§5.2). Commit gating does not replace `Gate.admit()`. A signalled context cannot prove an uncooperative effect never started. HC-021 needs public-boundary race tests or an explicit architecture decision; no waiver is supplied here.
- Parallel tool results commit as each tool completes. Provider context and `afterTools` preserve call order; raw result entries do not. Host ordering cannot be inferred from completion arrival.
- Registry replacement is atomic by extension name, but active phases/calls retain captured code. Later phases resolve new code; missing custom task definitions block recovery. Removing a tool does not revoke a running call. Proposed reload fences dispatch/effects, drains or durably cancels work, replaces definitions and reauthorises recovery. Coding-agent/MCP whole-extension reload is a separate contract.
- Compaction produces a headed summary/write submission. Manual, foreground, background and overflow cases require authorisation/budget; stale summaries settle `unanswered/stale`. Reset/handoff can change input placement but cannot create a second service completion.

## Transactions, forks and storage

Session serializes commits. Table reads after table writes throw `ReadAfterWrite`; document drafts can observe their own changes (§4). External effects stay outside transactions. `StorageRejected` certifies rejection before durable effects; unknown failures after admission have uncertain commit state and are fatal. Inspect durable state rather than retry every exception.

Forks copy committed transcript ancestry and documents according to `initial`, `current` or `asOf` policy (§3.7). Live tasks/task documents do not fork; `pi.live`/`pi.inbox` start empty and usage starts at zero. Host source ownership, cancellation authority and delivery leases do not transfer. Pagination, incarnations and isolation need fresh tests.

| Mechanism | Documented boundary | #1494 evidence required |
|---|---|---|
| Memory | Detached reads/writes, reference semantics, no persistence | Public conformance and task/fork/watch fixtures |
| JSONL | Sidecars then main marker; torn final lines/unconfirmed tails removed; missing required confirmed data is corruption; uncertain append poisons backend | FileSystem faults, SIGKILL/reopen, corruption and retention |
| JSONL `fsync: true` | Flush sidecars before main marker. Ordinary commits do not explicitly flush `main.jsonl`; acknowledged tails can disappear. Flush main before destructive reclamation; failed flush defers reclamation. Main log initially uncompacted | Actual flush/append/reclaim order and growth. No measured process-crash or power-loss guarantee here |
| Portable SQLite | SQL transaction per Session commit; asynchronous `SqliteDatabase` | Approved Bun facade: queue unrelated operations/transactions, expire handles, finish rollback before rejection, distinguish rollback failure, drain before close; no Node execution |
| SQLite durability | Node adapter chooses WAL/`NORMAL`; this does not establish Bun behaviour or power-loss durability | Actual Bun settings, checkpoints, faults, reopen and resource cleanup |
| Ownership | One process per storage; no cross-process locking | Host owner transfer and stale-writer/effect fencing beyond database write locks |

Task migration happens at reservation with transition to running; missing/failed migration blocks work. Document migration is lazy/pure: reads migrate in memory, transactional typed access persists a new base; newer versions reject. SQLite schema migrations are separate contiguous transactions; 1.0.0 has only initial schema version 1 and rejects newer databases. None proves old-format conversion or crash-safe open-operation migration.

Qualification uses new disposable stores outside `messages.db`, live profiles and the archived 0.99.1 consumer. No in-place converter is proposed. Any later import needs a versioned copy/source manifest, rejection of unsupported live work, verification before switching and an untouched read-only original. Rollback fences the new writer and returns to the old format; never open new files with an old reader. External effects and source dispositions also need reconciliation; copying files cannot undo them.

## HC-001–HC-025 semantic crosswalk

The [historical catalogue](earendil-version-fixture-contract.md) supplies these 25 intents. Documented support requires fresh qualification. Unsupported old guarantees need explicit decisions; HC-025 remains partial. No row is a fresh full pass.

| ID | Original intent | 1.0.0 mapping and disposition | Missing qualification / host obligation |
|---|---|---|---|
| HC-001 | Simple prompt | Documented: submission, generation checkpoints/entries and submission outcome (§6, §8.3) replace operation result | Unverified: acceptance before provider, one answer and EF-S02 settlement |
| HC-002 | Tool prompt | Documented: committed intent, result entry and terminal task state (§7.3, §8.4) | Unverified: effect fault boundaries and host settlement |
| HC-003 | Parallel tools | Changed: raw results commit in completion order; live slots, `afterTools` and provider context preserve call order (§8.4–5; published `harness/context.js`) | Old source-order commit assertion unsupported; test both orders and projection |
| HC-004 | Safe replay | Documented: stored and current `safe`, stored arguments, no repeated `beforeTool` (§7.3) | Unverified: crash, declaration changes, idempotency and replay authorisation |
| HC-005 | Never replay | Documented replacement: default `unsafe` settles interrupted; no old reserved result-ID contract (§7.3) | Unverified: zero rerun, partial output and mutation containment |
| HC-006 | Steer | Documented: input submission/inbox selected at post-tools/final boundary (§6) | Unverified: exact owner, source order, placement once and recovery |
| HC-007 | Follow-up | Documented: successful final placement; failed run leaves inbox (§6) | Unverified: restart FIFO, predecessor settlement and successor authorisation |
| HC-008 | Next run | Unsupported exact mode; follow-up can automatically start successor (§6) | Proposed host withholding until EF-S02; explicit replacement approval |
| HC-009 | Abort | Documented: durable mark before signal, bottom-up drain (§5.4–5) | Unverified: late results, precedence, background scope and operation correlation |
| HC-010 | Compaction | Documented: task, headed summary and placement submission (§8.7) | Unverified: manual/threshold/overflow, stale summaries, failure/budget/cancel |
| HC-011 | Retry | Changed: prepared options captured, retry policy live, attempts/deadlines stored (§2.2, §8.3) | Captured-policy guarantee unsupported; test changes, restore and bounds |
| HC-012 | Suspension | Changed: waiting/deferred task checkpoints, inspect/blocked definitions (§5, §8.3) | No current-operation object; missing-ID, migration and wait-cancel cases unverified |
| HC-013 | Restore | Changed: live-task scans, running→pending, lazy documents and entry ancestry (§2.2, §10) | Old bounded value/list reconstruction unsupported; measure read costs and recovery |
| HC-014 | Corruption | Documented: invalid replay, missing confirmed data, unsupported versions reject (§3.6, §10–11) | Unverified: malformed references, torn-tail distinction, no silent repair |
| HC-015 | Session/Branch/lane isolation | Changed: conversations, ownership, documents/forks, reserved lazy root (§2.2, §3.7) | No-main-lane assertion inapplicable; store-local identity/fork isolation unverified |
| HC-016 | Close | Documented: seal, signal, drain/join, no task outcome (§2.2) | Measured paused close only; active/non-cooperative work, callbacks and reopen unverified |
| HC-017 | Deterministic drive | Unsupported manual Drive; automatic scheduler, injectable clock but real sleeps (§5.4) | Proposed controlled providers/effects/storage barriers; reproducibility unverified |
| HC-018 | Hooks/events | Documented typed hooks and bounded snapshot-first watches (§7.2, §9) | Measured one configure frame only; replay, overflow/reconnect/disposal unverified; no delivery receipt |
| HC-019 | Usage | Changed: atomic aggregates; compaction spend may lack entry; fork starts zero (§8.6) | Immutable `UsageRow` unsupported; retry/error/abort sums and budget checks unverified |
| HC-020 | Deferred provider | Documented handle/deadline checkpoint and abort cancellation (§8.3) | One poll per resume unsupported; test repeated polling, lineage, crash and close versus abort |
| HC-021 | Effect admission | Unsupported `Gate.admit()`; commit gating/cooperative context (§5.2–4) | Race/effect-start guarantees unverified; host guard or approved requirement revision |
| HC-022 | Effect-start crash | Documented effect sandwich, safe rerun/unsafe interrupted, request resend/handle poll (§5.2, §7.3, §8.3) | Unknown external outcome; SIGKILL/fault matrix and per-effect reconciliation |
| HC-023 | Drive/host ownership | Unsupported Drive/cross-process owner primitive; local scheduler (§5.4; README Storage) | Host store/effect fences and process replacement unverified |
| HC-024 | Storage migration | Documented task/doc/schema migrations; SQL version 1 (§3.6, §5.4; published `storage/sqlite/migrations.js`) | No old-format/open-operation converter; totality, crashes and rollback unverified |
| HC-025 | Backend/fork parity | Partial: public stores/conformance/forks documented (§3.7, §10–11); stores are no longer missing exports | No measured JSONL/Bun SQLite parity, streaming-fork equivalent or cross-process writable host-authority receipt |

## PC-001–PC-020 host crosswalk

All successor PC integrations are **proposed and unverified**. Existing service-effect tests and historical receipts do not execute a pi-durable host path.

| ID | Host requirement retained | New execution connection | Required fixture / acceptance boundary |
|---|---|---|---|
| PC-001 | Ordinary accepted message | EF-S01 source/owner → input submission | Crash around submit; immutable request correlation; acceptance before provider |
| PC-002 | Exact steer | EF-S01 exact operation/source → `whenBusy: steer` | Race completion/successor; never steer replacement operation |
| PC-003 | Stale steer | Reject before progress API | Zero submit/effect; explicit owner-mismatch disposition |
| PC-004 | Exact cancellation | Host cancel commit → exact task/owned scope abort | Fence successor/effects; one disposition |
| PC-005 | Stale cancellation | Reject stale correlation before abort | Replacement untouched even in same conversation |
| PC-006 | Late completion after cancellation | Observe answer; EF-S02 applies cancellation precedence | One cancelled disposition; no late success/frontier/delivery |
| PC-007 | Terminal commit fault matrix | Outcome → atomic EF-S02 transaction | Fail before/after commit; no partial media/source/frontier/owner/outbox change |
| PC-008 | Restart with open run | Paused inspect/submissions/tasks/entries + host log | Authorise all recovery; no duplicate prompt/tool/delivery across stores |
| PC-009 | Pending steer restart | Host source + inbox/submission identity | Accepted FIFO; reconcile queued/placed/done/unanswered once |
| PC-010 | Protected hand-off | Tool control/reset + host successor claim | One successor after settlement; no tool-free false success |
| PC-011 | Mutation containment | Unsafe interrupted result → host containment | Effects denied until settlement/operator decision, including replay/reload |
| PC-012 | Scheduler agent task | EF-S07 → EF-S01 → submission; EF-S02/05 delivery | One run log/timeline delivery and optional notification under retry |
| PC-013 | Scheduler shell task | Keep existing shell path | Unchanged shell/Pushover semantics; no new delivery owner |
| PC-014 | Stale SSE generation | Watch → EF-S08 owner/generation filter | Drop old callback/frame, accept fresh snapshots without stale mutation |
| PC-015 | Mobile Abort | Fresh host identity validated server-side | Completion/successor race, one cancellation |
| PC-016 | Protected evidence | Allowlisted EF-S08 DTOs/traces | No raw args/results/credentials/internal payload in logs/events/exports/telemetry |
| PC-017 | Maintenance failure | EF-S02 terminal precedes maintenance | Compaction/watch/close/cleanup cannot undo terminal or repeat delivery |
| PC-018 | Trusted internal input | Same EF-S01 sequence/hash before submit | No internal bypass of owner, budget or acceptance |
| PC-019 | Cross-session steer | Durable exact-target acceptance before acknowledgement | Retry/dedup/wrong-owner/offline cases; no premature acknowledgement |
| PC-020 | Goal/checkpoint race | Source disposition plus task/submission reconciliation | Late steer consumed/carried/disposed once; no skipped accepted work |

## Future qualification gates — work out of scope

Rui's 3 October design approval does not start these work packages. They remain future requirements, including the unverified and unsupported classifications above.

1. Before resuming, Rui must bring durable work back into scope and resolve the remaining unsupported guarantees, especially HC-003/008/011/013/017/019/020/021/023/024. Design approval does not turn those requirements into passing evidence.
2. #1494 uses Bun-only public APIs, synthetic models/tools, disposable stores and the controlled test runner. Use network denial, effect/provider counters, controlled commit barriers and watchdogs. Preserve failed/aborted runs. No live credentials, production stores or deployment.
3. Run fresh Memory/JSONL/approved Bun SQLite conformance with unique cases and separate backend counts. Qualify migrations, forks, watches, cancellation, replay, missing definitions, effect uncertainty, owner replacement and resources. Process-crash and power-failure evidence stay separate; HC-025 needs writable host-authority proof.
4. Implement versioned EF-S01/02/05/07/08 correlation and host-effect fences only after explicit authorisation to resume durable implementation. Run every PC race/fault row. Upstream atomicity or watch convergence cannot replace host tests.
5. Production installation/activation/canary/soak/rollback execution need separate authorisation. Current-loop auth/MCP/Delegate gates under #1495/#1458/#1449–#1451/#1455–#1456 stay independent. MCP adapter remains default, codemode defaults Auto and no native capability/security waiver follows here.

## Documentation validation

The candidate at frozen tree `5fe8fd7aa713ad5a0e44926650e9724e40a2fc67` passed `make ci-fast` on 2 October 2026: 5,920 current-runtime tests, eight existing skips, zero failures; 25 feature tests and nine web checks. The separate frozen 0.99.1 consumer passed 468 tests and 8,720 assertions across 45 files. These are repository regression results, not pi-durable behavioural qualification.

All five typecheck stages passed with the unchanged 95-diagnostic compose baseline. Final pack hygiene checked 24,746 files. Structural checks verified 25 unique ordered HC rows, 20 PC rows, 80 local links, table/fence shape, archive/spec/probe hashes and 17 published-file byte comparisons. Independent read-only crosswalk and index reviews found no blocking source issue; they grant no architecture approval. An earlier broad review timed out and supplied no approval.

Two earlier full attempts failed and remain recorded separately. The first passed the current/feature/web stages, then a historical 50 ms process-timeout fixture captured no PID output and failed its cleanup precondition. Its unchanged isolated 45-file replay subsequently passed. The second hit the current EF-S07 fault-matrix test's 5-second timeout at 5,626 ms; the unchanged isolated suite plus production-boundary tests passed 20 tests and 301 assertions, with that case taking 3,563 ms. No archive, source assertion or timeout changed. The final complete run passed without combining those partial runs.

The final full log is `/workspace/tmp/1493-durable-crosswalk/ci-fast-final.log`, SHA-256 `984d3ab5e0e31311e9baa048da45bd581f2dbc7c7cb5da8d5f8318911bcf45b5`; earlier logs are `ci-fast.log` and `ci-fast-retry.log` in the same directory. Only this validation text was added after the frozen full gate; structural/source checks were repeated afterward.

[spec]: https://github.com/earendil-works/pi/blob/a13d35a742c6ef8462812a28fbe1d8c8b7431c32/packages/durable/docs/spec.md
