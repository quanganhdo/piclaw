# Historical #1650 acceptance — 19 October 2026

The [22 October assessment](pi-durable-130-acceptance-current-20261022.md) supersedes this page's current-state claims. Source revisions, counts and gaps below retain their dated scope; no current operational state follows from them.

The implementation is incomplete. Native Goal and soft token-budget wrap-up are
adopted in source. Legacy deadline checkpoints, general exact running cancellation,
historical rollback proof and whole-history migration still prevent acceptance.
Full-gate source: core `08991f990`; the ordinary-steer successor below has separate
focused qualification. The captured-current continuation contract below has a
separate focused gate. Goal add-on `92de0be`. No running service was installed,
activated, migrated or deployed.

## Design goal

Simplify Piclaw internals. Defer execution, tool orchestration, scheduling,
checkpoints and recovery to public pi-durable APIs wherever possible. Delete
replaced code. Keep only Piclaw's necessary application authority, persistence
and UI/queue boundaries. Add no parallel runner, scheduler, ledger or emulated
AgentSession lifecycle. Migration reuses the existing strict workflow and runs last.

## Qualification boundary

- Corrected-head sequential gates on `08991f990` completed with numeric exits0:
  root `make ci-fast` **7,365 pass / 74 skip / 0 fail / 48,476 assertions**,
  feature stages **25/253** and **9/26**, including the web build; candidate
  **637 pass / 8,120 assertions / 51 files**; explicit Goal **46 pass / 680
  assertions / 5 files**. Source remained clean and unchanged throughout.
  Receipts: `reviews/durable-1650/corrected-head-{root,candidate,goal}.log/.exit`;
  source identity: `corrected-head.source`. This is local qualification; hosted
  CI, the separate root typecheck baseline and whole-epic acceptance remain open.

- The inherited candidate finished 632 pass / 4 assertion failures / 8,107
  assertions across 51 files. Its parent timed out; no shell exit was recorded.
  The four failures were deferred-compaction ordering, not test timeouts.
- The repaired queue service and control runtime pass 22 tests / 142 assertions;
  the actual application suite passes all seven scenarios. No timeout or existing
  assertion changed. Circular-dependency and silent-swallow checks pass.
- The root gate at `70e9937ea` was deliberately interrupted after review found
  source defects; its candidate/Goal stages never started. The receipt is
  `reviews/durable-1650/native-closeout-gates.interrupted`. No terminal root totals
  or green exit are inferred. Earlier failed receipts remain separate.
- Corrected source `3cbc12b6e` passes the explicit five-file Goal gate: 37 tests /
  557 assertions; actual-default Goal: 1 test / 57 assertions; legacy manager
  retirement: 47 tests / 181 assertions. All are distinct focused receipts.
  The later corrected-head full root/candidate receipt is recorded above.
- Engine and qualification types pass. Root types reach the existing web-compose
  audited-baseline check, which rejects changed diagnostic line locations; that
  stage is not green. No unrelated baseline edits were made.
- The first file-reading helper review timed out. Self-contained independent
  reviews then approved the transaction helpers, found two receipt-reader defects,
  and approved the corrected production diff. The fixes reject stale native Goal
  mutations and account usage before an additional accepted steer boundary.
  Default wiring retains its earlier bounded READY receipt. Whole-epic acceptance
  and hosted CI have not been refreshed by those bounded reviews.

The corrected source shares committed-generation usage validation between live
and recovery reads, reuses the settled receipt window and deletes two uncalled
legacy side-session cleanup methods. Pi-durable retains ownership of tasks,
generation/tool outcomes, ordering and recovery; no new execution state machine
or checkpoint scheduler was added.

## Requirement levels

All original 25 HC and 20 PC requirements are retained: **22 source-qualified,
17 fixture-only, 3 blocked-publicAPI, 3 migration/perf-unverified**. Source-qualified
means that the named application consumer exists with bounded evidence; no row
means live/fleet acceptance. Unchanged evidence retains its earlier receipt scope.

Prefixes: `E/` = `runtime/durable-engine/src/`; `A/` =
`runtime/src/agent-pool/`; `Q/` = `qualification/pi-durable-130/`;
`RT/` = `runtime/test/`; `SE/` = `RT/service-effects/`.

