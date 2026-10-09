# Pin synchronisation and loaded input visibility

Two synchronous SQLite waits and a Visual queue-refresh gap delay input visibility under controlled load. This candidate bounds pin contention, retries queued admission asynchronously and rehydrates Visual queue state from the server after acknowledgement/reconnect. It has not been deployed. The reported live 30-second delay has not been fully traced.

## Measured paths

The [synthetic receipt](../development/receipts/pin-input-load-profile.json) records owned loopback requests against disposable SQLite/WAL databases, a separate two-second writer and real message/pin handlers.

| Workload | Original behaviour | Candidate behaviour |
|---|---|---|
| Pin write plus unrelated HTTP acknowledgement under writer lock | Both responses about 2,050 ms; timer stalled about 2,049 ms | Pin returns explicit 503 in 0.9 ms; unrelated acknowledgement 0.9 ms; timer about 10 ms |
| Actual agent input, durable queued follow-up and SSE under writer lock | HTTP/SSE about 2,090 ms; timer about 2,089 ms | Three runs: HTTP/SSE 2,025–2,032 ms, after durable commit; timer 10.16–10.28 ms; concurrent pin busy response 1.44–1.57 ms |
| Visual compose while queue SSE is absent | Existing queue is invisible; old UI fails the browser fixture | Queued acknowledgement triggers server reconciliation; input visible about 36 ms in rebuilt Chromium/WebKit cases |

The writer still delays durable acceptance; the candidate yields during that wait so other requests/timers can run. It never acknowledges an uncommitted input. Idle actual admission took 31–60 ms across the three candidate runs. These small synthetic runs do not establish whole-system throughput or the full live delay's cause.

## Changes

- Pin DB operations temporarily use `busy_timeout=0` only within synchronous actor/read/transaction scopes, restoring the original connection value in `finally`. Contention produces an explicit 503/Retry-After response. No access pruning or durability setting is weakened.
- The shared pin request retries only 503 with exact `Retry-After: 1`, at most three retries, with one 15-second deadline and one serialised desired-state body. It does not retry authentication, rate-limit or ambiguous network failures. Lifecycle stop aborts backoff.
- Queued single-user web admission uses an immediate read/modify/write transaction with zero synchronous lock waiting and a five-second asynchronous budget. Only confirmed SQLite contention is retried. Every attempt and precommit recheck authority, cancellation, DB handle/binding, canonical config paths and file device/inode. The original timeout is restored before yielding.
- HTTP 201 and queued SSE follow successful commit. A fresh active-run check wakes the exact chat if its previous turn ended while admission waited. Family admission uses its existing authority path; this slice does not change it.
- Visual queue state has one controller owner. Mount, acknowledged queue submission, reconnect and turn end fetch authoritative state. Generations/cancellation suppress stale held GETs; foreign chat and stopped responses cannot publish.
- Queue actions use captured chat URLs. Confirmed remove/steer/edit and persisted reorder invalidate older GETs; failed/ambiguous actions retain local rows until reconciliation. Editing removes the durable queued item before returning its text to compose. Session navigation currently performs full-page reloads.

## Qualification so far

- Combined unit/backend/facade checks: 47 passed / 305 assertions, covering busy/cancel/revoked authority, rollback, deadlines, concurrent fresh writes, lost-wake prevention, stale queue responses and action races.
- Disk pin/binding checks: 10 passed / 39 assertions. Reopened handles and replaced database files are rejected before writing captured state; configuration redirection rolls back. Runtime busy timeout is restored after success, denial and unrelated errors.
- Browser matrix: eight passed / 64 assertions. Existing Classic/Visual model/session pin synchronisation cases pass; real Visual ChatPanel/QueueStack tests cover absent SSE, held snapshots, consumption, cancel/steer, denied actions and chat-scoped URLs. Display panels are stubbed and this queue fixture uses in-memory SQLite; disk behaviour is tested separately.
- Web rebuild: nine passed / 26 assertions. Rebuilt browser replay passed eight / 64. Five typecheck stages pass with 95 unchanged pre-existing frontend transitive diagnostics; strict QueueStack/controller compile, scoped lint, cycle and silent-catch checks pass. Two silent fixture rejection observers were corrected to central debug logging before the full gate.
- Separate source review found and corrected controller/component dual ownership, unscoped action URLs, active-to-idle lost wake and stale DB binding. Final narrow reviews found no additional confirmed blocker.

