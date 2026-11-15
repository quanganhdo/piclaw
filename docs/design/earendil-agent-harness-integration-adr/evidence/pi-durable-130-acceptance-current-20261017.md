# Historical #1650 incremental acceptance evidence

The [19 October 45-row assessment](pi-durable-130-acceptance-current-20261019.md)
supersedes this page's current-state claims and older CI totals. The dated
implementation, failure and publication receipts below remain historical evidence.

The published source at `bda68d523` selects the public durable engine and includes
native card side prompts. Existing-chat migration, live-provider/fleet acceptance,
capped execution and production-scale resource qualification are incomplete.

The current integrated receipts are 633 native tests / 7,983 assertions (exit 0)
and 7,342 root tests / 74 baseline skips, plus 25 feature and 9 build tests (exit 0).
The production legacy side-prompt runner is retired; its compatibility implementation
lives only in test helpers. The native side consumer preserves isolated tools,
streaming, cancellation, timeout, accounting, parent/work identity and completed
retry lookup. Empty-history requests and enabled caps fail closed.

The 45-row assessment below retains conservative qualification levels. Recent
source-backed proofs update the affected rows; synthetic tests do not establish
fleet acceptance. Historical receipts and implementation detail follow the matrix.

## Native Delegate standard-tools candidate

The actual default factory supports explicit `tools: "standard"`: exactly seven
existing guarded Linux registrations, `read`, `bash`, `edit`, `write`, `find`,
`ls`, `grep`, captured before add-ons are appended. Omitted tools and `read_only`
retain four readers (`read`, `grep`, `find`, `ls`); comma-separated exact names
select subsets of the seven. `full`, unknown names, recursive Delegate, Plan,
Code Review and MCP/add-on tools are not qualified and reject.

Hook-free, section-free child extensions accept only approved registration objects
by membership check. Child `AgentDoc` `tools`, `modelTools` and selected extensions
are configured atomically. Existing owner/source/model/cap checks apply per request
and at effects. Approved absolute paths follow the same single-user parent host
policy; no sandbox, new permission framework or root ToolContext emulator is added.
Cancellation cannot reverse already-admitted writes. SDK unsafe child-tool replay
handling supplies no exactly-once write guarantee. Standard-specific crash/reopen
is unqualified; existing native/deadline tests keep their separate scopes.

`delegate-standard-tools-checkpoint.md` records actual factory cases: standard
writes/readback (43 assertions), read-only denial with unchanged bytes (43), and
standard cap revocation after child source capture with no filesystem write (38).
Retained native Delegate has 33 assertions; reader cap/provider revocation has
48 each. Focused tests pass 25 / 276 assertions and all three scoped typechecks
pass. `delegate-standard-full-candidate.log` passes 525 tests / 7,501 assertions,
exit 0. `delegate-standard-full-root.log` passes 7,312 tests, 74 baseline skips,
plus 25 feature and 9 build tests, exit 0.

All 45 statuses stay 22/17/3/3. Images/renderable binary attachments, full MCP/add-on
profiles, numeric global parallelism and native capped accounting are unqualified;
enabled caps still deny. Selected-auth/live-provider and public root SDK limits,
including exact-running cancellation, keep their existing boundaries. All-nine
Code Review stays core `4e1ffe2fe` / add-on `d1ce8c6f`, PR #208; no new worker.
Migration stays last, with no live activation or version/pin changes. This refresh
changes documentation only: no code, tests, CI, network, services or commits.

## Published attachment/WAL local qualification — `1241cdde0`

The attachment/WAL slice over `b258ff3a2` is published at `1241cdde0`.
Its completed local receipts predate the standard-tools candidate; exact-source
hosted evidence is separate. The actual helper and default factory admit 0..10 explicit workspace text files under approved
read-only policy, with a 100,000-byte aggregate limit measured from actual reads.
Empty `files: []` performs no attachment IO. Images/renderable binary attachments
remain unsupported; the bounded standard-tools candidate has separate evidence
above. Attachment and empty-list source reviews are READY. No future source hash
is assigned.

Two external instrumented runs measured 20 body COMMIT calls at 1.959 / 2.442
seconds, 99.4% / 99.5% of public adapter transaction time, not total test time.
Both failed the unchanged 5,000 ms limit. There is no syscall trace or fsync proof.
The fresh separate candidate used default DELETE by source/default inference;
PRAGMAs were not measured by that observer. Production initialises its shared
root with WAL. `baseline-sqlite-timing.md` records the measurements and limits.

`Q/src/sqlite-fixture-policy.ts` now aligns only these component fixtures to WAL.
The copied host uses existing `enableSqliteWal`, preserving its busy timeout;
the candidate uses public adapter SQL. Both require `synchronous=FULL` (2) before
setup, explicitly set FULL and verify 2 afterwards on every open/reopen.
Production constructors and journal helpers are unchanged. No NORMAL/OFF policy,
tmpfs, reduced assertion or increased timeout was used. The historical two-file
fixtures remain separate; actual one-database application qualification has
separate existing tests. This repair adds no shared-schema atomicity claim.

- New policy tests: 2 pass / 18 assertions (`wal-policy-test.log`), covering WAL
  sidecars, FULL, busy timeout, transaction rollback and physical reopen.
- Runtime: 54 pass / 477 assertions, maximum case 2.89 seconds
  (`wal-runtime-test.log`); sequential bindings: 9 pass / 74 assertions
  (`wal-bindings-test.log`).
- Unchanged rollback-journal `sqlite.test.ts` plus new policy tests: 35 pass /
  273 assertions (`wal-sqlite-conformance.log`). All three scoped typechecks pass
  (`wal-types-*.log`); FULL fixture-policy source review is READY.
- Actual add-on graph also uses `openWalFixtureDatabase`;
  `wal-addon-graph-focused.log`: 4 pass / 150 assertions across 3 files.
- `attachments-final-candidate.log`: 517 pass, 0 fail, 7,427 assertions across
  44 files, 266.49 seconds, `EXIT_CODE=0`.
- `attachments-final-root.log`: 7,312 pass / 74 skip / 0 fail, plus 25 feature
  and 9 build tests; normal `make` completion. The outer wrapper was interrupted;
  no exit-code receipt exists, so root `EXIT_CODE=0` is not established.
- `attachments-final-{engine,qualification,root}-types.log`: all three pass.
- These receipts establish no power-loss guarantee, additional SIGKILL coverage
  or production performance acceptance. The failed pristine-host-image
  optimisation was reverted; its old checkpoint describes abandoned code.
  No additional optimisation setup is retained.

All 45 statuses stay 22 source-qualified / 17 fixture-only / 3 blocked-publicAPI /
3 migration/perf-unverified. Images, tools beyond the bounded standard profile,
native capped accounting, numeric global concurrency and production performance
are unqualified. Migration stays last. Local receipts are under `/workspace/reviews/durable-1650/`; see
`wal-fixture-policy-checkpoint.md` and `attachments-publication-doc-checkpoint.md`.
The old hold in `attachment-wal-doc-checkpoint.md` is HISTORICAL and superseded.

## Source and evidence boundary

- Worktree: `/workspace/tmp/durable-1650`; published HEAD `1241cdde0`, with uncommitted standard-tools source/tests and documentation. Attachment/WAL receipts below predate that candidate. `delegate-files-final-focused.log` records 21 pass, 0 fail, 257 assertions after the empty-list no-IO fix; the prior 20 / 238 receipt predates it. Actual-default `native-delegate-files` passes 1 / 38 assertions: one of two children receives text, the other does not, and the parent model is unchanged. All three scoped typechecks pass; bounded source and empty-list reviews are READY. Historical pre-policy failures remain: initial candidate512/3timeouts (515 cases), later candidate510/5timeouts (515 cases), root7311/1note-indexing failure (74 skips). An unchanged b258 baseline reproduces one held-intent timeout; this does not qualify attachments. These failures are historical; final attachment/WAL qualification above supersedes their hold. Historical receipts: `/workspace/reviews/durable-1650/delegate-text-qualification-hold.md`.
- Explicit models are published at `b258ff3a2`. `delegate-explicit-current-tests.log` records 43 pass, 0 fail, 167 assertions across two files, including 13 actual-default explicit cases and different-model child B revocation checks. All three `delegate-explicit-{root,engine,qualification}-types.log` checks pass after the fixture's `unknown` JSON type was corrected. The initial test failure used a wrong `DURABLE_CODE_REVIEW_ROOT` source hash; no assertions or policy were weakened. Full candidate510/7292 and simplified root7312+25+9 complete normally; outer exit receipts were interrupted. Earlier timeout failures remain recorded.
- Scheduler overrides are published at `e3d248a01`, with candidate 493 / 7,255 and root 7,312 + 25 + 9 passing, exit 0. Current actual native-scheduler receipt is 1 pass / 73 assertions; mixed focused qualification is 96 pass / 2,477 assertions and all three scoped types pass. Bounded source review is READY, without a direct approval-revocation-during-await test or complete revocation matrix. No future source hash is assigned.
- Published deadline qualification is 17 pass / 202 assertions across two files (`deadline-memo-final.log`); its prior actual-default `native-delegate-timeout` receipt is 1 pass / 35 assertions (`native-delegate-deadline-checkpoint.md`). Deadline final candidate 492 / 7,245 and root 7,312 + 25 + 9 pass with exit 0.
- CI fix `98e0676af` separates historical fixtures at `de92bc95b5b3bb1505beec9617d3b8a5e4fa92d3` (`DURABLE_ADDONS_ROOT`) from native Code Review at `d1ce8c6f2e5ea6d5330728aa8a6a3684bf5c3d4f` (`DURABLE_CODE_REVIEW_ROOT`) in separate checkouts. Previous hosted core failures came from source-hash mismatch; exact-head `98e0676af` hosted status is green (run `39086238913`). The supplied exact-head `b258ff3a2` PR check returned `statusCheckRollup: []`; no hosted run is established for that head. The older green run supplies no later-head CI evidence. No query ran during this documentation refresh.
- Add-on PR #208 source and qualification CI checkout select `d1ce8c6f2e5ea6d5330728aa8a6a3684bf5c3d4f`. All nine model-tool actions are admitted. The exact previous all-nine receipt records 206 add-on passes with 3 skips, 485 candidate passes / 7,182 assertions and 7,294 root passes plus 25 feature and 9 build passes, root exit 0. These are historical Code Review receipts, separate from published deadline/scheduler results and final attachment/WAL qualification. Earlier 485-candidate / 7,312-root + 25 feature + 9 build passes belong to the older local-write source. Exact-head hosted qualification is separate. Published Delegate `ea2d1416e`, its documentation `7150dd6a2` and supplied green hosted run `39073316535` retain their earlier boundaries.
- The old stashed Delegate/Code Review work and refusal checkpoints do not qualify this implementation. Older uncommitted Delegate WIP stays separate and unapproved. The actual default factory admits the bounded installed Delegate profile and native Code Review reads/local mutations below.
- `runtime/src/runtime.ts` acquires strict ownership. `runtime/src/runtime/bootstrap.ts` supplies `prepareApplicationBackend` by default and loads the fixed `runtime/durable-engine/src/default-application-runtime.ts` entry before AgentPool/WebChannel. Missing candidate dependencies fail explicitly; there is no production legacy fallback. Statements that production registration or default selection are absent are obsolete.
- The private engine still owns isolated Pi/Chord 1.3.0 pins and its lock. The root package still uses Pi 1.2.0 host definitions/model services. Source default adoption does not establish distributed-package installation or live activation. No fleet rollout, installed-package replacement, live provider acceptance or service restart is recorded here.
- The default supports Linux/single-user policy, fresh durable history and validated durable reopen. Legacy session files, old message history and unverified storage provenance fail preflight before model/SDK construction. Existing chats must retain their original chat/branch/session identities; fresh-chat success does not meet that migration obligation.
- Requirements: [original 25 HC / 20 PC crosswalk](earendil-100-durable-crosswalk.md) and [acceptance plan](../06-acceptance-plan.md). Historical Lane/Drive/Gate contracts are semantic obligations, not available 1.3.0 APIs.