| ID | Original requirement | Status | Source / evidence | Missing acceptance |
| --- | --- | --- | --- | --- |
| HC-001 | Simple prompt | source-qualified | `E/default-application-runtime.ts`, `E/application-bootstrap.ts`; `Q/default-application-runtime.test.ts`, `Q/application-web.test.ts` | Actual default synthetic HTTP acceptance→answer→EF-S02/reopen works; live authenticated providers and rollout are unverified. |
| HC-002 | Tool prompt | source-qualified | `E/host-builtins.ts`, `E/host-extension-catalog.ts`, `E/host-goal-tools.ts`; actual-default and installed catalogue qualification. | Seven Linux built-ins, Plan, bounded Delegate/Code Review, editable tables, Office, Draw.io, stdio MCP/codemode and five Goal tools have native consumers. Wider fleet, remote transports and every installed add-on are unqualified. |
| HC-003 | Parallel tools | fixture-only | `Q/tools.test.ts`; ordering obligation in `earendil-100-durable-crosswalk.md` | Preparation/results do not prove completion-order raw commits versus call-order context/projection. No dedicated candidate ordering oracle. |
| HC-004 | Safe replay | fixture-only | `E/host-tools.ts`; `Q/tools.test.ts` | Explicit safe-policy tests do not supply crash/redeclaration/idempotency/replay-authorisation matrix. Default host builtins remain unsafe. |
| HC-005 | Never replay | fixture-only | `Q/sqlite.test.ts`, `Q/bash-port.test.ts` | Selected executing unsafe calls do not rerun on reopen; arbitrary external mutation/unknown-outcome reconciliation needs per-effect policy. |
| HC-006 | Steer | source-qualified | `A/durable-queued-steering.ts`, `E/host-recovery.ts`; `Q/accepted-steer-recovery.test.ts`, `RT/channels/web/input-source-admission.test.ts` | Exact host operation/source and selected recovery work; exact physical-generation steering and arbitrary crash placement are unproved. |
| HC-007 | Follow-up | source-qualified | `A/durable-queue-dispatch.ts`, `E/application-bootstrap.ts`, existing web queue/materialisation; `Q/application-web.test.ts`. | Stable non-UUID accepted identities now dispatch. Admission of input behind a deferred control waits for normal materialisation, preserving the command's idle guard and queue order. Seven real application scenarios pass after repairing four assertion failures. All-ingress/restart FIFO still needs acceptance. |
| HC-008 | Next run | source-qualified | `A/durable-queue-dispatch.ts`; `SE/service-work-store-contracts.test.ts`, `Q/worker-recovery.test.ts` | Host settlement/worker barrier replaces the absent public `nextRun`; all producer/restart barrier cases and full replacement-contract acceptance are unproved. |
| HC-009 | Abort | blocked-publicAPI | `E/host-runtime.ts` `cancelInput`; `Q/runtime.test.ts` | No atomic public conditional exact running abort; placed input returns `already_placed`. Host cancellation fences publication but does not stop that task. |
| HC-010 | Compaction | source-qualified | Public SDK manual compaction, existing per-request accounting and explicit recovered-maintenance adoption; `Q/default-application-runtime.test.ts`, `Q/application-web.test.ts`. | Bounded manual summary/reopen/bookkeeping paths are exercised. Automatic/background/overflow policy matrices, multiple recoverable candidates and arbitrary process-crash adoption are unqualified. |
| HC-011 | Retry | fixture-only | `E/default-application-runtime.ts` disables retry; `Q/models.test.ts`, `Q/src/fixture.ts` | No full captured-options/live-policy/restart-deadline/budget matrix; historical captured retry-policy guarantee changed. |
| HC-012 | Suspension | fixture-only | `E/host-runtime.ts` `wait`/`reconcile`; `Q/runtime.test.ts`, `Q/models.test.ts` | Detached observation and selected deferred cases do not qualify all missing definitions, task migrations or background scopes. |
| HC-013 | Restore | migration/perf-unverified | `E/host-controller.ts`, `E/host-recovery.ts`; `Q/single-database.test.ts`, `Q/cross-store.test.ts`, `Q/accepted-steer-recovery.test.ts` | Selected disk/process recovery works; bounded 100/1,000/2,000-entry read measurements exist below. Production-history costs and arbitrary recovery graphs are unqualified. |
| HC-014 | Corruption | fixture-only | `Q/migration.test.ts`, `Q/copied-upgrade.test.ts`, `Q/sqlite.test.ts` | Import/public-document/facade rejection tests do not cover the full durable reference/version/torn-tail/corruption matrix. |
| HC-015 | Session/Branch/lane isolation | source-qualified | `E/default-application-runtime.ts`, `E/session-tree.ts`; `Q/db-tree.test.ts`, `Q/default-application-runtime.test.ts` | Canonical public routing/identity and copied forks are bounded; full installed multi-chat authority-domain/branch mutation parity is unqualified. Root ID 1 is store-local. |
| HC-016 | Close | source-qualified | `E/application-bootstrap.ts`, `runtime/src/runtime/shutdown.ts`; `Q/host-controller.test.ts`, `RT/runtime/queue-backstop-ownership.test.ts` | Stop/join/close and uncertain-cleanup ownership are wired; non-cooperative callbacks can prevent completion indefinitely. Process death is separate from power loss. |
| HC-017 | Registry/effect ports | source-qualified | `E/default-application-runtime.ts`, `E/host-extension-catalog.ts`; installed catalogue and actual-default tests. | The default composes native tools, tasks, hooks and codemode. Goal now has native tools, input, commands and Settings. Legacy card runner and side-session construction were retired earlier. Other command/event add-ons still fail closed; do not emulate AgentSession. |
| HC-018 | Hooks/events | source-qualified | `E/host-plan-prompt.ts`, `E/host-goal-{prompt,terminal,input,settlement}.ts`; `Q/goal-tools.test.ts`, actual-default Goal scenario. | Native hooks replace Plan/Goal legacy handlers. General extension reload/lifecycle parity, browser acknowledgement and legacy Goal deadline recovery are unsupported or unqualified. |
| HC-019 | Usage/quota/backoff | fixture-only | Existing per-request ledger for uncapped parent/Delegate/scheduled/manual-compaction/side requests; committed Goal usage and terminal-effect tests. | Goal accounting uses strict accepted-operation receipts and the existing KV cursor. Soft token-budget exhaustion permits only its own native run's wrap-up or a current explicitly admitted wrap-up; tools are fenced. Final-answer exhaustion atomically admits one wrap-up behind human input. Enabled monetary caps still deny; provider-unknown reconciliation/live quota matrices remain incomplete. |
| HC-020 | Deferred provider | fixture-only | `E/host-models.ts`; `Q/models.test.ts` | Selected synthetic handle/fetch/cancel/recreated-bridge cases do not prove persistent live-provider handle authority, polling/deadlines/lineage. One poll per resume is no public guarantee. |
| HC-021 | Effect admission | source-qualified | `E/host-builtins.ts`, `A/host-grep.ts`, `A/host-tool-process.ts`; `Q/host-builtins.test.ts`, `Q/host-grep.test.ts`, `Q/bash-port.test.ts`, `Q/models.test.ts` | Actual filesystem/spawn boundaries are guarded for selected ports. No general Gate/zero-effect guarantee; accepted provider microtask race is separate from exact-abort API gap. |
| HC-022 | Effect-start crash | fixture-only | `Q/cross-store.test.ts`, `Q/accepted-steer-recovery.test.ts`, `Q/bash-port.test.ts` | Fixed post-boundary SIGKILL/unsafe reopen evidence does not resolve arbitrary surviving children or external unknown outcomes. |
| HC-023 | Drive/host ownership | source-qualified | `runtime/src/runtime.ts`, `runtime/src/runtime/single-instance.ts`, `E/application-bootstrap.ts`; `RT/runtime/queue-backstop-ownership.test.ts`, `Q/ownership.test.ts` | Strict Linux owner precedes storage and uncertified exits retain lock. Fleet takeover/operator reconciliation, other OSes and arbitrary external effects are unqualified. SQLite locks alone do not own effects. |
| HC-024 | Storage migration | migration/perf-unverified | `E/{legacy-import,copied-upgrade,copied-installation,application-upgrade,runtime-upgrade-workflow}.ts`; existing migration/copy/workflow qualification. | Narrow strict migration is implemented. Whole realistic history, pending authority, current add-on compatibility, identity-preserving production cutover and post-new-work reverse conversion are unqualified. Existing checkpoints/unsupported records must reject without discarded history. Live cutover requires approval. |
| HC-025 | Backend/fork parity | migration/perf-unverified | `Q/test.ts`, `Q/sqlite.test.ts`, `Q/migration.test.ts`, `Q/single-database.test.ts` | Memory/SQLite/copied forks do not establish full JSONL parity, streaming-fork equivalence, writable-fleet ownership or production performance/resource bounds. |
| PC-001 | Ordinary accepted message | source-qualified | `E/application-bootstrap.ts`, `A/durable-queue-dispatch.ts`; `Q/default-application-runtime.test.ts`, `Q/application-web.test.ts` | Default SQL admission/worker dispatch/settlement and fresh chat creation are present; every non-web ingress and live deployment need qualification. |
| PC-002 | Exact steer | source-qualified | `A/durable-queued-steering.ts`; `SE/service-work-queued-steer.test.ts`, `Q/accepted-steer-recovery.test.ts` | Exact host target/source/version attach/materialise/consume works; no exact physical-generation or arbitrary cross-session guarantee. |
| PC-003 | Stale steer | source-qualified | `A/durable-queued-steering.ts`; `RT/channels/web/input-source-admission.test.ts`, `SE/service-work-queued-steer.test.ts` | Selected finished/version/harness mismatch and rollback cases reject; general producer/successor race coverage is incomplete. |
| PC-004 | Exact cancel | blocked-publicAPI | Main accepted-input cancellation still lacks atomic public conditional running-task abort. Native side prompts may abort only their verified ownerless isolated fork after durable cancellation-source attachment; this does not authorise a main-conversation abort. | Wider acceptance remains unqualified as described in the evidence column. |
| PC-005 | Stale cancel after completion | fixture-only | Main stale/queued withdrawal checks and held side-fork signal/disconnect/timeout cases have source-backed tests. Side cancellation joins the isolated task and retires its cancellation source; unknown usage stays held. General main running cancellation still depends on PC-004. | Wider acceptance remains unqualified as described in the evidence column. |
| PC-006 | Late completion after cancellation | source-qualified | `E/host-runtime.ts`; `Q/host-handoff.test.ts`, `Q/cutover-runtime.test.ts`, `Q/runtime.test.ts` | Host cancellation suppresses late success/settlement publication in selected races; no provider/task interruption claim. |
| PC-007 | Terminal commit fault matrix | source-qualified | `E/application-bootstrap.ts`; `SE/terminal-settlement-atomicity-races.test.ts`, `SE/terminal-settlement-payload-redaction.test.ts`, `Q/host-handoff.test.ts` | Actual EF-S02 owner/atomic settlement is composed; arbitrary cross-file fault placement and live delivery matrix are unqualified. |
| PC-008 | Restart with open run | source-qualified | `E/host-controller.ts`, `E/host-recovery.ts`, `A/durable-recovery-dispatch.ts`; `Q/host-controller.test.ts`, `Q/worker-recovery.test.ts`, `Q/single-database.test.ts`, native scheduler scenario in `Q/default-application-runtime.test.ts` | Bounded identity discovery, paused authorisation and completed-schedule reopen work. Unknown/background work fails closed; automatic accepted-agent takeover, arbitrary scheduled crash recovery and external exactly-once acceptance are unqualified. |
| PC-009 | Pending steer restart | source-qualified | `E/host-recovery.ts`, `E/application-bootstrap.ts`; `Q/accepted-steer-recovery.test.ts`, `Q/host-recovery.test.ts`, `Q/worker-recovery.test.ts` | Clean reopen and both SIGKILL windows are existing evidence; application recovery reads real host records. Arbitrary windows/all-ingress FIFO are unqualified; fixture-only identity table is no longer the sole source implementation. |
| PC-010 | Native/official tools | fixture-only | Native installed catalogue, tools, codemode and Goal actual-default qualification. | Native consumers replace supported legacy registrations. The remaining installed commands/events, full MCP/SSH and fleet capability matrix are incomplete. More adapters alone do not satisfy application adoption. |
| PC-011 | Mutation containment | fixture-only | `E/host-tools.ts`, `E/host-builtins.ts`; `Q/tools.test.ts`, `Q/bash-port.test.ts`, `Q/host-builtins.test.ts` | Selected effect fencing works; unsafe interrupted effects, all installed ports and reload containment/reconciliation remain incomplete. |
| PC-012 | Scheduler agent task | source-qualified | Actual scheduler → AgentPool → public owned fork; existing EF-S07 source/terminal/delivery ownership; `Q/default-application-runtime.test.ts`. | Approved model overrides and uncapped per-request scheduled accounting are integrated. Enabled applicable caps deny. Exact running cancellation, approval-revocation-during-await and arbitrary-crash/stale-delivery matrices remain unqualified. |
| PC-013 | Scheduler shell task | fixture-only | `Q/scheduled.test.ts`, `runtime/src/task-scheduler.ts` | Candidate agent dispatch rejects shell; retained shell regression path does not establish candidate-mode Pushover/delivery equivalence. |
| PC-014 | Stale watch delivery | source-qualified | EF-S08 filters stale incarnation/session/operation/generation observations. Card side HTTP SSE forwards only exact captured source events; mutation/throwing observers cannot change provider accounting, and aborted request observers stop. Actual HTTP success/disconnect is tested; full browser reconnect/skin coverage remains unqualified. | Wider acceptance remains unqualified as described in the evidence column. |
| PC-015 | Mobile Abort | blocked-publicAPI | `E/host-runtime.ts`; `Q/runtime.test.ts` | No candidate mobile→exact running-task abort proof; same API gap as PC-004. Legacy mobile tests cannot fill it. |
| PC-016 | Protected evidence | source-qualified | `E/host-projection.ts`, `E/host-tools.ts`; `Q/projection.test.ts`, `Q/tools.test.ts`, `Q/models.test.ts`, `Q/application-web.test.ts` | Selected sanitised DTOs/results/private reasoning/materialisation work; persisted logs/exports/telemetry need a complete secret audit. |
| PC-017 | Legacy rollout | fixture-only | Published source defaults to the durable factory, with no production JSONL fallback; the production side-prompt runner is now test-only. Shared-DB/new-chat/guarded-consumer tests and copied upgrade fixtures pass, but existing production chat history still requires migration. No live fleet cutover or general legacy-session retirement is qualified. | Wider acceptance remains unqualified as described in the evidence column. |
| PC-018 | Trusted internal input | fixture-only | `A/durable-runtime-adapter.ts`; `Q/scheduled.test.ts`, `Q/runtime.test.ts`, `RT/channels/web/alternate-ingress-guards.test.ts` | Selected claimed/scheduler ports and admission seals exist; every internal ingress still needs acceptance/budget/owner proof. |
| PC-019 | Cross-session steer | fixture-only | `A/durable-queued-steering.ts`; `SE/service-work-queued-steer.test.ts` | Local accepted steer is chat-bound; no complete cross-session acknowledgement/retry/dedup/offline acceptance proof. |
| PC-020 | Goal/checkpoint race | fixture-only | `E/host-goal-{input,prompt,usage,settlement,terminal}.ts`; `Q/{goal-tools,goal-usage,goal-settlement,goal-terminal-race}.test.ts` and actual-default Goal/budget. | Bounded lifecycle, completion/stop/update, committed usage, terminal rollback/replay, Plan/progress, continuation close/reopen, accepted-steer accounting, Goal-prefix/ordinary-tail settlement and soft token-budget wrap-up are integrated. Bounded production reviews are READY. Legacy deadline checkpoints, arbitrary mixed-input lifecycle/budget transitions and general cross-session/carry/disposal races remain unqualified. |

