# Ordinary idle input admission

Ordinary single-user web inputs now wait asynchronously for SQLite write admission while preserving atomic message/media/thread state. This follow-up addresses the idle-message blocking path measured after merged PR #1542. It is source-only; the full live thirty-second delay has not been fully traced.

## Boundary

Preparation snapshots input/options/media IDs and allocates one stable message ID, timestamp and Markdown spill buffer. A five-second bounded asynchronous admission loop acquires an immediate transaction with zero synchronous busy waiting and restores the connection setting before yielding. Authority, cancellation, DB handle, file identity and config paths are checked before captured-handle use and before/after mutation.

Inside that transaction, storage validates media and either:

- writes generated spill media, message, attachments/FTS, self-thread/explicit thread, optional deferred consumption/protected continuation and chat metadata; or
- if the chat became busy/backlogged, commits only a negative deferred intent before inserting any message or spill media.

The latter preserves existing materialisation semantics. No positive persisted row is added to a deferred queue and later inserted again. When materialised, one intent creates one message and is consumed once. Message timestamps are made monotonic at commit, so a request prepared earlier but committed later cannot fall behind the chat cursor.

The authoritative interaction is captured inside the transaction. Optional link previews and recording occur after commit and log failures without rejecting accepted input or retrying admission. HTTP acknowledgement, SSE and execution scheduling follow commit. Same-chat execution remains serialized by AgentQueue. Family, command and steering admission keep their existing paths; the synchronous internal storage API remains available.

## Review corrections

Separate source review found two blocking issues in the initial implementation:

1. Postcommit preview/read/record exceptions could be reported as an unaccepted input. Interaction capture moved inside the transaction, and optional preview/recording failures are handled after commit. Actual handler tests prove late abort and preview SQLITE_BUSY still return the durable row and schedule once.
2. Inserting a positive message row and a queued copy when activity changed could produce duplicate materialisation/execution. Routing now chooses a negative intent before insertion. Real queue/materialiser/selection tests prove one row and one consumption, including busy ending after commit but before acknowledgement.

No timeout, original functional assertion or security policy was relaxed. A new disk fixture initially hit its 15-second child deadline; the failed receipt is retained. Phase-only logging followed by direct and wrapper retries passed within the unchanged deadline. Its original timeout cause is unestablished.

Authority review stopped the first frozen full gate. The corrected ingress binds a private capability to the actual Request, path, chat and raw body; headers, markers and internal URLs cannot mint it. Cookie sessions and internal secrets are freshly verified before admission. Trusted host and local-context inputs preserve their execution scope, cancellation and target lifetime.

New-target creation happens inside admission. Each retry must still match the original target; the post-mutation check recognises only that attempt's exact created branch. Tests reject external creation after a rolled-back BUSY attempt and roll back branch, chat, message and spill on cancellation before commit.

Mentions admit the source asynchronously before forwarding. The target has a separate transaction. Forwarding revalidates the source's committed lifetime and the original target binding; failed forwarding returns `source_committed: true`, the source interaction and `relayed: false`. This includes authority loss before the forwarding capability is bound. Direct relay rejects a persisted archived source or target without reviving it through stale AgentPool state.

## Measurements

The [synthetic receipt](../development/receipts/idle-input-admission-profile.json) records a two-second owned WAL writer against actual handlers and public WebChannel routing/storage/SSE.

- Prior idle-handler/store probe: ordinary input, unrelated HTTP, SSE and timer all delayed about 2,058 ms under the writer lock; idle acknowledgement about 32 ms.
- Candidate public WebChannel, three runs: durable input/SSE waited 2,032–2,603 ms; concurrent timeline GET returned in 1.93–2.11 ms and timer delay stayed 10.08–10.28 ms. Idle acknowledgement was 25–33 ms. The input is never acknowledged before commit.
- Requests include actual router/guards/prototype/storage and correlated Server-Timing/request IDs. The executor is a no-op, authentication is disabled for the owned single-user fixture, and provider execution is excluded.
- Latest corrected-source authenticated probe: unauthenticated POST returned 401; a verified synthetic cookie admitted two rows and scheduled two synthetic tasks. Under the two-second writer, durable ACK/SSE took 2,053 ms, timeline GET 1.66 ms and timer 10.11 ms. Instrumented whole-probe event-loop maximum was 26.47 ms, p99 0.70 ms. This fixture uses actual public guards/storage/SSE, with no provider execution.