Paths in the table are repository-relative: `E/` = `runtime/durable-engine/src/`; `A/` = `runtime/src/agent-pool/`; `Q/` = `qualification/pi-durable-130/`; `RT/` = `runtime/test/`; `SE/` = `RT/service-effects/`. Each filename is an exact path under that prefix. Local receipt/checkpoint filenames in later sections are under `/workspace/reviews/durable-1650/`.

| Status | Scope | Rows |
| --- | --- | ---: |
| source-qualified | Application source composes the named path; existing tests qualify only the stated subset. Wider assertions and live acceptance still need evidence. | 22 |
| fixture-only | Selected semantic/component fixtures exist; the full requirement has no qualified application path or matrix. An explicit missing case is not a pass. | 17 |
| blocked-publicAPI | The selected public API lacks exact conditional running-task cancellation. | 3 |
| migration/perf-unverified | Copied recovery/import/backend evidence does not qualify existing-chat cutover, general compatibility or resource bounds. | 3 |

## Current 45-requirement assessment

This is the single current HC/PC table. The [earlier acceptance report](pi-durable-130-current-acceptance.md) retains historical evidence only.

| ID | Original requirement | Status | Exact source / existing test evidence | What remains |
| --- | --- | --- | --- | --- |
| HC-001 | Simple prompt | source-qualified | `E/default-application-runtime.ts`, `E/application-bootstrap.ts`; `Q/default-application-runtime.test.ts`, `Q/application-web.test.ts` | Actual default synthetic HTTP acceptance→answer→EF-S02/reopen works; live authenticated providers and rollout are unverified. |
| HC-002 | Tool prompt | source-qualified | `E/host-builtins.ts`, `E/host-plan-tool.ts`, `E/host-delegate-tool.ts`, `E/host-delegate-files.ts`, `E/host-code-review-tool.ts`; `Q/host-builtins.test.ts`, `Q/host-grep.test.ts`, `Q/host-delegate-tool.test.ts`, `Q/host-delegate-files.test.ts`, `Q/default-application-runtime.test.ts` | Seven Linux host builtins, approved Plan, bounded native Delegate with inherited or explicit exact approved models, workspace text attachments and explicit guarded standard tools (full local gates passed), and all nine source-bound Code Review actions, including synchronous assigned-item `work`, are admitted. Operator/browser dispatch queue/delivery through durable ingress, general SSH/MCP/add-on tools, family policy and full installed parity are unqualified. |
| HC-003 | Parallel tools | fixture-only | `Q/tools.test.ts`; ordering obligation in `earendil-100-durable-crosswalk.md` | Preparation/results do not prove completion-order raw commits versus call-order context/projection. No dedicated candidate ordering oracle. |
| HC-004 | Safe replay | fixture-only | `E/host-tools.ts`; `Q/tools.test.ts` | Explicit safe-policy tests do not supply crash/redeclaration/idempotency/replay-authorisation matrix. Default host builtins remain unsafe. |
| HC-005 | Never replay | fixture-only | `Q/sqlite.test.ts`, `Q/bash-port.test.ts` | Selected executing unsafe calls do not rerun on reopen; arbitrary external mutation/unknown-outcome reconciliation needs per-effect policy. |
| HC-006 | Steer | source-qualified | `A/durable-queued-steering.ts`, `E/host-recovery.ts`; `Q/accepted-steer-recovery.test.ts`, `RT/channels/web/input-source-admission.test.ts` | Exact host operation/source and selected recovery work; exact physical-generation steering and arbitrary crash placement are unproved. |
| HC-007 | Follow-up | source-qualified | `A/durable-queue-dispatch.ts`, `E/application-bootstrap.ts`; `RT/channels/web/runtime/queued-followup-lifecycle-service.test.ts`, `Q/application-web.test.ts` | Existing queue/UUID/FIFO/worker wiring is present; complete successor authorisation/FIFO across every route and restart is unqualified. |
| HC-008 | Next run | source-qualified | `A/durable-queue-dispatch.ts`; `SE/service-work-store-contracts.test.ts`, `Q/worker-recovery.test.ts` | Host settlement/worker barrier replaces the absent public `nextRun`; all producer/restart barrier cases and full replacement-contract acceptance are unproved. |
| HC-009 | Abort | blocked-publicAPI | `E/host-runtime.ts` `cancelInput`; `Q/runtime.test.ts` | No atomic public conditional exact running abort; placed input returns `already_placed`. Host cancellation fences publication but does not stop that task. |
| HC-010 | Compaction | source-qualified | Default-factory manual summaries use exact maintenance-task scope and the existing request ledger. Known usage settles; unknown usage retains its hold. Public completed-task evidence repairs interrupted bookkeeping; one paused manual task can be explicitly adopted. Actual factory/reopen and candidate633/root7342 evidence qualify these bounded paths. Multiple maintenance candidates, terminal tasks with pending writes and arbitrary process-crash adoption remain unqualified; see the 2026-10-18 maintenance appendices. |
| HC-011 | Retry | fixture-only | `E/default-application-runtime.ts` disables retry; `Q/models.test.ts`, `Q/src/fixture.ts` | No full captured-options/live-policy/restart-deadline/budget matrix; historical captured retry-policy guarantee changed. |
| HC-012 | Suspension | fixture-only | `E/host-runtime.ts` `wait`/`reconcile`; `Q/runtime.test.ts`, `Q/models.test.ts` | Detached observation and selected deferred cases do not qualify all missing definitions, task migrations or background scopes. |
| HC-013 | Restore | migration/perf-unverified | `E/host-controller.ts`, `E/host-recovery.ts`; `Q/single-database.test.ts`, `Q/cross-store.test.ts`, `Q/accepted-steer-recovery.test.ts` | Selected disk/process recovery works; bounded 100/1,000/2,000-entry read measurements exist below. Production-history costs and arbitrary recovery graphs are unqualified. |
| HC-014 | Corruption | fixture-only | `Q/migration.test.ts`, `Q/copied-upgrade.test.ts`, `Q/sqlite.test.ts` | Import/public-document/facade rejection tests do not cover the full durable reference/version/torn-tail/corruption matrix. |
| HC-015 | Session/Branch/lane isolation | source-qualified | `E/default-application-runtime.ts`, `E/session-tree.ts`; `Q/db-tree.test.ts`, `Q/default-application-runtime.test.ts` | Canonical public routing/identity and copied forks are bounded; full installed multi-chat authority-domain/branch mutation parity is unqualified. Root ID 1 is store-local. |
| HC-016 | Close | source-qualified | `E/application-bootstrap.ts`, `runtime/src/runtime/shutdown.ts`; `Q/host-controller.test.ts`, `RT/runtime/queue-backstop-ownership.test.ts` | Stop/join/close and uncertain-cleanup ownership are wired; non-cooperative callbacks can prevent completion indefinitely. Process death is separate from power loss. |
| HC-017 | Registry/effect ports | source-qualified | Default source uses seven guarded Linux built-ins, native Plan, parallel Delegate, shared-database Code Review, editable tables, Office Viewer, Draw.io and MCP/codemode adapters. The card HTTP side-prompt consumer runs isolated native tools under its own accepted-source authority; production legacy side runner removed. Catalogue/provenance guards and unsupported-tool denials remain. Full installed fleet/add-on compatibility is not established by these bounded source consumers. |
| HC-018 | Hooks/events | source-qualified | `E/host-plan-prompt.ts`, `E/host-projection.ts`; `Q/default-application-runtime.test.ts`, `Q/projection.test.ts` | Native Plan request hook and bounded watches work; general extension reload/hooks and browser delivery acknowledgement are unqualified. |
| HC-019 | Usage/quota/backoff | fixture-only | Uncapped foreground, Delegate, scheduled, maintenance and card side requests use existing per-request accounting and retain unknown holds. Side retries preserve literal work IDs/parent lineage and completed results without redispatch. Enabled caps still deny execution; provider-unknown reconciliation and live quota/backoff behaviour remain incomplete. |
| HC-020 | Deferred provider | fixture-only | `E/host-models.ts`; `Q/models.test.ts` | Selected synthetic handle/fetch/cancel/recreated-bridge cases do not prove persistent live-provider handle authority, polling/deadlines/lineage. One poll per resume is no public guarantee. |
| HC-021 | Effect admission | source-qualified | `E/host-builtins.ts`, `A/host-grep.ts`, `A/host-tool-process.ts`; `Q/host-builtins.test.ts`, `Q/host-grep.test.ts`, `Q/bash-port.test.ts`, `Q/models.test.ts` | Actual filesystem/spawn boundaries are guarded for selected ports. No general Gate/zero-effect guarantee; accepted provider microtask race is separate from exact-abort API gap. |
| HC-022 | Effect-start crash | fixture-only | `Q/cross-store.test.ts`, `Q/accepted-steer-recovery.test.ts`, `Q/bash-port.test.ts` | Fixed post-boundary SIGKILL/unsafe reopen evidence does not resolve arbitrary surviving children or external unknown outcomes. |
| HC-023 | Drive/host ownership | source-qualified | `runtime/src/runtime.ts`, `runtime/src/runtime/single-instance.ts`, `E/application-bootstrap.ts`; `RT/runtime/queue-backstop-ownership.test.ts`, `Q/ownership.test.ts` | Strict Linux owner precedes storage and uncertified exits retain lock. Fleet takeover/operator reconciliation, other OSes and arbitrary external effects are unqualified. SQLite locks alone do not own effects. |
| HC-024 | Storage migration | migration/perf-unverified | `E/copied-upgrade.ts`, `E/runtime-upgrade-workflow.ts`, `E/host-cutover.ts`; `Q/runtime-upgrade-workflow.test.ts`, `Q/copied-upgrade.test.ts`, `Q/rehearsal.test.ts` | Copied/offline guarded workflows exist; automatic existing-chat migration is absent. General add-on/task/doc/schema compatibility, live identity-preserving cutover and post-new-work reverse conversion are unqualified. |
| HC-025 | Backend/fork parity | migration/perf-unverified | `Q/test.ts`, `Q/sqlite.test.ts`, `Q/migration.test.ts`, `Q/single-database.test.ts` | Memory/SQLite/copied forks do not establish full JSONL parity, streaming-fork equivalence, writable-fleet ownership or production performance/resource bounds. |
| PC-001 | Ordinary accepted message | source-qualified | `E/application-bootstrap.ts`, `A/durable-queue-dispatch.ts`; `Q/default-application-runtime.test.ts`, `Q/application-web.test.ts` | Default SQL admission/worker dispatch/settlement and fresh chat creation are present; every non-web ingress and live deployment need qualification. |
| PC-002 | Exact steer | source-qualified | `A/durable-queued-steering.ts`; `SE/service-work-queued-steer.test.ts`, `Q/accepted-steer-recovery.test.ts` | Exact host target/source/version attach/materialise/consume works; no exact physical-generation or arbitrary cross-session guarantee. |
| PC-003 | Stale steer | source-qualified | `A/durable-queued-steering.ts`; `RT/channels/web/input-source-admission.test.ts`, `SE/service-work-queued-steer.test.ts` | Selected finished/version/harness mismatch and rollback cases reject; general producer/successor race coverage is incomplete. |
| PC-004 | Exact cancel | blocked-publicAPI | Main accepted-input cancellation still lacks atomic public conditional running-task abort. Native side prompts may abort only their verified ownerless isolated fork after durable cancellation-source attachment; this does not authorise a main-conversation abort. |
| PC-005 | Stale cancel after completion | fixture-only | Main stale/queued withdrawal checks and held side-fork signal/disconnect/timeout cases have source-backed tests. Side cancellation joins the isolated task and retires its cancellation source; unknown usage stays held. General main running cancellation still depends on PC-004. |
| PC-006 | Late completion after cancellation | source-qualified | `E/host-runtime.ts`; `Q/host-handoff.test.ts`, `Q/cutover-runtime.test.ts`, `Q/runtime.test.ts` | Host cancellation suppresses late success/settlement publication in selected races; no provider/task interruption claim. |
| PC-007 | Terminal commit fault matrix | source-qualified | `E/application-bootstrap.ts`; `SE/terminal-settlement-atomicity-races.test.ts`, `SE/terminal-settlement-payload-redaction.test.ts`, `Q/host-handoff.test.ts` | Actual EF-S02 owner/atomic settlement is composed; arbitrary cross-file fault placement and live delivery matrix are unqualified. |
| PC-008 | Restart with open run | source-qualified | `E/host-controller.ts`, `E/host-recovery.ts`, `A/durable-recovery-dispatch.ts`; `Q/host-controller.test.ts`, `Q/worker-recovery.test.ts`, `Q/single-database.test.ts`, native scheduler scenario in `Q/default-application-runtime.test.ts` | Bounded identity discovery, paused authorisation and completed-schedule reopen work. Unknown/background work fails closed; automatic accepted-agent takeover, arbitrary scheduled crash recovery and external exactly-once acceptance are unqualified. |
| PC-009 | Pending steer restart | source-qualified | `E/host-recovery.ts`, `E/application-bootstrap.ts`; `Q/accepted-steer-recovery.test.ts`, `Q/host-recovery.test.ts`, `Q/worker-recovery.test.ts` | Clean reopen and both SIGKILL windows are existing evidence; application recovery reads real host records. Arbitrary windows/all-ingress FIFO are unqualified; fixture-only identity table is no longer the sole source implementation. |
| PC-010 | Native/official tools | fixture-only | Seven default Linux tools and bounded Plan/Delegate/Code Review/editable-table/Office/Draw.io/MCP/codemode consumers are integrated and source-qualified within their documented scopes. Actual card side HTTP execution uses production read/source/accounting guards without SDK session hydration. Remaining installed tool/extension consumers and fleet parity still need an exhaustive audit. |
| PC-011 | Mutation containment | fixture-only | `E/host-tools.ts`, `E/host-builtins.ts`; `Q/tools.test.ts`, `Q/bash-port.test.ts`, `Q/host-builtins.test.ts` | Selected effect fencing works; unsafe interrupted effects, all installed ports and reload containment/reconciliation remain incomplete. |
| PC-012 | Scheduler agent task | source-qualified | `runtime/src/task-scheduler.ts` `executeScheduledTask`, `runtime/src/agent-pool.ts` `dispatchScheduledAgent`, `E/application-bootstrap.ts`, `E/host-bindings.ts`; `Q/default-application-runtime.test.ts` selector `native-scheduler`, `Q/scheduled.test.ts` | Actual default native consumer uses public forks, preserves empty/dynamic/nonempty main history, reopens and accepts subsequent ordinary input; EF-S07 alone logs/delivers scheduled results. Captured canonical task-revision labels now resolve approved available physical models into atomically configured forks; actual A100k→B200k coverage includes a slash-bearing model ID and unchanged main A after reopen. Invalid/unavailable labels create no fork/provider request. Enabled caps deny allocation, with bounded mid-run/post-auth rechecks but no request budget accounting. Direct approval revocation during await is untested. Cancellation, automatic accepted-agent takeover, arbitrary crash and complete stale-delivery parity are unqualified. Allocation-only fake `runAgent` tests are not actual consumer proof. |
| PC-013 | Scheduler shell task | fixture-only | `Q/scheduled.test.ts`, `runtime/src/task-scheduler.ts` | Candidate agent dispatch rejects shell; retained shell regression path does not establish candidate-mode Pushover/delivery equivalence. |
| PC-014 | Stale watch delivery | source-qualified | EF-S08 filters stale incarnation/session/operation/generation observations. Card side HTTP SSE forwards only exact captured source events; mutation/throwing observers cannot change provider accounting, and aborted request observers stop. Actual HTTP success/disconnect is tested; full browser reconnect/skin coverage remains unqualified. |
| PC-015 | Mobile Abort | blocked-publicAPI | `E/host-runtime.ts`; `Q/runtime.test.ts` | No candidate mobile→exact running-task abort proof; same API gap as PC-004. Legacy mobile tests cannot fill it. |
| PC-016 | Protected evidence | source-qualified | `E/host-projection.ts`, `E/host-tools.ts`; `Q/projection.test.ts`, `Q/tools.test.ts`, `Q/models.test.ts`, `Q/application-web.test.ts` | Selected sanitised DTOs/results/private reasoning/materialisation work; persisted logs/exports/telemetry need a complete secret audit. |
| PC-017 | Legacy rollout | fixture-only | Published source defaults to the durable factory, with no production JSONL fallback; the production side-prompt runner is now test-only. Shared-DB/new-chat/guarded-consumer tests and copied upgrade fixtures pass, but existing production chat history still requires migration. No live fleet cutover or general legacy-session retirement is qualified. |
| PC-018 | Trusted internal input | fixture-only | `A/durable-runtime-adapter.ts`; `Q/scheduled.test.ts`, `Q/runtime.test.ts`, `RT/channels/web/alternate-ingress-guards.test.ts` | Selected claimed/scheduler ports and admission seals exist; every internal ingress still needs acceptance/budget/owner proof. |
| PC-019 | Cross-session steer | fixture-only | `A/durable-queued-steering.ts`; `SE/service-work-queued-steer.test.ts` | Local accepted steer is chat-bound; no complete cross-session acknowledgement/retry/dedup/offline acceptance proof. |
| PC-020 | Goal/checkpoint race | fixture-only | `Q/runtime.test.ts`, `Q/accepted-steer-recovery.test.ts` | Selected all-input settlement/checkpoint races pass; general goal/cross-session producer and carry/disposal races are unqualified. |