## Final frozen gate

Frozen head `c3f3cdca9fdbbc7c4c187d4759073d14642d6153`, tree `eb5caa8213e98cb35b2324eae8fdb5cc2d7800ca`, passed `make ci-fast` on 4 October 2026: 6,168 runtime tests, eight existing skips, zero failures / 40,097 assertions in 964.44 seconds; 25 feature tests / 239 assertions and nine web checks / 26 assertions. The tree stayed unchanged through the gate. Local log `/workspace/tmp/ux-pin-input-full-v3/ci-fast.log`; SHA-256 `8b62877be8ded7ad311041381939605bc69c5b42983889ddde1b49316c56a5f2`.

Postgate checks passed 49 tests / 342 assertions, all five typecheck stages with the unchanged frontend baseline, pack hygiene for 24,754 files and stale-dist. Only this qualification prose changed after the frozen gate; runtime/test/asset parity is checked before publication. No production install or restart was performed.

The earlier naive queue acknowledgement append was discarded because a consumed SSE event could precede the HTTP reply and revive an already-consumed row. The candidate uses server snapshots instead. The old UI browser failure is retained; neither timeouts nor functional assertions were relaxed.

The first binding fixture closed its DB while the blocker still held its transaction, consuming the retry deadline. The fixture now releases that writer before synchronous close/reopen. Runtime admission checks captured binding before any PRAGMA on the old handle; the corrected disk case passes. This failure is retained locally.

The first full gate at `99fe46668` exposed one production family model-defaults fixture writing its private config with the default `0644` mode. It was stopped on 4 October 2026 at 12:04 UTC; exit 143 and the failure are retained under `/workspace/tmp/ux-pin-input-full/` (log SHA-256 `939b448d3b530cfd41ced009a80d6860992dfbf0ae2720df81e6790d6f073496`). Running that unchanged file alone reproduced six passes / one failure. Adding `mode: 0o600` to its own newly created config passed seven tests / 87 assertions. The production private-file check and all original model/default/authority assertions are unchanged. A new frozen full gate is required; the stopped run is not passing evidence.

The second full gate at `c1e223fd3` ended with 6,165 passes, eight skips and one failure / 40,087 assertions in 996.83 seconds (exit 2; log SHA-256 `79828372464028bf54ac88e1b17e894501c8356a32527dc900e49dc75981e68d`). Its `/queue` contract test correctly rejected a new unconditional idle wake. Manual `/queue` is explicitly deferred; only compose admission now opts into waking an idle chat after commit. Both initial and fresh busy checks use active-or-streaming, preserving deferral when those flags disagree. Existing expectations were retained, with new streaming/active mismatch and manual-queue-during-admission regressions. The queue-contract subset passed 34 / 228; the broader backend/channel/controller subset passed 143 / 807. Separate review found no further blocker in that correction. Five typechecks, scoped lint, repeated real input/WAL profile and the two-browser queue matrix passed after the runtime change. A third frozen full gate is required.

## Profiling and remaining coverage

A whole-process Bun CPU profile contains fresh schema creation and module loading; native `run` frames dominate (237 samples). Frame URLs are absent, so function names cannot identify precise call sites. Raw CPU output stays local; reviewed aggregate counts are in the receipt. No SQL bind values, private conversation content or credentials were collected.

Synchronous authentication repairs, ordinary timeline message writes, background DB maintenance, browser render CPU and provider/tool-induced event-loop work still need representative measurements. The live 30-second report has not been matched to a complete request trace. A successful isolated run is insufficient to close that investigation. No production install, restart or credential/provider call occurred.