## Hard boundaries

1. Token-budget wrap-up is soft, not a hard provider-cost cap. It uses native
   generations/tool hooks and existing queue/transaction authority. Enabled
   monetary caps and `usage_limited` recovery still fail closed. Legacy deadline
   checkpoints remain unsupported; do not reproduce their old scheduler.
2. The current public SDK cannot atomically condition a main running-task abort
   on Piclaw's exact accepted operation/generation. Host publication fencing and
   isolated side-fork cancellation have narrower guarantees. HC-009, PC-004 and
   PC-015 need a public API or an explicit requirement decision.
3. Existing copied migration keeps strict supported-record, identity, provenance
   and quiescence requirements. Unsupported real history must reject intact;
   no sanitising, dropped entries, invented baseline or live cutover is permitted.
4. Source-head tests, independent review, publication and exact-head hosted CI
   are separate gates. Source push/merge is authorised. Running-service install,
   restart and live migration require separate approval.

## Native token-budget wrap-up — source `76e5f81ec` / add-on `92de0be`

- Five-file Goal gate: **44 pass / 626 assertions**; actual default Goal:
  **1 pass / 60 assertions**; actual default budget/reopen/human tool/FIFO/replay:
  **1 pass / 97 assertions**; application scenarios: **7 pass**. Separate Goal
  add-on gate: **97 pass / 1,477 assertions** across three files. Engine, candidate
  and add-on types plus circular/silent-swallow checks pass. These are focused
  gates, not a complete root/candidate run.