## Application adoption and internal simplification

The production source call path is `runtime.main` → strict runtime lock → default bootstrap preparation → `createDefaultApplicationRuntime` → public Harness root routing/identity documents → `createApplicationBootstrapBundle` → existing AgentPool/WebChannel/AgentQueue. The bundle uses EF-S01 acceptance, bound source hashes, EF-S02 settlement and the same physical application SQLite file. It does not create a second accepted-work queue.

`E/host-controller.ts` opens paused under ownership, reconstructs actual accepted primary/attached identities through `E/host-recovery.ts`, and checks all live submissions/tasks before progress. Unknown, independent and background work cannot inherit blanket authority. Recovery dispatch supplies worker wake-ups; events request fenced SQL reads and do not themselves release callbacks. Shutdown stops producers, joins the queue and closes borrowed storage before safe owner-release certification. Existing tests qualify bounded paths; source comments still saying “inactive”, “unregistered” or “not imported by default” on these reusable modules are stale against the actual bootstrap call graph.

Application readers now use adapter-captured public engine ports: persisted model, public position and fork-aware session tree. `E/host-runtime.ts` and `E/session-tree.ts`, with `Q/db-tree.test.ts`, `Q/single-database.test.ts` and `RT/agent-pool/runtime-facade.test.ts`, cover selected imported/native/tool/compaction projections, protected reasoning exclusion and no JSONL fallback. Navigation/history mutations and complete legacy REST/context/usage parity are unqualified. Bounded measurements below exercise 100/1,000/2,000 entries and the 100-entry pagination boundary; production-scale resource acceptance is still missing.

Published `8dcf4dd73` makes `getSessionTreeSummaryForChat` uniformly async, reuses the existing public tree reader, awaits startup/session-control/scheduler consumers and adds awaited `sessionTree` to GET `/agent/context`. The total counts visible nodes; the leaf retains the exact raw public head. It introduces no new state/port/table and does not claim or clear native turn status. `db-tree-summary-replacement-checkpoint.md` records focused 70/373 and application/DB 10/130 receipts plus typechecks; overlapping counts are not additive.

The native context follow-up captures the bound session before awaiting the existing public persisted-model reader. The owned synchronous host ModelRuntime resolves positive finite physical model windows without provider IO or catalogue warming; absent model/metadata yields `contextWindow: null`. Native `tokens` and `percent` stay null: historical cumulative usage cannot estimate current context. Internal `tokensAreAuthoritative: true` prevents stale same-generation stored counts from replacing those nulls after compaction; legacy fallback is unchanged. Public context, status, family GET/PATCH model-control, branches and widget state JSON/SSE projections expose only public fields. The shared public projection removes the hint and future private fields. Unbound/missing-reader/stale-owner cases fail without legacy construction. No new table, port or stored state is added. Bounded review was READY after the HTTP projection P2 fix; the final root gate passes with `EXIT_CODE=0`.

Seven guarded Linux builtins (`read`, `bash`, `edit`, `write`, `find`, `ls`, `grep`) are now the source default. Root and durable grep share `A/host-grep.ts`; find/grep share `A/host-tool-process.ts`. Guards execute at selected actual filesystem/spawn boundaries; recognised previous defaults converge only under idle/owner checks. Custom subsets and model/history identity survive. This is single-user policy, without a new filesystem sandbox or general add-on grant.

Approved installed Plan uses `E/host-extension-catalog.ts`, `E/host-plan-tool.ts` and native `E/host-plan-prompt.ts` `GenerationHooks.beforeRequest`. Public task/tool/source evidence bounds invocation-local chat KV authority. The hook refreshes request-only Plan state on each provider request; it does not emulate legacy SessionManager/ExtensionContext or persist invented hidden entries. Shared `runtime/src/db/register-extension-kv.ts` and the existing authority router replace duplicate registration. Canonical version/content/object checks and process-local path poisoning reject unsupported or stale SDK-cached factories. Approved Plan, bounded installed Delegate and bounded Code Review reads/local mutations have native default paths; other installed lifecycle/tool contributions fail startup explicitly. Historical Delegate/Code Review fixtures in `Q/delegate.test.ts` and `Q/addon-host-services.test.ts` do not qualify the new default Delegate path.

## Current native Code Review: all nine actions

