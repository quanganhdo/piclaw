# #1650 acceptance — 22 October 2026

Native execution and family retirement are implemented. This assessment records the supported implementation and its bounded evidence; it does not certify all original requirements or a fleet rollout. It supersedes the 17 and 19 October assessments. The original 25 HC and 20 PC identifiers and requirement names come from [the crosswalk](earendil-100-durable-crosswalk.md).

## Candidate and preservation

- Base: `95f2de14b721db077ad41bdbe9a7bdf6fd1240db`, including family retirement `e6d459ea`, native control/recovery changes and PRs #1668 and #1682. The acceptance repair is on `fix/native-1650-acceptance`; qualification receipts record its exact source fingerprint.
- Public host SDK: Pi 1.2.0; isolated native engine: pi-durable 1.3.0. Reviewed native add-ons: `e8aac2399148cbef638764ba2b5a1cd916cc5ecc`; historical contract add-ons: `08746aa3f114d49f954c1dff712d9f74acca460f`. Pending dependency updates are separate work.
- Smith's successful fourth controlled cutover is existing operational evidence. Recent model-visible context was imported under the approved bounds; original timelines and archives were retained. Another migration is unnecessary and is not authorised by this assessment.
- Active family account, invitation, browser, HTTP, CLI and build surfaces are retired. Single-user authentication, historical ownership/data, fail-closed retired-mode guards, generic branch families and CSS font families remain. No production schema recreates retired account-preference tables; preservation fixtures explicitly construct historical stores.
- Current acceptance work changes no live data, credentials, service configuration or recovery copies. Source qualification does not install the resulting code.

## Qualification

The complete baseline contained 91 isolated native test files and failed in 12. Repairs retain the original effect/authority checks:

- Projection detachment during verified peer steering rejects and withdraws the exact accepted queue item; it cannot silently become new input.
- Pending manual compaction and session rotation retain their existing command status while the lane is owned. A busy cleanup lane does not revive an old model turn.
- Cross-scope KV rejection returns a fixed error without exposing scope diagnostics.
- Tests use current factory argument positions and canonical reviewed dependency roots. Historical preference fixtures preserve the original table bytes and test frontier mutation. Writer contention tests verify yielding and ownership without extending timeouts.
- SDK model errors produce one failed terminal and a safe notice. Unknown request charges remain held. Revoked tool effects, file/KV writes, private results and provider-call counts remain checked. Lost harness authority and unfinished reopened work remain pending; they are not converted into success or resubmitted.
- The restart worker joins the same committed SDK intent before host ACK repair. A separate receipt observer verifies the SQL/event barrier, and ACK repair does not grant another model entry. Native work creates no legacy inflight marker.

Frozen final source passed all 91 native files (`native-1650-final-v1.native.exit=0`) and all configured engine, qualification and root type gates. The root-only final gate completed `stage=complete`, `exit=0`: **6,842 pass / 74 skip / 0 fail across 940 files**, plus **25 feature** and **9 build tests**, including Classic/Visual builds. Root and native runs have identical source fingerprints. The default factory passes all 100 isolated scenarios; worker recovery passes 42 assertions. A bounded independent review found no blocking finding. These measured results were added after qualification; executable source and tests did not change.

Receipts are under `/workspace/tmp/native-1650-final-v1.*` and `/workspace/tmp/native-1650-root-final-v1.*`. The baseline 12-file failure and concurrent root run killed with exit 137 are retained separately. The killed run is not a passing root receipt; the complete native receipt from that unchanged source remains valid. No assertion failure preceded the root kill. OOM counters were nonzero and the service restarted automatically during the window, but the exact cause was not established. No restart command was issued by this work.

## Supported boundaries

The host keeps admission, exact source/owner checks, atomic terminal publication, delivery and single-user access control. Public pi-durable owns execution, task scheduling, checkpoints, context and recovery. There is no legacy AgentSession fallback, replacement execution queue or automatic retry of uncertain model/tool work.

Operator abort requalifies the exact accepted operation and its live task IDs before each abort, persists cancellation with the host version fence and never escalates to conversation-wide abort. This is bounded accepted-operation cancellation, not an atomic public conditional abort of every possible physical generation. Side prompts may cancel their proven owned fork. Other unsupported controls fail closed.

## Requirements