- One shared add-on claim owns the existing `budget_limit_reported` flag; native
  and legacy consumers reuse it and the same visible prompt builder. No new
  checkpoint scheduler, execution ledger, runner or payload store was added.
- The existing usage cursor binds the budget transition to its accepted generation
  and host operation. An older operation's cursor or an external limited snapshot
  cannot grant a wrap-up. Explicit current budget inputs also pass the shared
  lifecycle/objective resolver. Ordinary separate user work is not Goal-charged.
- Queued provenance retains the full immutable-intent digest and adds a content
  digest. This lets native startup verify materialised inputs and their exact
  terminal replies after queue removal. Content tampering is still rejected;
  proof-less older candidate queued shapes are not silently trusted.
- Independent production diff review: READY within unchanged authority contracts;
  SHA-256 `a86e270d606ab404095a4ba2e6ffa3466b5d1a0d074da77003217039cee7eba1`.
  Final production diff is byte-identical to that reviewed diff. Local receipts:
  `reviews/durable-1650/native-budget-*` and `native-budget-final-*`.

## Native same-Goal steer settlement

The settled readers reuse publication's existing verified source/binding/SDK-state
collection. They account from primary acceptance through the operation's final
answer, permit only its verified accepted boundaries, and validate each intent's
physical payload hash. Terminal Goal proof starts after the last owned acceptance.
Settlement validates every input's Goal identity before updating the usage cursor.
No execution, scheduling or recovery mechanism was added.