Writer duration, durable commit and process scheduling vary; these runs are not whole-system speed benchmarks. Browser renderer CPU, production authentication repairs, family ingress, maintenance and commands remain separate coverage gaps.

Three method-instrumented runs recorded 1,736–1,771 event-loop samples at 1 ms resolution. The whole probe's worst delays were 20.8–33.0 ms, with p99 0.63–0.67 ms; this includes idle HTTP work and retry backoff. The locked request made 160 SQLite exec calls and 82 query lookups as it retried, totalling about 1.0–1.1 ms and 0.71–0.77 ms respectively. It also made 256 JSON serialisations (about 1.0–1.1 ms) and 13 parses (about 0.07 ms). Statement run/get timing and isolated commit cost were not instrumented. These call counts expose retry overhead without a production throughput claim.

A whole-process CPU profile includes fresh schema creation and module loading; native `run` frames dominate (232 samples). Bun omitted frame URLs, so repeated names cannot identify precise source costs. Raw output stays local. RSS after the method-instrumented probes was 117–119 MB; this is a single-process reading, with no dedicated GC or allocation comparison. The receipt preserves CPU/event-loop/method counts and limitations.

## Qualification so far

- Atomic storage, routing, postcommit failures and legacy handler tests: 33 passed / 255 assertions. TaskQueue/routing/postcommit subset: six passed / 54 assertions; tasks are synthetic, not provider turns.
- Broad existing channel/storage/facade regression: 127 passed / 705 assertions.
- Disk cancellation, revocation, reopened handle and replaced file: one passed / two assertions, with zero committed rows.
- Shipped Classic/Visual acknowledgement, rejection and event-order deduplication: four browser cases / 36 assertions, Chromium and WebKit.
- Web build: nine checks / 26 assertions. Five typecheck stages pass with 95 unchanged pre-existing frontend transitive diagnostics; scoped lint, circular-dependency and silent-catch checks pass.
- Independent final narrow reviews found no additional confirmed blocker after the two boundary corrections. A frozen full gate and final exact-head checks are still required before publication.

### Corrected-authority candidate

- Fresh authority/caller/storage/queue regression: 119 passed / 797 assertions across 17 files. The expanded matrix includes real guards, trusted host/new-source mentions, local-context scope, relay/tool signal forwarding, forged bindings, original cookie expiry/revocation, real branch incarnation/archive checks and truthful partial source receipts.
- Fresh disk gate: one passed / two assertions. Fresh shipped Classic/Visual ACK browsers: four passed / 36 assertions across Chromium and WebKit, serially.
- Five typecheck stages, scoped changed-file lint, silent-catch, structured logging, pack hygiene and stale distribution checks pass. Import-boundary check still fails on ten existing edges across five files; all five files are byte-identical to base `a01b76730` and frozen `3e2b0eaf0`, and the checker is unchanged.
- Both independent source reviews cleared the corrected candidate. Two reviewed Pi 1.0.1 ADR index corrections are included before the fresh freeze; historical 1.0.0 receipts stay unchanged.
- Failed authority gates, the stopped original full run, the composed-caller expected-red run (five failures), an initial authenticated-fixture 401 assertion failure and a delegated baseline-check timeout are retained. The authenticated fixture set its test TOTP value after module bootstrap; the rerun sets the existing mutable test runtime field before constructing WebChannel and proves unauthenticated denial.

### Frozen full gate

`make ci-fast` passed on clean head `7112f2c0ce914ed25e49668b041a241cf01ddaab`, tree `3613dae2c7a57f60523c3313e41af437e0276414`, from 14:33:50 to 14:49:56 UTC on 4 October 2026. The final head/tree were unchanged and the worktree was clean.

- Full suite: 6,219 passed, eight skipped, zero failed; 40,391 assertions, 6,227 tests across 892 files, 956.77 seconds.
- Features: 25 passed / 246 assertions. Web build: nine passed / 26 assertions.
- Final focused authority/caller matrix: 63 passed / 376 assertions across seven files. Five type stages and scoped lint passed after the final source change.
- Full log SHA256: `61a6605cb19bd72a845e6d5237318c4843927119e82bd49befc863ffb13a896d`.

The publication follow-up changes only this review and the JSON receipt. Runtime/test tree parity with the qualified head is checked before publication. The old stopped full run stays unqualified. Merge permission is outstanding; no production installation or restart is authorised.

No production install, restart, private credential/provider call or live database mutation was performed. The complete live thirty-second report remains open.