The actual default factory installs `E/host-code-review-tool.ts` using the add-on's
public `createCodeReviewTool` factory. Extraction removed duplicate declaration
and execution from the old add-on index. The direct operator API and native reads/writes
share its backend on the borrowed physical application root. Legacy `reviewAction`
and the native factory use the same static synchronous `runCodeReviewMutation`
helper and service methods. The old duplicate `work` case was removed; the current
add-on source delta is 30 lines in / 30 out. The native profile reuses the original
registered declaration and description after removing its custom description.
No parallel UX, extra queue or job ledger was added. Fifteen namespaced
`addon_code_review_` data tables and `addon_code_review_schema` hold add-on data.
The borrowed path opens no second database, leaves host PRAGMAs and
`PRAGMA user_version` untouched and never closes the root connection. The legacy
standalone `reviews.db` path stays for compatibility; native source does not use it.

All nine actions are admitted: `dispatches`, `dispatch`, `thread`, `threads`,
`reply`, `edit`, `deleteMessage`, `resolve` and `work`. `work` is a pure synchronous
assigned-item state mutation through `updateWork`; it creates no provider request,
job, worker or delivery. Assignment epoch, current dispatch, item and thread versions
bound the change. Caller authority overrides refuse before capture or service lookup. Root-owned exact
accepted source/tool-call provenance, the current claimed operation/running harness,
the original message's single `addon_local_dispatch` marker and
`addon_local_dispatch_authorities` SQL establish the grant. Chat, incarnation,
content hash and intent must match. Current source/assignment and dispatch/thread
scope checks apply around reads; model IDs cannot grant authority. Writes also
require the current EF-S01 source/harness/version. The existing
`createPlanKvAuthority` root `IMMEDIATE` transaction checks source and trusted
dispatch scope before and after synchronous mutation. Post-callback revocation
rolls back nested store transactions, including messages, versions, events and
request receipts. Receipt replay rechecks authority. Arguments are cloned before
awaiting resolution; returned authority and nested identity/reference are frozen. Peer or unscoped
sources reject. The original owner callback is captured in the database binding.
Close/release revokes it; old awaited callbacks retain that old closed grant and
fail closed. A later backend cannot supply them new authority. Supplied bounded
source reviews are READY after the callback capture fix and coverage gaps were filled.