- Real SDK/shared-database A→accepted B→settlement, pre-settlement reopen,
  post-settlement replay/reopen and terminal completion pass. Both sources are
  consumed once; accounting stays at 6 or 12 tokens without extra model calls.
- At `08991f990`, intent payload tampering rejects and ordinary B cannot inherit A's Goal authority:
  settlement rejects, leaves both sources unconsumed and charges zero Goal tokens.
  That source did not support mixed-input continuation.
- Five-file Goal gate: **46 pass / 680 assertions**. Exact-path runtime/recovery:
  **62 pass / 937 assertions**. Actual-default Goal and budget: **1/60** and
  **1/97**. Public conversations and thinking: **1/162** and **1/169**.
  Engine/candidate types, circular/silent-swallow and whitespace checks pass.
- Initial Goal failures were shared-fixture idempotency/program state and stale
  exact call IDs. An accidental four-file selection returned 158 pass/2 fail;
  both failures were `find` without `fd` on the test shell PATH. Corrected runs
  use the existing `/home/agent/.pi/agent/bin/fd` 10.3.0, without installation or
  service changes. Assertions, history and timeouts remain intact.
- Bounded production-diff review: READY; SHA-256
  `d2a44ade9461b36f155440ba55b1d7c23bd2559931d4b51cd408c8b78cb12183`.
  Receipts: `reviews/durable-1650/native-goal-steer-final-*`. Corrected-head gates
  pass as recorded above. All 45 requirement statuses remain conservative and
  unchanged: 22 source-qualified, 17 fixture-only, 3 blocked-publicAPI and 3
  migration/performance-unverified.