`Q/` means `qualification/pi-durable-130/`; `E/` means `runtime/durable-engine/src/`; `RT/` means `runtime/test/`. Evidence describes the named source/fixture subset. An unqualified remainder is not accepted by a passing aggregate test count.

| ID | Original requirement | Current bounded evidence | Remaining acceptance |
| --- | --- | --- | --- |
| HC-001 | Simple prompt | Actual default application, HTTP admission, native generation, failed/successful terminal and reopen: `Q/application-web.test.ts`, `Q/default-application-runtime.test.ts`. | All supported authenticated providers and ingress combinations. |
| HC-002 | Tool prompt | Native built-ins, Plan, MCP/codemode and reviewed installed consumers; actual effect and result tests. | Every installed capability, remote transport and fleet profile. |
| HC-003 | Parallel tools | Public tool execution and native Delegate parallel fixtures. | Full completion-order raw commit versus call-order context/projection oracle. |
| HC-004 | Safe replay | Explicit safe-policy checks in `Q/tools.test.ts`; read-only metadata grants no replay authority. | Crash/redeclaration/idempotency matrix for each safe effect. |
| HC-005 | Never replay | Unsafe bash/tool disk reopen, storage and accepted-input recovery fixtures. | Arbitrary external mutations and unknown-outcome reconciliation. |
| HC-006 | Steer | Exact accepted source attachment, projection-loss rejection and committed-intent recovery. | Arbitrary crash placement and every ingress; no exact physical-generation promise. |
| HC-007 | Follow-up | Existing queue materialisation, deferred commands and actual application reopen. | All-ingress/restart FIFO and successor-authorisation matrix. |
| HC-008 | Next run | Host worker retains lane until terminal SQL/event; queued successor tests. | Complete replacement-contract acceptance for the absent public `nextRun` mode. |
| HC-009 | Abort | Exact accepted-operation cancellation, stale/version fences and owned-side-fork cancellation. | Atomic conditional physical-generation abort, non-cooperative effects and all background scopes. |
| HC-010 | Compaction | Manual, threshold/background accounting, lost-observation repair and explicit recovered-task adoption. | Full overflow/budget/revocation/crash policy matrix. |
| HC-011 | Retry | Bridge rejects transport retry widening; current native settings disable implicit retries. | Captured-options/live-policy/deadline changes across restore. |
| HC-012 | Suspension | Paused inspection, observation cancellation, task-scope reopen and explicit scheduling grants. | Missing definitions, task migrations and arbitrary deferred/background graphs. |
| HC-013 | Restore | Host controller, real process-loss windows, disk reopen and committed-source lookup. | Realistic long-history costs and arbitrary recovery graphs. |
| HC-014 | Corruption | Import/receipt/source checks, malformed public records and SQLite rollback/conformance. | Complete malformed-reference/version/torn-tail matrix. |
| HC-015 | Session/Branch/lane isolation | Canonical chat/branch/conversation mapping, copied forks and cross-chat denial. | Full installed multi-chat/domain mutation matrix. |
| HC-016 | Close | Seal/join/close, retained owner on uncertain cleanup and process-death tests. | Non-cooperative callbacks, power loss and fleet takeover. |
| HC-017 | Deterministic drive | Controlled model/effect/storage barriers exercise public automatic scheduling. | No manual Drive API; exhaustive scheduling oracle is unsupported. |
| HC-018 | Hooks/events | Native Plan/Goal hooks, watched committed context and stale-generation filters. | Complete reload, overflow/reconnect, disposal and browser delivery acknowledgement. |
| HC-019 | Usage | Per-request reservations, immutable usage validation, Goal wrap-up and unresolved holds. | Live quota/provider-unknown reconciliation; enabled monetary caps remain restricted. |
| HC-020 | Deferred provider | Host-issued reference/fetch/cancel fixtures and recreated bridge. | Persistent live-provider handles, lineage/deadlines and arbitrary crash polling. |
| HC-021 | Effect admission | Current owner/policy checks at actual filesystem, process and installed-port effects. | No general Gate/zero-effect guarantee across arbitrary non-cooperative callbacks. |
| HC-022 | Effect-start crash | Selected post-boundary SIGKILL and unsafe reopen cases. | Surviving children and arbitrary external effect outcomes. |
| HC-023 | Drive/host ownership | Strict process owner before storage, real contender/death cases and stale-token rejection. | Other OSes, fleet takeover and arbitrary external effects. |
| HC-024 | Storage migration | Actual offline copy, bounded recent-context import, successful Smith cutover and preserved original history. | General full-history conversion and reverse conversion after new native work are outside current approval. |
| HC-025 | Backend/fork parity | Public SQLite conformance, memory fixtures and copied native fork contexts. | Full JSONL equivalence, writable-fleet ownership and production resource bounds. |
| PC-001 | Ordinary accepted message | HTTP → accepted source → actual worker/native runtime → one terminal; no legacy fallback. | Every supported non-web ingress and live provider failure combination. |
| PC-002 | Exact steer | Host source/version/harness binding and accepted-intent materialisation/consumption. | Arbitrary completion/successor races across all ingresses. |
| PC-003 | Stale steer | Wrong owner, target, source digest, detached projection and rollback rejection. | Complete producer/successor race matrix. |
| PC-004 | Exact cancellation | Captured accepted-operation/version, live-task requalification and cancellation precedence. | Full physical-generation and arbitrary background-effect contract. |
| PC-005 | Stale cancellation | Completed/version-changed operations and foreign live input rejection. | Exhaustive successor/completion races. |
| PC-006 | Late completion after cancellation | One cancellation disposition and suppressed late publication in selected native/side cases. | Every provider/task/effect interruption path. |
| PC-007 | Terminal commit fault matrix | Real/fake named-statement parity, payload/media rollback and one committed terminal. | Arbitrary fault placement and live downstream delivery. |
| PC-008 | Restart with open run | Current controller/worker joins exact committed submissions, repairs host ACK and holds lane. | Arbitrary crash graphs, scheduled recovery and external exactly-once effects. |
| PC-009 | Pending steer restart | Before-submit/committed-ACK-loss windows, paused recovery and exact source/request IDs. | All-ingress FIFO and arbitrary process-loss windows. |
| PC-010 | Protected hand-off | Owned native Delegate/side execution and command exclusion; unsupported controls reject. | Full successor/control matrix across every installed consumer. |
| PC-011 | Mutation containment | Revocation blocks actual file/KV/worksheet/review/codemode effects and private result publication. | Arbitrary unsafe effects and reload/operator reconciliation. |
| PC-012 | Scheduler agent task | Actual scheduler → native owned fork → existing settlement/delivery; uncapped accounting. | Full stale-delivery/revocation/crash and enabled-cap policy matrix. |
| PC-013 | Scheduler shell task | Existing shell scheduler remains separate from native agent dispatch; regression tests retained. | Native-mode Pushover/delivery equivalence and operational failure matrix. |
| PC-014 | Stale SSE generation | Native watch identity, existing status surface and captured side-observer fences. | Full browser reconnect/skin coverage and acknowledgement. |
| PC-015 | Mobile Abort | Server-side native operation abort exists with the same owner/version checks. | Explicit mobile/completion/successor acceptance; no legacy-test substitution. |
| PC-016 | Protected evidence | Allowlisted DTOs, private reasoning/result separation and bounded failed-turn diagnostics; generic KV denial. | Complete logs/export/telemetry secret audit for every consumer. |
| PC-017 | Maintenance failure | Failed observation retains command/worker; terminal publication cannot be undone by maintenance. | Every maintenance/cleanup fault boundary and operational rollback. |
| PC-018 | Trusted internal input | Native host input, scheduled/side/Goal sources share host admission and policy checks. | Every internal ingress and policy-revocation boundary. |
| PC-019 | Cross-session steer | Exact native target revision, peer ingress, dedup and permission checks with network-free transport. | Full live transport/offline/ACK/reconnect matrix. |
| PC-020 | Goal/checkpoint race | Native Goal usage/settlement/terminal tests and actual default Goal/budget/steer fixtures. | Legacy deadline checkpoints and arbitrary mixed-source carry/disposal transitions. |

## Closure decision

Keep #1650 open until the final exact-source gates, remaining browser/failure-path acceptance, installed-source/data-preservation provenance and acceptance of explicit exclusions are recorded. Family retirement supersedes #1133/#1134; their former multi-user container gates were not certified. #1132 needs separate triage. No deployment, restart, new migration or expansion to full model-visible history follows from this document.