The catalogue checks 13 backend source files, resolution, declaration and registered
objects against published add-on commit
`d1ce8c6f2e5ea6d5330728aa8a6a3684bf5c3d4f` (add-on PR #208), branch
`implement/durable-code-review-1650`. Qualification CI checks out this exact source
and supplies `DURABLE_CODE_REVIEW_ROOT`. Package version remains 0.1.8; no dependency
upgrade, live installation or version release occurred. Source hashes stay frozen
while gates run; the source/CI checkout is separate from installed dependencies.

Current all-nine receipts:

- `code-review-work-actual.log`: actual-default 1 pass / 59 assertions, including
  `work` → `in_progress`, stale-item and cross-chat denial, `completed` after the
  agent's own resolution, physical root close/reopen and a fresh native read.
- `code-review-work-addon.log`: focused add-on 44 pass / 405 assertions.
- `code-review-work-addon-full.log`: 206 pass, 3 skip, 0 fail, 2,602 assertions,
  60 files, 86.35 seconds, `EXIT_CODE=0`.
- `code-review-work-{root,engine,qualification}-types.log` and
  `code-review-work-addon-scoped-types.log`: three core typechecks and scoped
  add-on types pass. Bounded scope review is READY.
- `code-review-work-final-candidate.log`: 485 pass / 7,182 assertions; inner
  candidate run completed normally without an outer exit-code receipt.
  `code-review-work-final-root.log`: 7,294 pass, 74 baseline skips, 0 fail;
  25 feature + 9 build tests pass; `EXIT_CODE=0`.

Historical local-write receipts at core `2641f073f` and add-on `10e8580`, before
all-nine WIP over `1d6ad39de` (their `work` refusal describes older source):

- `code-review-write-actual.log`: actual-default 1 pass / 52 assertions, covering
  reply/idempotent replay, stale and cross-chat denial, edit/delete/resolve,
  refused `work` and persisted reads after physical root close/reopen.
- `native-tool-mutation.test.ts`: four real-backend cases cover revoke-after-async
  resolution, before-commit rollback, request-receipt revocation and caller
  identity override denial. Supplied focused add-on scope: 28 pass / 262 assertions.
- `code-review-write-addon-final.log`: 202 pass, 3 skip, 0 fail, 2,568 assertions,
  60 files, 86.19 seconds, `EXIT_CODE=0`; add-on types pass.
- `code-review-write-{root,engine,qualification}-types.log`: all three core types
  pass. Independent bounded local-mutation review READY, no P1/P2; no new budget
  or LLM execution qualification.
- `code-review-write-final-candidate.log`: 485 pass / 7,182 assertions, exit 0.
  `code-review-write-final-root.log`: 7,312 pass, 74 baseline skips, 0 fail;
  25 feature + 9 build tests pass; `EXIT_CODE=0`.

Earlier read-only receipts use add-on `a1a165c0ba9ea051584f828392c5061cda91dd2a`
and published core `2641f073f`, before the native-write WIP.
`code-review-physical-reopen.log` preserves that actual default scenario receipt:
1 pass / 44 assertions, physical root close/reopen and a fresh scoped native read.
A real existing other-chat thread/dispatch is denied and its secret is absent from
results, provider transcripts, entries and bot messages. Refused writes leave saved
messages unchanged; no `reviews.db` appears. Catalogue tests pass 4 / 18 assertions
(`/tmp/review-catalog-debug.log`). `code-review-extracted-final-addon.log` records
198 pass, 3 skip, 0 fail, 2,525 assertions across 59 files in 84.08 seconds,
`EXIT_CODE=0`; extracted add-on types pass. All three core scoped types pass
(`code-review-final-{root,engine,qualification}-types.log`). The final core candidate
`code-review-final-candidate.log` passes 485 tests / 7,182 assertions across 42
files; its interrupted wrapper supplied no exit-code receipt. Root gate
`code-review-final-root.log` passes 7,312 tests with 74 baseline skips, plus
25 feature and 9 build tests, `EXIT_CODE=0`.

HC-002 already had bounded source qualification. All 45 statuses stay unchanged:
22 source-qualified, 17 fixture-only, 3 blocked-publicAPI and 3 migration/perf-unverified.
Full API/tool source adoption does not qualify every PC row. Operator/browser
dispatch queue and delivery through durable ingress still need representative
acceptance. Earlier root direct-API tests and the actual new shared read establish
bounded core behaviour without a provider; they do not establish that ingress/delivery
path. No missing `work` worker is required. Existing review-store migration stays
last: preserve the old `reviews.db`; no copy or conversion ran. No tests, code, CI, network, services, pins, live state,
migration, commits or pushes changed during this documentation refresh.

## Bounded native Delegate consumer

The actual default factory loads the canonical installed Delegate 0.2.20 declaration
and `buildModelCandidates` policy, then installs `E/host-delegate-tool.ts`.
It never calls legacy `execute`, lifecycle handlers, CLI children or a fabricated
SessionManager/ExtensionContext. Public SDK task-owned child conversations use the
same physical application database. Legacy CLI code and the add-on package stay
for the separate legacy path until fleet legacy migration permits removal.

`E/host-runtime.ts` captures the exact public running MODEL tool slot and call.
Child public ownership resolves to its live, unaborted parent `pi.tool` task and
committed assistant `delegate` call; task-owned parents cannot recurse. Public
accepted records resolve to EF-S01 bindings, current executing claimed uncancelled
source/operation and exact running harness. Busy-chat lookup grants no authority.
Captured-source checks run at child admission, generation/model boundaries and
selected tool effects. Current provider availability, Settings approval and the installed
ordered classification/exclusion policy apply before creation and after settlement,
and through model post-auth `transformHeaders` and tool-effect guards.

Automatic selection inherits the exact parent model. Explicit selection accepts
an exact approved `provider/model` from the captured approved available physical
catalogue, with current availability/approval checks. The installed actual
`buildModelCandidates` reuses approved providers, ordered classification and
exclusions; no new policy map was added. Existing CLI `validateExplicit` semantics
allow an explicit model to override the automatic parent-tier restriction,
including a higher tier, without granting additional approval. Splitting at the
first slash preserves slash-bearing model IDs. Public `api.memo("model", …)` pins
the choice on replay; source/model assertions run before creation and after
settlement. Generation, post-authentication and filesystem-effect guards check
the actual selected child model. A different physical child leaves the parent
on its root model.

Children have fresh self-contained history and parent thinking level. Omitted
`tools` or `read_only` selects `read`/`grep`/`find`/`ls`; explicit `standard`
selects the seven guarded builtins above, and exact comma-separated names select
subsets. No recursive Delegate, Plan, Code Review or MCP/add-on tool enters the
child. Categories `quick`, `summarize`, `code`, `analyze`, `reason` are accepted
without automatic model reselection. `judge`, unsupported options, unknown tool
names and `full` reject. Unavailable, unclassified, excluded
provider/model, non-string, empty, short, fuzzy and virtual model choices reject
without a fallback child.
`timeout_sec` accepts integer 10..300, default 120 seconds, validated before child
allocation. Any enabled root budget cap denies
before creation and at each source/model guard. This conservative profile also
denies unrelated caps; per-request child accounting is unqualified. Parallel tool
calls use independent owned children, with no numeric global concurrency setting
or second queue.

Text attachments accept 0..10 explicit paths; empty `files: []` performs no
attachment IO. `E/host-delegate-files.ts` uses the captured host reader callback
and workspace root, lexical/canonical containment, nonblocking final-component
`O_NOFOLLOW` opens and regular-file descriptor checks. Actual aggregate reads are
bounded at 100,000 bytes with an overflow probe; overflow rejects without truncation.
Invalid UTF-8, NUL, disallowed controls and recognised binary/image signatures
reject. UTF-8 SVG is text only, without image rendering. The legacy workspace
policy supplies no general filesystem sandbox; canonical parent-directory
replacement races are not prevented by `O_NOFOLLOW`.

Source, owner, lifetime, cap, selected-model and deadline guards run at actual
open/read boundaries and after reading. Validation and materialisation precede
the first new child creation. Logical path labels mark file contents as untrusted
data. Fixed attachment errors omit raw filesystem errors; no new contents logging
is added. No CLI `execute` or fabricated ToolContext runs.

Replay reconciles public task-owned child/request state before IO and reuses
accepted input without rereading mutated source files. Public SDK request-ID
deduplication checks submission type, not content equality; accepted input stays
authoritative, including queued input. Normal SDK child input holds that snapshot;
no 100 KB memo, new ledger or parallel queue is added. The latest focused receipt
passes 21 tests / 257 assertions, including empty-list coverage; prior actual-native
coverage passes 1 / 38. Final candidate/root and all three scoped type receipts
are recorded above; attachment and empty-list reviews are READY. The root outer
wrapper has no exit-code receipt. Images, tools beyond the bounded standard
profile, capped request accounting and numeric global concurrency are unqualified.

Public `api.memo("deadline", …)` stores absolute operation-entry expiry before
source/model approval awaits; replay cannot renew it. Child wait races the remaining
time. Cleanup clears its timer on success, error, cancellation and timeout. Expiry
uses invocation-bound owned `child.abort` and joins that child's work, preserving
parent and sibling scopes. Provider abort is cooperative; a non-cooperative
provider can prevent completion. No force-kill guarantee is qualified.

Expired replay creates no new child or input. An existing owned child is aborted
and joined unless a committed `done` answer already exists; late replay reuses that
answer and preserves its result. SDK recovery may restart an already-owned provider
before parent replay; the expired parent then aborts that child. The reopen test
permits 3..4 physical provider requests, with one durable input per child. It
explicitly reads public `TaskRecord.memos.deadline` for both child owner tasks and
compares them unchanged before and after physical database close/open. This does
not establish exactly-once provider execution or billing.

`delegate-explicit-current-tests.log` records 43 pass, 0 fail, 167 assertions
across two files. Thirteen actual-default cases cover explicit parent, smaller,
higher-tier and slash-bearing choices and the nine rejection classes above;
invalid choices create no child. Cap/provider revocation cases now select explicit
different-model child B and verify policy against B. All three scoped types pass
after correcting the fixture's `unknown` JSON type. Initial test failure came
from a wrong native Code Review source hash, without weaker assertions or policy.
`delegate-explicit-full-candidate.log` passes 510 tests / 7,292 assertions.
`delegate-explicit-simplified-root.log` passes 7,312 tests, 74 baseline skips,
plus 25 feature and 9 build tests. Both inner runs complete normally; interrupted
outer wrappers supplied no exit-code receipts. Earlier timeout attempts remain recorded. These receipts qualify explicit-model source published at `b258ff3a2`, separately
from published attachment/WAL source, the current standard-tools candidate and
earlier deadline/Delegate receipts.

`deadline-memo-final.log` records 17 pass, 0 fail, 202 assertions across two files.
The prior `native-delegate-deadline-checkpoint.md` records actual-default selector
`native-delegate-timeout`, 1 pass / 35 assertions: valid explicit 10-second timeout,
manually fired deadline, cooperative held-provider abort, successful sibling and
completed parent. These scopes are separate. All three scoped types pass. Final candidate `deadline-quiet-candidate.log` passes
492 tests / 7,245 assertions, exit 0; root `deadline-quiet-root.log` passes 7,312
tests with 74 baseline skips, plus 25 feature and 9 build tests, exit 0. The
timer-registration test race uses an explicit barrier; its actual-default rerun
passes 34 assertions. Earlier timeout failures remain recorded without weaker limits. Older receipts
rejecting explicit deadlines describe the prior profile.

Catalogue approval checks canonical paths, content hashes, module resolution and
registered definition/handler objects. Changed source rejects; process-local path
poisoning blocks uncertain cached factories even after bytes are restored. Startup
source admission includes Delegate. `app.host-scheduled-source` is now an all-source
generation hook despite its stale name; renaming it and Plan-named shared profile
types is separate cleanup, not required for these guards.

Existing receipts: actual default two-child scenario 31 assertions; denied provider
25; supplied current cap/provider revocation follow-ups 38 each; source/factory
7 tests / 55 assertions; Delegate catalogue seven cases. The combined factory/
catalogue scope passes 30 cases including Plan; earlier failed logs are historical.
Earlier individual revocation logs failed overbroad error-string assertions.
The initial full candidate has 480 cases, 478 pass and two disk-test 5,000 ms
timeouts (`native-delegate-final-candidate.log`, exit 1). Focused disk repeat passes
42 / 329 (`native-delegate-disk-repeat.log`). The second full candidate has
479 pass and one different disk timeout. Final serial candidate
`native-delegate-serial-candidate.log` passes 480 tests / 7,163 assertions,
`EXIT_CODE=0`. Inner root gate `native-delegate-root-independent.log` completes
normally: 7,312 pass, 74 baseline skips, 0 fail, plus 25 feature and 9 build tests.
Its interrupted outer wrapper supplied no exit-code receipt. All three scoped
typechecks pass. Published native Delegate adoption is `ea2d1416e`; final receipt
documentation is `7150dd6a2`, with supplied exact-head hosted run `39073316535` green. Published scheduler
`a89afe02f` has 458 candidate and 7,294 root + 25 feature + 9 build passes;
`175032611` native-parallel has 462 candidate passes. Those older results retain
their own source boundaries.

The 45 row statuses stay 22 source-qualified, 17 fixture-only, 3 blocked-publicAPI
and 3 migration/perf-unverified. HC-002 already had bounded source qualification.
The public SDK exposes `abortTask` for a known task. It lacks an atomic condition
against the exact current running task; read-then-abort cannot provide that
condition. HC-009/PC-004/PC-015 retain their exact-running cancellation gap.
Foreground child cancellation, child deadlines and host publication fencing do not
fill it. The 45 statuses remain unchanged; no activation or migration ran.

## Bounded native scheduler consumer

The default source path is EF-S07 polling → `executeScheduledTask` → real AgentPool
`dispatchScheduledAgent` → application bootstrap dispatch → public SDK fork
allocation/submission. The allocator rechecks the actual lease, task revision,
claimed source and operation, then writes correlation to the existing binding table
in the same physical application database. Main-chat execution/history is preserved;
no legacy save/restore or legacy model-label lookup runs. Native overrides use the
root physical ModelRuntime resolver below. EF-S07 owns scheduled logs and
result delivery. Scheduled terminal settlement emits no EF-S02 timeline answer.

The actual `Q/default-application-runtime.test.ts` selector
`PICLAW_DEFAULT_FACTORY_CASE=native-scheduler` uses real default bootstrap,
AgentPool and `pollScheduledRunsOnce` with a synthetic keyless provider. Its shared
title is `default factory prepares and reopens real startup-known public
conversations; refuses legacy before models`. Assertions cover empty main,
dynamically added root, nonempty main, unchanged main position/history, three
successful logs/results, reopen and a subsequent ordinary message with exactly one
further ordinary answer. Legacy `runAgent`/save/restore/model-label and SessionManager
spies remain unused. `Q/scheduled-allocation.test.ts` explicitly uses fake `runAgent`;
its lease/rollback/public-fork/forged-route checks qualify allocation only.

The canonical EF-S07 task revision captures `model_label`. The host-owned
`resolveScheduledModel` resolves an approved, currently available physical model
through the root ModelRuntime, without an LLM request or credential lookup. The
captured choice is immutable. The source guard rechecks source and model approval
before the public fork commit. The allocator copies the parent's `AgentDoc`,
configures the fork and writes the host binding in the same public SDK commit.
The main model is never temporarily mutated; legacy switch/restore is separate.

The conservative context-fit helper is shared with the existing idle model SET
path, removing duplicate checks. Missing metadata, images and dynamic prompt
sections fail closed. No images or dynamic-section model context-fit support is
qualified, and this bound does not establish that every future host prompt fits.

`scheduler-model-actual.log` records 1 pass / 73 assertions on empty, dynamic and
nonempty main roots. Nonempty main A100k uses fork B200k with a slash-bearing model
ID. Invalid/unavailable labels produce error receipts with no fork/provider call;
main position/history/model remain unchanged and ordinary main A works after
physical reopen. Existing cap-revocation guards are retained. The allocation-only
fake `runAgent` cases remain separate evidence.

`scheduler-model-focused-final.log` records 96 pass / 2,477 assertions across three
files, covering missing resolver, tiny/unavailable models, immutable capture and
the existing idle-model/public model bridges. All three scoped types pass in
`scheduler-model-{root,engine,qualification}-types.log`. Bounded source review is
READY; no direct approval-revocation-during-await test or complete revocation
matrix is available. `scheduler-override-full-candidate.log` passes 493 tests / 7,255 assertions, exit 0.
`scheduler-override-full-root.log` passes 7,312 tests, 74 baseline skips, plus
25 feature and 9 build tests, exit 0.

Applicable enabled instance/provider or matching scheduled-task caps reject before
fork allocation with `Native scheduled budget admission unavailable`, including
zero and positive allowances. Task-work caps do not grant a new occurrence authority;
other scheduled tasks' caps do not apply. Per-request native scheduled budget
attribution, reservation and accounting are incomplete.

Current exact scheduled binding resolution rechecks source/operation/revision/lease
and caps. All seven host builtins capture actual public run/tool-slot provenance and
recheck at filesystem/process effects. Native `GenerationHooks.beforeRequest`
captures actual run provenance against the hook abort signal; the model bridge
carries the request guard into post-credential `transformHeaders`. The actual native
scenario enables a cap after one provider response and verifies no write, no second
provider invocation, an error log and no delivery. A separate asynchronous credential
barrier enables a cap after capture and verifies zero provider invocations and no
delivery. Denial fails that request without aborting shared model lifetime. The
accepted microtask gap after awaited `transformHeaders` is unchanged; these checks
do not provide atomic network cancellation or an exact running-task abort.

Startup validates persisted scheduled source/operation/fork provenance, including
completed occurrences. A stale inspected task is ignored only after reading its
exact persisted public terminal receipt. Unknown/background authority still rejects.
Automatic accepted-agent takeover and arbitrary scheduled process-crash recovery
are unqualified. PC-012 meets the bounded source-qualified definition, with incomplete
wider model-override, budget, cancellation and recovery acceptance stated above. PC-018 general ingress
and HC-019 usage retain fixture-only status. Stale inactive/unregistered module
comments are superseded by this default call graph; frozen-gate source comments
were left untouched.

## Existing verification receipts

No tests were rerun and no network/CI queries were made for this refresh.

| Tree / scope | Existing receipt | Result and limit |
| --- | --- | --- |
| Published Plan source at `7315c221e` | `native-plan-cache-final-full.log`; qualification README's final Plan section | 456 pass, 0 fail, 6,970 assertions, 37 files. Synthetic/keyless candidate qualification, not 45 acceptance passes. |
| Published Plan source root gate at `7315c221e` | `root-native-plan-final-repeat.log` | 7,287 pass, 74 baseline skips, 0 fail; 25 feature + 9 build tests; `EXIT_CODE=0`. Root regression evidence, with Pi 1.2.0 host graph. |
| Plan exact-head hosted CI | User-provided prior-turn receipt: run `39054197173` | Reported green for `7315c221e`; not re-fetched here. |
| Summary source published as `8dcf4dd73` — candidate | `tree-summary-isolated-candidate.log` | 456 pass, 0 fail, 6,974 assertions, 37 files. Separate from the published Plan receipt. |
| Summary source published as `8dcf4dd73` — root gate | `root-tree-summary-final.log` | 7,289 pass, 74 baseline skips, 0 fail; 25 feature + 9 build tests pass and inner make completes normally. The interrupted outer wrapper did not record an `EXIT_CODE`; none is inferred. |
| Summary exact-head hosted CI | Run `39059477545` | Completed successfully for exact head `8dcf4dd73`; queried after the run completed. |
| Native context candidate over `8dcf4dd73` | `context-window-final-candidate.log` | 456 pass, 0 fail, 6,974 assertions. Separate from the published summary candidate receipt. |
| Native context focused root | `context-window-root-tests.log` | 60 pass, 0 fail, 325 assertions, 3 files. |
| Native context HTTP projection P2 fix | `context-window-public-projection-tests.log`, `context-window-public-projection-types.log` | 24 pass, 0 fail, 411 assertions, 2 files; runtime typecheck passes. Bounded independent review READY after this fix. |
| Native context scoped types | `context-window-root-types.log`, `context-window-engine-types.log`, `context-window-qualification-types.log` | All three pass. Earlier parallel engine exit 137 was followed by a passing rerun. |
| Native context final root gate | `context-window-final-root.log` | 7,311 pass, 74 baseline skips, 0 fail; 25 feature + 9 build tests pass; `EXIT_CODE=0`. |
| Published native context parent `31dd88ebd` — hosted CI | Supplied verified exact-head receipt, run `39061392219` | SUCCESS; not re-fetched during this docs-only refresh. The 456 candidate / 7,311 root + 25 feature + 9 build results above belong to this parent, not the scheduler follow-up. |
| Scheduler mixed focused follow-up over `31dd88ebd` | `scheduled-midrun-focused.log` | 95 pass, 0 fail, 2,474 assertions across 3 files: actual default `native-scheduler` scenario, model tests and allocation-only tests. Not the full default suite or 95 actual-native cases; no additive aggregation. |
| Scheduler component effect fences | `scheduled-midrun-effect-final.log` | 117 pass, 0 fail, 2,565 assertions across bash/builtin/model tests. Separate component evidence; overlapping model counts are not additive. |
| Scheduler final simplified source | `scheduler-simplified-candidate.log`, `scheduler-simplified-root.log` | 458 candidate tests / 6,990 assertions; root 7,294 pass, 74 baseline skips, 0 fail; 25 feature + 9 build tests pass; `EXIT_CODE=0`. All three scoped types pass. |
| Accepted-steer crash matrix | `accepted-steer-crash-checkpoint.md`, `accepted-steer-crash-full.log`, `accepted-steer-crash-repeat-{1,2,3}.log` | Existing attachment-before-submit and submission-before-ACK SIGKILL cases retained. No repeat run. No arbitrary mid-commit, paid-provider exactly-once or power-loss guarantee. |

Historical failed, interrupted and superseded runs remain in their original receipts/README. Early six-tool/grep-blocked, legacy-default and controller-missing checkpoints describe earlier source; the current code and final registered-suite receipts above supersede those implementation statements.

## Bounded tree and native context reads

The existing external run passed 18,716 assertions on synthetic native histories using actual public SDK SQLite storage, a borrowed physical root, real host effect/binding composition, `HostConversationRuntime`, the durable adapter and `AgentRuntimeFacade`. It did not use default application bootstrap/runtimeFactory or providers. These read measurements do not change acceptance statuses. With bounded scheduler source adoption, the 45 rows now total 22 source-qualified, 17 fixture-only, 3 blocked-publicAPI and 3 migration/perf-unverified.

| Native entries | Warm tree median ms | Warm tree p95 ms (n=5) | First tree read after reopen ms | Warm facade context metadata median ms |
| ---: | ---: | ---: | ---: | ---: |
| 100 | 0.475 | 0.585 | 0.504 | 0.077 |
| 1,000 | 2.574 | 2.864 | 2.776 | 0.053 |
| 2,000 | 7.430 | 8.311 | 4.707 | 0.043 |

Original public entry IDs, linear ancestry, parent/child counts, full snapshot equality, public saved position and the reader's 100-entry page boundary passed. Assistant/tool rows are synthetic. Context reads resolve persisted model/window metadata, without assembling full model context or counting tokens. Shared-gate CPU contention was uncontrolled; RSS consists of process snapshots. Reopen retained the warm OS cache. Five samples are descriptive, with nearest-rank p95 equal to the maximum; they do not establish production tail latency or benchmark acceptance.

[Persistent method, raw samples and digests](../../../evidence/pi-durable-130-tree-read-performance-20261017.md) retain the bounded evidence. The original harness lives at `/workspace/reviews/durable-1650/tree-read-performance.ts`; external JSON and report are `/workspace/reviews/durable-1650/tree-read-performance.json` and `/workspace/reviews/durable-1650/tree-read-performance.md`. Those local files persist in this workspace but are outside the repository. The raw JSON copy is portable; a portable repository harness is missing, so a clone alone cannot reproduce this run. No code benchmark is required for this bounded evidence qualification.

## Remaining acceptance work

1. Close the exact-running-abort public API gap for HC-009/PC-004/PC-015 or obtain an explicit requirement decision. Host cancellation/publication fencing is already distinct; no unsafe substitute is proposed.
2. Extend bounded scheduler model-override acceptance, including direct approval revocation during await; complete native per-request budget attribution/reservation/accounting, exact cancellation, accepted-agent takeover and arbitrary-crash/stale-delivery qualification. Applicable enabled scheduler caps deny; native capped accounting is unqualified. The actual consumer and cap-denial checks above do not complete those requirements. Complete service/terminal-effect (STE) acceptance across general trusted internal and cross-session input, protected hand-offs, mobile cancellation and goal/checkpoint races. EF-S01/02/05/07/08 keep their acceptance, terminal, delivery, scheduler and projection authorities. Task outcomes/watches cannot replace terminal or delivery receipts.
3. Qualify remaining semantic matrices: parallel ordering, safe replay, retry/budgets, corruption, deferred live-provider recovery, reload, usage accounting and automatic/background/overflow compaction. Existing bounded source/component results do not supply those matrices.
4. Complete standard-tools candidate/root gates (running), then qualify standard-specific crash/reopen and wider Delegate tools. Explicit approved models and bounded text attachments are published through `1241cdde0`; the standard-tools candidate has focused evidence only. Images/renderable binary attachments and full MCP/add-on profiles still reject. Numeric global concurrency is not implemented; native capped request accounting is unqualified and all enabled Delegate caps still deny. Missing selected-auth or public root SDK authority cannot grant access. Deadline candidate/root gates passed for published `e5ca1b67d`; current scheduler candidate493 and root7312+25+9 gates pass with exit 0. Current Code Review is published at core `4e1ffe2fe` and add-on PR #208 `d1ce8c6f2e5ea6d5330728aa8a6a3684bf5c3d4f`, with exact previous receipts above. Qualify representative operator/browser dispatch queue/delivery acceptance through durable ingress. All nine model-tool actions are implemented; synchronous `work` needs no new worker/provider/job. Remote networking/auth, MCP/SSH effects and other add-on/event lifecycle/state compatibility need separate evidence.
5. Keep migration last. Preserve existing host chat/branch/session identities; qualify compatibility totality, guarded cutover and reverse conversion after new work. `E/host-controller.ts` deliberately rejects checkpoint/rollback proof without public storage identity and historical frontier; copied host-only rollback success does not remove this limitation.
6. Extend the bounded read evidence to production-scale restore/tree reads, storage growth, latency, memory and ownership/resource behaviour; supply a portable harness before clone-only reproduction is possible. Package/install, canary, live providers, fleet activation and rollback execution require separate approval and evidence.

## Evidence navigation

- [Qualification README](../../../../qualification/pi-durable-130/README.md): incremental receipts; read final registered-suite results with their source scope.
- [Historical acceptance report](pi-durable-130-current-acceptance.md): earlier `87efd0342` assessment and controller/copied-upgrade follow-ups, preserved unchanged below its supersession notice.
- Local reviews: `default-backend-factory-checkpoint.md`, `native-plan-adoption-checkpoint.md`, `db-tree-summary-replacement-checkpoint.md`, `db-session-tree-checkpoint.md`, `web-admission-drain-checkpoint.md`, `queue-backstop-ownership-checkpoint.md`. Their old “next steps” and WIP states are dated evidence, not current missing-source declarations.

## Native MCP stdio tools — 18 October 2026

The source-default factory now discovers configured stdio MCP tools with the public
`McpClient` and installs them for native codemode calls. It uses the existing bridge
snapshot/lease and constrained transport; it never loads the legacy MCP session
extension. Configuration must explicitly select Native, permit codemode, and use
literal stdio fields. Unsupported configuration fails before process startup.
Source ownership, configuration revision and cancellation are checked again at the
actual stdin write. Closing joins client and process-group cleanup; uncertain
cleanup retains the bridge lease.

Targeted evidence: `default-application-runtime.test.ts` scenarios
`native-mcp-codemode`, `native-mcp-codemode-cancel`, `native-mcp-http-deny` passed.
These exercise a real fixture process, nested result delivery, cancelled call/store
suppression, process exit, and HTTP rejection before model construction. Six native
transport regression tests passed (39 assertions); engine, qualification and runtime
typechecks passed. Independent bounded review returned READY for this stdio slice.
No full suite or live MCP server was run. HTTP, authentication, resources, prompts,
live configuration apply, general MCP parity, capped accounting and concurrency
acceptance are incomplete. Migration and activation have not occurred.

### MCP overlap and configuration drift

Two codemode calls now have targeted shared-client evidence: the fixture withholds
the first response until the second call arrives, then replies in reverse order.
Both results retain their request identity. This covers one operation and one
stdio server; multi-chat concurrency and general load acceptance are unqualified.

Codemode commit guards now include the existing MCP configuration/source guard.
Changing the config after nested source capture prevents the MCP send and guest
store persistence, including when guest code catches the MCP error. The operation
can settle with a tool failure; configuration drift does not cancel the operation.
Five selected MCP factory cases passed; three typechecks and bounded review passed.
No full suite, live server, activation or migration ran.

## Parent budget admission — 18 October 2026

The parent model path rejects every enabled budget cap until native per-request
accounting is implemented. The same common model check now covers Delegate, so its
duplicate cap query was removed. Denial after credential resolution uses the
existing host model policy checks. This intentionally rejects unrelated cap scopes
as well; scoped capped execution is unsupported.

Two real default-factory scenarios insert a zero instance cap either before dispatch
or during credential resolution. Both keep input claimed/pending, deliver no bot
message and invoke the synthetic provider zero times. These tests do not close the
public SDK await-to-provider race or qualify request reservation/settlement.
MCP and parent evidence above extends the older assessment without promoting any
of the 45 requirement statuses. Current branch before this change: b516de2a9;
exact-head hosted run 39119067426 was in progress at inspection. Existing-chat
migration, load/performance and fleet activation are incomplete.

### MCP server errors

The native adapter forwards the server's `isError` flag to the durable tool-result
envelope as well as structured data. The codemode nested-call record now marks
server errors as `error`; scripts can still read schema-backed error data and
complete successfully. A negative control without the forwarded flag records `ok`
and fails the new assertion. All six selected MCP factory scenarios and three
typechecks passed. General MCP parity and accounting remain incomplete.

### MCP declaration changes

A server's `notifications/tools/list_changed` invalidates the startup-owned native
catalogue until restart. The public notification listener is installed before
connect; calls, result publication and codemode store commits use the existing
freshness guard. No live refresh or legacy fallback is added. A real fixture sends
the notification before its first result: the result is suppressed, a subsequent
call never reaches stdin, and a caught failure cannot persist guest state. Seven
selected MCP cases and three typechecks pass; final drift case adds an explicit
result non-disclosure assertion (22 assertions).

### MCP transport loss

Unexpected client close invalidates the startup catalogue through the same guard
as declaration changes. A fixture exits during a tool call without replying;
catching that failure cannot persist guest state. Eight selected MCP factory cases
and three typechecks pass; bounded review accepted public onClose registration and
cleanup semantics. No reconnect, fallback, full-suite or live-server test added.

## 10,000-entry reader measurement — 18 October 2026

The existing actual runtime/adapter/facade synthetic harness now has a bounded
10,000-entry receipt: 60,042 assertions, warm median26.223ms, slowest of five
32.417ms, first read after reopen26.105ms. See
[measurement and limits](../../../evidence/pi-durable-130-tree-read-performance-10k-20261018.md).
Default-factory, imported/forked/compacted, concurrent-load and production-history
performance acceptance is still unverified. No requirement status changed.

## Durable model and thinking queries — 18 October 2026

The actual AgentPool command path supports read-only `/model` catalogue and
`/thinking` status queries. The model picker reads persisted thinking level through
a public AgentDoc reader instead of substituting null. Model changes reuse existing
add-on revocation and command protection, released on success and failure. No
legacy session is constructed; no global default or second settings store is added.

The actual default-factory scenario passes 156 assertions, including both model
switch directions and read-only queries. The complete facade test file passes
47 tests / 286 assertions. Three scoped typechecks and bounded review passed.
Thinking mutations still fail closed. Compatibility ports without the optional
thinking reader report null; model and thinking reads are separate snapshots.
Hosted run39123174225 passed all gates at prior f8809f4b0; these subsequent changes
need their own exact-head run. Accounting, general compatibility/load and migration
acceptance remain incomplete; all 45 requirement statuses are unchanged.

## Failed usage and query scope — 18 October 2026

Failed host chat requests retain reported terminal usage only when provider,
requested model, API and response model match the approved request and all usage
numbers are finite and nonnegative. Sanitised error content and diagnostics remain
fixed/empty. Invalid or mismatched usage falls back to unknown zero telemetry;
it is not evidence that a dispatched request was free. No request reservation,
settlement or capped execution is enabled by this change.

The model bridge test file passes98 tests/2464 assertions, including valid terminal
error usage and negative-cost/provider/response-model denial. The facade file
passes48 tests/287 assertions. Bare `/model` reuses the picker's model-scope helper;
actual reopened custom-subset history preserves non-null thinking `low` through
port, picker and command (95 assertions). Scoped typechecks and bounded review
passed. Prior edb19a468 passed all hosted gates in run39124204913; the subsequent
batch needs its own exact-head receipt. All45 requirement statuses are unchanged.

## Stored identity and thinking mutation — 18 October 2026

A synchronous stored-account fingerprint helper reuses existing Codex account-ID
and Copilot credential digest rules without auth/network work. The async quota
reader preserves empty-versus-absent fallback semantics. Provider-usage22 tests /
129 assertions pass. Native request accounting still lacks reservation/dispatch/
settlement integration and caps remain denied.

Durable `/thinking <level>` now uses public configure under the existing idle
model guard, validates model-supported levels and rechecks persisted model identity
inside the transaction. Existing command protection/revocation wraps mutation;
read-only compatibility ports still deny it. Shared model mutation code replaces
duplicated admission logic. Actual factory159 assertions (nonreasoning high denied,
off persisted, history unchanged), facade49 tests/291 assertions, and maintenance5
tests/120 assertions pass; three scoped typechecks and bounded reviews pass.
Reasoning-provider level matrices and wider policy/load acceptance are unqualified.
Prior8d6d08dd6 hosted39125366210 passed all gates; subsequent batch needs exact-head
CI. No deployment/migration and no change to45 requirement statuses.

## Lifecycle admission fencing — 18 October 2026

Durable input admission rechecks the existing live branch route both when handing
out a callback and inside its root transaction. A callback captured before archive
now rejects without persisting message/source changes. Synthetic `main` retains
its explicit fixture contract. Durable restore and rollup reject before legacy
branch-manager identity/database/session-artifact effects; native implementations
of those operations are still unsupported.

Targeted real-factory reasoning-high invariants166 assertions, archived admission19,
and empty/exact durable construction62 pass (247 total). Three scoped typechecks
and combined bounded review passed. Prior c58b66fc9 hosted39126969865 passed all
gates; this subsequent batch needs its own exact-head run. No accounting/cap
integration, live migration, deployment, or requirement-status promotion occurred.

## Admission identity and legacy rename fencing — 18 October 2026

Captured input admission verifies message chat identity and the persisted message
row's ID/chat/non-bot status before source acceptance. Wrong-chat, wrong-ID, bot
and absent-row transactions roll back without source/provider effects. This is
row identity validation, not content immutability or general ingress acceptance.
Durable chat-JID rename rejects before legacy database/session-path mutation;
metadata-only display rename and root creation are unchanged.

Targeted mismatch16 + row20 + normal-factory159 assertions pass, along with all7
application-web scenarios (copied forks, deferred outcomes and lost wait ACK).
Construction tests pass68 assertions with legacy-entry spies, database-byte and
session-directory invariance. Scoped typechecks and bounded reviews pass.
Prior8967ba288 hosted39128212420 passed all gates; this batch needs its own head CI.

Accounting remains unimplemented. Source tracing found that exact persisted
extension lists can omit the generation-source hook, while the factory currently
uses a no-op fallback for unmatched request signals. Mandatory source/admission
coverage must be qualified before reservations are enabled. No private SDK writes,
new ledger, automatic migration or requirement-status promotion is authorised.

## Compaction correlation limitation — 18 October 2026

The public `CompactionTask` invokes `beforeCompact` only while selecting the range,
then persists a `summarize` checkpoint. Resuming that checkpoint directly calls
`runtime.models.completeSimple` without the generation `beforeRequest` hook.
`createRegistry()` explicitly prohibits replacing its built-in tasks. An exported
task definition alone therefore does not authorise a summary-phase replacement.

Strict request-source correlation must cover this path before real source-default
model-backed compaction can be accepted. Existing standalone maintenance tests use
a separately configured model port; factory tiny-history `compacted:false` tests do
not cover summary requests. A single real-factory experiment hit the unchanged
30-second test timeout and was completely reverted; it establishes no causal or
passing runtime proof. No retries, timeout increases or private registry mutation
were used. This narrows HC-010's evidence scope without changing its status label;
no new code, CI execution, deployment or migration accompanied this correction.

## Native parent request accounting — 18 October 2026

The source-default model consumer now uses the existing host request accounting
service for uncapped interactive parent requests with supported stored account
identity and a known price bound. It reserves before asynchronous auth, rechecks
account/source/model authority at the post-auth header boundary, and settles the
original terminal usage before publishing the terminal model result. Each actual
provider invocation gets a fresh request/work ID under its persisted operation's
work. The invocation signal is source authority, not a billing request ID.

Auth denial or account rotation releases an undispatched reservation. Unknown
valuation and settlement-storage failures retain unresolved holds and withhold the
answer. Existing terminal receipts reconcile interrupted operation-work completion
at startup without clearing outstanding holds. No new ledger or SDK-private write
is introduced. The known awaited-header-to-provider interval is unchanged; this is
not an atomic send or provider-exactly-once guarantee.

Actual factory cases cover success, auth denial, unknown valuation, account
rotation, settlement-write failure with database reopen, terminal-work closure
failure with factory reopen, and independent accounting of two tool-turn requests.
Source reviews and scoped typechecks pass. At frozen code head `29c29b5ea`, the
native candidate passed 619 tests / 7,874 assertions / 0 failures; the single root
`ci-fast` run exited 0 with 7,333 pass / 74 baseline skips / 0 fail, plus 25 feature
and 9 build tests. Logs are under `/workspace/reviews/durable-1650/`:
`accounting-final-candidate.log`, `accounting-root-fast.log`, and
`accounting-root-fast.exit`.

All enabled budget caps still deny. Unsupported account identities/pricing retain
the existing uncapped path. Delegate, scheduled and compaction request accounting,
provider-unknown reconciliation and factory adoption of recovered maintenance are
not qualified by this slice. Migration remains last; no deployment or live-state
change occurred. This evidence does not make #1650 acceptance-complete.

## Foreground Delegate request accounting — local qualification

Foreground Delegate model requests reuse the parent request-accounting adapter.
Their source snapshot already validates exact task ownership, the originating
Delegate call, operation/harness identity and current model approval. Each actual
child request gets a fresh reservation and request-work row marked `delegate`,
under the same operation work used by parent requests. Scheduled operations remain
excluded. No separate ledger or nested-budget implementation is introduced.

Three actual-factory cases pass116 assertions: parent plus two children settle four
requests for40 microdollars; unknown child valuation retains two unresolved holds
and active operation work across database reopen while charging only20 microdollars
for known parent usage; existing cap revocation still denies. Scoped typechecks and
bounded logic review pass. Review was of the exact production diff supplied inline;
earlier independent file-reading reviews timed out. No full gate for this subsequent
batch is claimed.

All enabled caps still deny outright. This is uncapped accounting, not parent-cap
or nested-cap enforcement. Automatic recovery/resend reconciliation, scheduled and
compaction accounting, recovered-maintenance adoption and migration are incomplete.

### Foreground Delegate accounting publication gates

Frozen code/evidence head `1e4484322` passed one native-candidate run with exit0:
621 tests / 7,876 assertions / 0 failures across51 files. Its single root `ci-fast`
run also exited0: 7,333 pass /74 baseline skips /0 failures, plus25 feature and9 build
tests. Logs and numeric exit receipts are
`/workspace/reviews/durable-1650/delegate-accounting-{candidate,root}.{log,exit}`.
No duplicate gate or manual hosted rerun was used.

This qualifies the bounded uncapped foreground tracking described above. All enabled
caps still deny outright; scheduled/compaction accounting, automatic recovery and
broader acceptance remain incomplete. Migration is still last; nothing was deployed.

## Uncapped scheduled request accounting — 18 October 2026

Native scheduled model requests now reuse the existing request-accounting adapter.
The validated operation links to its EF-S07 occurrence and scheduled task ID;
operation work retains `scheduled` execution kind and task lineage, while each
provider invocation gets its own child request work and reservation. Foreground
Delegate requests retain their own execution-kind tag under that operation root.
No new ledger or legacy scheduler execution is introduced.

Three actual scheduler cases pass124 assertions: the existing model-denial/cap
revocation matrix, three successfully accounted occurrences (30 microdollars), and
unknown scheduled valuation. Unknown usage leaves an unresolved reservation and
active task-linked work across database reopen, with no fabricated charge or model
answer. Scoped typechecks and bounded source/logic review pass.

Frozen head `d6ed3109a` passed native candidate623 tests /7,878 assertions, exit0.
Its first root gate exited2 solely on an unchanged 5-second EF-S07 checkpoint test
(5,316ms); that exact test passed once at the unchanged limit in2.10s. One final
root attempt on identical code exited0:7,333 pass /74 baseline skips /0failures,
plus25 feature and9 build tests. Both failure and success receipts are retained in
`/workspace/reviews/durable-1650/scheduled-accounting-{candidate,root,root-final}.*`.
No assertions or timeouts were weakened, and no automatic retry followed success.

All enabled caps still deny outright. Compaction accounting, provider-unknown
reconciliation, factory recovered-maintenance adoption and broader acceptance are
incomplete. No deployment, restart or migration occurred; migration remains last.

## Manual compaction accounting and bookkeeping repair — 2026-10-18

Local commits `dd91145e1` through `5da88f1fe` account uncapped manual summary
requests under their exact maintenance task identity. The existing request ledger
records side-prompt work and summary usage; the successful path preserves the
conversation's model and session identity. Unknown usage retains an unresolved
reservation and active maintenance work without publishing a compaction entry or
fabricating a charge.

Startup closes interrupted bookkeeping only after public SDK reads establish a
completed compaction task and its committed compaction entry in the work's bound
chat conversation. Completion requires active root side-prompt work and refuses
unresolved child reservations inside the same transaction. No provider request or
SDK task is replayed or mutated by this repair.

Focused evidence:

- Successful manual summary: 36 assertions.
- Unknown summary: 37 assertions, including actual factory reopen after database
  reopen; the reservation and work stay unresolved/active with no provider resend.
- Callback failure and seeded interrupted bookkeeping: 36 assertions, including
  refusal under an unrelated chat and repair after restoring the original binding,
  without another provider call or charge.
- Engine and qualification typechecks pass. Independent bounded review returned
  READY for startup identity, committed-entry proof and unresolved-hold retention.

Logs and review checkpoint: `/workspace/reviews/durable-1650/maintenance-*` and
`manual-accounting-final-targeted.log`. These local changes have no full candidate
or root-gate receipt yet and have not been pushed. The reopen fixtures seed
interrupted bookkeeping; actual process-crash recovery and resumed-maintenance
adoption are unqualified. Caps still deny, and provider-unknown reconciliation is
incomplete. No deployment, restart or migration occurred.

### Integrated manual-accounting qualification

Frozen source head `7a21b15eaaf25183633db1f918a824aff836cefa` passed the native
candidate: 626 tests / 7,881 assertions / zero failures across 51 files. The shell
wait expired while its original test child continued; the terminal test summary
is retained, with no fabricated shell exit receipt. No second candidate ran.

The single root gate on that unchanged head exited 0: 7,333 pass / 74 baseline
skips / zero failures / 48,406 assertions, plus 25 feature and 9 build tests.
Both bounded reviews returned READY: maintenance dispatch plumbing and startup
bookkeeping repair. Evidence: `/workspace/reviews/durable-1650/manual-accounting-`
`{candidate,root}.log`, `manual-accounting-root.{head,exit}` and the qualification
checkpoint. No timeout, assertion or source changes occurred during qualification.

The accounting batch is qualified for publication. Interrupted live-maintenance
adoption, provider-unknown reconciliation, capped execution, remaining acceptance
and migration are incomplete. No live activation or deployment occurred.

## Explicit interrupted manual maintenance recovery — 2026-10-18

Source head `715ece0f6f05ee04d380daa5ff1bffaaf13789df` adopts exactly one paused,
conversation-owned, non-background manual compaction in a mapped chat. Multiple
candidates, unknown tasks and queued submissions fail closed. Reopening does not
start scheduling. The existing session adapter's maintenance reconciliation entry
explicitly resumes the same task and reuses maintenance exclusion and settlement.
Successful settlement retires recovery authority so later work is not restricted
to the recovered task. Pending host input denies recovery at admission preflight;
the existing idle guard is released before scheduling or provider IO.

The actual-factory fixture passes 42 assertions: a genuine SDK summary checkpoint
and an explicitly seeded lost-usage reservation survive reopen; model/session
identity stays unchanged, one recovered request settles for 10 microdollars and
one compaction entry appears. The original unresolved reservation and active root
budget work remain. Pending input and stopped-backend reconciliation deny without
provider calls. This fixture does not simulate a process crash or prove interrupted
first-attempt accounting through the default factory.

Bounded controller, adapter and preflight reviews returned READY. Engine and
qualification typechecks pass. Single integrated candidate: exit 0, 628 tests /
7,898 assertions across 51 files. Single root gate on the same frozen head:
exit 0, 7,333 pass / 74 baseline skips / zero failures, plus 25 feature and 9 build
tests. No retries, assertion changes or timeout changes. Receipts:
`/workspace/reviews/durable-1650/recovered-maintenance-{candidate,root}.{log,head,exit}`.

Terminal tasks with pending summary writes and multiple maintenance candidates
remain unsupported. Enabled caps deny execution; unknown-cost reconciliation,
remaining compatibility and identity-preserving migration are incomplete. Adaptive
Card side prompts still depend on legacy session construction and need a native
consumer replacement before that runner can be removed. No live activation,
deployment, restart or migration occurred.

## Native card side prompts and legacy runner retirement — 2026-10-18

The card side-prompt HTTP routes now use native durable execution through
`AgentPool.runSidePrompt`. Production no longer hydrates legacy SDK sessions for
side prompts. The old runner is a test-only compatibility fixture; unrelated
legacy session infrastructure has not been removed wholesale.

Each request atomically accepts and claims its own internal source, allocates an
ownerless fork of the mapped conversation and preserves its model, thinking and
tool configuration. Existing host source guards authorise model and tool effects.
Side results settle without a main-timeline message or parent-history changes.
The existing payload store holds immutable inputs and completed retry results;
there is no new ledger or persistent queue.

Focused actual-factory evidence covers native `read`, source-scoped SSE deltas,
observer mutation/failure isolation, caller and HTTP request cancellation,
configured timeout, system-prompt prefix, request accounting, explicit/inherited
budget parents, literal budget work IDs and completed replay after backend reopen.
Unknown cancelled usage retains its reservation and active budget authority;
completion never fabricates a zero charge. Cancellation records and retires its
source with the operation, aborts only the verified isolated fork and joins it.
Main-conversation running cancellation has not gained a broader abort capability.

Completed retry reads validate prompt/parent identity, terminal receipt, payload
integrity and result shape. They can read an existing result after the outer parent
finishes without invoking a provider. Passive recovery before fork allocation
retains exact claimed authority and stays paused until explicit continuation.
Focused tests also cover concurrent retries, intervening main input, transactional
fork/binding rollback, ownership loss and combined wait/abort failures.

Qualification:

- Candidate source `d92a208b2eb30b28d2fddf9739c2e76cd602dcd7`: exit 0,
  633 tests / 7,983 assertions across 51 files.
- Root head `592db8f234f2f8eb6892e1a91af6e738228bf7e2`: exit 0,
  7,342 pass / 74 baseline skips / zero failures, plus 25 feature and 9 build tests.
  The only change after the candidate was a core test-contract migration;
  production and native qualification source stayed unchanged.
- Bounded implementation, lifecycle, accounting, replay and retirement reviews
  returned READY; scoped typechecks pass.

The first candidate failed one fixture tool-selection test. Explicit public
`AgentDoc` fixture configuration corrected inherited test state without changing
the effect assertion. The first root failed four obsolete pool tests expecting
the retired legacy runner; native dispatcher contract tests replaced them while
legacy behaviour tests stayed in the test helper suite. Both failed receipts and
corrected terminal receipts are retained under
`/workspace/reviews/durable-1650/native-side-prompts-*`. No timeouts or production
assertions were weakened; no successful gate was repeated.

Boundaries: empty-history side requests fail before admission; enabled caps still
deny execution; uncertain storage failures retain ownership and require reopen.
General acceptance, live-provider/fleet and production-scale performance evidence,
historical rollback proof and identity-preserving migration are incomplete.
Migration stays last. No live activation, deployment, restart or migration occurred.

## Remaining acceptance work after native side prompts — 2026-10-18

All 45 requirements remain represented: 22 source-qualified, 17 fixture-only,
3 blocked-publicAPI and 3 migration/perf-unverified. The recent native consumer
work changes evidence and scope descriptions, not these conservative levels.

Before migration:

1. Audit remaining production consumers of legacy session construction, extension
   lifecycle and introspection; remove superseded implementations when their real
   consumers have native replacements. Test-only compatibility code is separate.
2. Resolve or explicitly reject capped execution requirements. Current source
   denies enabled caps; known accounting and retained unknown holds are qualified,
   capped execution and provider-unknown reconciliation are not.
3. Resolve public-API blockers for general exact running cancellation and durable
   historical storage/rollback proof. Dedicated side-fork abort is insufficient.
4. Qualify production-history recovery costs and resource limits; synthetic
   100/1,000/2,000-entry measurements do not establish fleet performance.
5. Refresh copied-state upgrade acceptance, preserving chat/session/branch/model
   identity and existing context, then implement identity-preserving migration last.
   Live activation still requires explicit approval.

The evidence ledger contains historical receipts below older baselines; those
sections do not override this dated assessment. Current published implementation
head is `bda68d523`; no merge, deployment, restart or migration has occurred.

## Unused legacy side-session cleanup — 2026-10-18

Source `a5cc945c00b9dd6c72d22fee65136e648a2d2c97` removes the uncalled legacy
side-session reseeding and construction methods, factory options and creation
singleflight state. The native card consumer uses public durable forks. Shared
side-pool disposal, snapshot and MCP failure guards remain; main-session thinking
restoration is unchanged. Method-only tests were removed with their implementations.

Combined independent deletion review returned READY. One native candidate exited
0: 633 tests / 7,983 assertions across 51 files. One root gate on the same frozen
head exited 0: 7,334 pass / 74 baseline skips / zero failures, plus 25 feature and
9 build tests. Scoped typechecks and targeted lifecycle/ownership tests pass.
Receipts: `/workspace/reviews/durable-1650/legacy-side-cleanup-{candidate,root}.*`.
No repeated gates or timeout changes were needed.

The production-consumer audit identified web debug and command discovery still
calling legacy session introspection. Debug requires a native metadata path;
command discovery currently falls back to core commands after the legacy guard
rejects. These consumers are not qualified as replaced. Preprompt-compaction
introspection needs ingress-route analysis before its compatibility path is removed.
Capped execution, public-API blockers, production-scale evidence and migration-last
remain incomplete. No merge, deployment, restart or migration occurred.

## Native web debug and core command discovery — 2026-10-19

Source `0d6124120da258ecb73d97ae9a6cc7684e438ae4` replaces legacy session hydration
for the web debug and core-command discovery consumers. Metadata comes from the
mapped public durable conversation's resolved agent: extension names and detached
tool names/descriptions, with exact binding and ownership checks. The existing
response arrays remain; unavailable legacy provenance, extension commands,
templates and skills are explicit. No AgentSession or extension handler is emulated.

Command discovery uses existing core definitions and aliases. Unbound durable
chats return 404; native metadata failures return sanitised 503 responses without
legacy fallback. Classic, family and visual command consumers read the command
array and tolerate the additive metadata. The actual default-factory HTTP routes
pass without SDK session construction. This does not implement add-on commands.

The ingress audit confirms accepted durable dispatch returns before legacy
preprompt hydration for both settled and pending outcomes; pending work retains
its recovery marker. Legacy preprompt code remains for explicitly injected
compatibility paths.

Qualification: one native candidate exited 0 with 633 tests / 7,988 assertions
across 51 files. One root gate on the same frozen source exited 0 with 7,340 pass /
74 baseline skips / zero failures, plus 25 feature and 9 build tests. Handler tests,
actual-factory and public-runtime metadata tests and scoped typechecks pass.
Bounded review found missing metadata-error handling; both endpoints now have
regression tests. Receipts: `/workspace/reviews/durable-1650/native-metadata-*`.
No retries or timeout changes were needed.

Command-bearing add-ons remain a startup compatibility gap: Goal, Regrets, Board,
voice and M365 still require native capability bindings. Goal's direct settings
API does not replace its five tools, input filtering, usage/progress tracking or
continuation lifecycle. Catalogue denial remains until those consumers are ported.
Caps, general public-API blockers, production-scale evidence and migration-last
remain incomplete. No merge, deployment, restart or migration occurred.