## Goal prefix followed by ordinary steering

The successor to `2084044eb` permits an ordinary tail to settle the whole owned
operation. The existing verified input/usage batch now retains each accepted
text's SDK entry position. SDK custom inputs queue outside the transcript and
steers are placed after the current tool round (candidate README410–441).
Only receipts before the first ordinary placement enter the Goal cursor; later
receipts remain ordinary. Goal inputs after an ordinary tail reject.

- Actual shared-file SDK A→ordinary B settles and consumes both sources. All6
  tokens remain in the raw receipt window; only A's3 tokens count toward Goal.
  Payload tampering rejects, and repeated settlement/reopen does not add usage
  or model calls. Existing same-Goal6-token and terminal12-token cases still pass.
- Atomic continuation tests cover rollback/retry, zero paid prefix without a
  cursor, and a budgeted prefix. An empty prefix cannot turn an external limited
  snapshot into wrap-up authority: the existing own-operation budget proof is
  rechecked before claim/admission. The ordinary11-token receipt is excluded from
  the7-token prefix; budget wrap-up uses existing claim/FIFO admission.
- Goal **49/771**, runtime/recovery **62/937**, actual default Goal **1/60** and
  budget **1/97** pass. Engine/candidate types, circular/silent-swallow checks
  and whitespace checks pass. No full root/candidate rerun for this successor;
  the `08991f990` broad receipts remain specific to that source.
- Bounded static production review READY; final diff SHA-256
  `cdf2a1d9f20d9b16d6d7ce0e09f467551c69383d0c321ea65327238f7c0c5467`.
  Receipts: `reviews/durable-1650/native-ordinary-steer-*`.
- Live mixed accounting still waits until settlement. An ordinary input arriving
  after an already exhausted live Goal budget, external lifecycle replacement,
  and arbitrary alternating Goal/ordinary runs retain their fail-closed limits.
  No runner, scheduler, ledger or legacy compatibility shim was added.

## Captured current instructions for continuation — importer v2

Importer v2 prefixes genuinely captured current host instructions to future
continuation context. Historical records and their original system messages stay
unchanged. The injected system message uses timestamp0 and carries no historical
instruction-time assertion. Version1 copied manifests reject.

- Native root receives one continuation seed. An imported compaction prefixes
  those instructions to its public model messages, preserving the legacy context
  order across the new head. Forks inherit the root seed; shared-source current
  prompts must agree. Source audit records, identities and complete mappings stay
  intact through rollback, retry, fork and SQLite reopen.
- Historical system messages use `app.legacy-message`. UI projection keeps them
  private only after an exact immutable-provenance match. Native instructions
  never become an additional visible conversation acknowledgement.
- Final copied/import/workflow/application gates: **119 pass / 2,405 assertions /
  8 files**, exit0. Resident capture: **14 pass / 65 assertions**, exit0.
  Engine and candidate types pass. Bounded static production review: READY;
  SHA256 `e41983d941f39872777cd538ceda8828ab71c0616b9159e7d0843a178a70bc78`.
  Receipts: `reviews/durable-1650/current-instructions-final-*`,
  `current-instructions-capture.*` and `current-instructions-projection-fixed.*`.
- These are focused gates. Whole real-history bounds, thinking/custom/context-edit
  coverage and pending authority still need qualification. All45 requirement
  classifications stay22 source-qualified/17 fixture-only/3 blocked-publicAPI/
  3 migration-perf-unverified. No live capture, drain or cutover occurred.

## Whole real-history preflight (earlier source `3cbc12b6e`)

A read-only probe copied three closed historical files of the actual main chat,
then removed the private copies after comparing source/copy/source SHA-256 hashes.
It preserved the authoritative chat and branch IDs and did not select or rewrite
history records. No source file or live database was modified.

| Whole source | Bytes | Entries | Initial blockers |
| --- | ---: | ---: | --- |
| 8 May session | 4,939,231 | 3,697 | No non-empty persisted baseline; over the default 1,000-entry bound; includes thinking blocks. |
| 25 July header-only session | 133 | 0 | Empty history and no persisted baseline. |
| 19 October 03:33 session | 9,929,355 | 2,470 | No non-empty persisted baseline; exceeds default byte/entry bounds; includes custom messages, a context edit and thinking blocks. |

The probe stops before importer execution when a required persisted baseline is
absent. It is a compatibility inventory, not a successful import or sealed/drained
runtime capture. The currently active session was excluded. Pending work and Goal
checkpoint authority were not drained or migrated. Detailed metadata and hashes:
`reviews/durable-1650/copied-real-history-preflight.json` (local, no message text).

Production-history acceptance fails on these whole files. Reuse the existing
importer to address those concrete unsupported shapes; do not add another
migration framework, raise limits silently, invent a baseline or discard records.

## Earlier receipts

[17–19 October incremental evidence](pi-durable-130-acceptance-current-20261017.md) preserves historical source,
publication, measurement and failure receipts. Its earlier implementation states
and older CI totals do not qualify the current source.
