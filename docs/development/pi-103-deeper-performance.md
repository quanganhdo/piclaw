# Pi 1.0.3 deeper workload audit

Family HTTP admission now yields while SQLite waits for another writer. The correction uses the existing bounded async-admission helper and retains atomic message/authority/media/queue writes. Additional fixtures measure real scheduler claiming, family mutations and natural session-history reclamation. These scoped results do not complete whole-system performance or production acceptance.

Base: `6ceaeaed19c3ca0f5589cc616774c529b631c689`, Pi 1.0.3 / Bun 1.4.2 on Smith LXC. All data, accounts and agents are synthetic; databases and files are owned temporary state. No live credentials, inference, installation, restart or driver activity. The [machine receipt](receipts/pi-103-deeper-performance.json) records hashes, source bindings, spreads and limitations.

## Family lock-wait correction

The previous HTTP route calls synchronous family admission. A separate 500 ms IMMEDIATE writer makes unrelated requests and timers wait for that transaction. The candidate calls `admitFamilyHttpMessage`, which captures the database handle/binding/file identity, workspace/store/data/config roots, original actor/login, target ownership/root and branch incarnation, plus a cloned request. Every attempt and final in-transaction check revalidates those values. Home/target changes, revocation, cancellation, file replacement, reopen and mode changes deny; rollback leaves no message, authority or queue row.

`admitSqliteWrite` temporarily uses busy-timeout 0 only for a complete IMMEDIATE attempt, restores the original connection policy before yielding, and retries only confirmed SQLite contention within the existing 5 s bound. The original nested family transaction remains a savepoint in the atomic outer transaction. Media claims, payload identity and idempotency checks are unchanged. Durable commit remains before the HTTP success response; no late cancellation reinterprets that committed row as absent.

Interleaved baseline/candidate runs recorded three runs per release/revocation mode and revision. The runner did not capture execution-time source identities or both fixture hashes. The numbers below are retained exploratory observations; they do not establish an exact-source speed comparison. The current baseline runtime/dependency diff against the merged Pi 1.0.3 base is empty, but that later check cannot attest the earlier process state.

| Writer outcome | Revision | Unrelated HTTP read, median (range), ms | 10ms timer, median (range), ms |
| --- | --- | --- | --- |
| Release | Baseline | 556.6 (545.8–557.3) | 553.2 (543.6–555.0) |
| Release | Candidate | 3.8 (3.6–4.3) | 10.3 (10.2–10.4) |
| Revocation | Baseline | 536.0 (535.2–536.0) | 532.5 (532.3–535.2) |
| Revocation | Candidate | 2.9 (2.8–3.9) | 10.3 (10.2–10.4) |

Admission still waits approximately the writer interval plus commit/check time. Release returns 201 with one additional row; revocation returns 403 with no additional row. The candidate contention batch includes an outlier of 736 ms. This metric also waits for the unrelated read, timer, writer process exit and assertions; isolated ACK latency was not measured. Durable commit stalls and tail latency need further coverage. The pre-existing broad handler can return an error after a postcommit broadcast/wake exception; a regression characterises the committed row and idempotent retry/wake recovery without changing that behaviour.

The earlier focused suite passed 75 tests / 763 assertions across seven files, including ten fresh disk-bound admission cases and existing family media/provenance/queue, scheduler and SQLite helper regressions. Its log hash is retained, without an execution-time source attestation. Cancellation, revoked login, moved home, replaced target branch, DB reopen/file replacement, mode switch, cloned payload and SQL rollback are exercised. A scoped source review cleared the admission seam in the chat transcript; a later broader attempt timed out and supplies no additional approval. Final exact-head qualification is recorded separately.

## Scheduler claim-loop coverage

The fixture starts the actual scheduler loop, uses disk EF-S07 stores and the real AgentQueue, then repeats polling and executes 12 claimed tasks in four lanes. It proves one enqueue per occurrence, one active task per chat, four concurrently active lanes, 11 completed source/operation joins, one paused pending occurrence abandoned before synthetic agent execution, one log per completion and the exact interval successor `settled_at + 1 hour`. Polling stops before final metrics and before queue shutdown.

Three plain runs take 889.6–1120.5 ms (median 899.8); event-loop maxima 209.2–298.9 ms. These durable multi-step transactions remain a responsiveness hotspot. The agent, restore callbacks and outbound delivery are injected sinks; no inference, real SDK-leaf restoration or external delivery is qualified. WAL/FULL/FK assertions describe the fixture store only; the scheduler's private connection is not directly observed. The corrected-fixture review is recorded in the chat transcript.

## Concurrent family mutation coverage

The owned loopback router admits 16 prompts for two directly provisioned synthetic accounts with concurrency 4. Four exact replays preserve 16 rows. Foreign owner, hostile origin, conflicting body and revoked login cases return privacy-safe denials. Per-owner request IDs 0–7, login/actor/owner/chat identity and queue counts are checked explicitly. The setup uses direct DB/service provisioning; public enrolment/login is not qualified.

Three plain uncontented runs take 292.5–316.2 ms. SQLite serialises writes even though HTTP requests are concurrent. Ready/held queue, wake and broadcast counters are observed; agent/dequeue/external-delivery remain out of scope. Fetch wrapping denies non-server origins after setup, without claiming an OS-wide network sandbox. The contending writer modes above separately verify release and revocation after waiting.

## Natural reclamation observations

Public SessionManager opens 60 synthetic histories at 2,000 and 5,000 entries, retaining ten positive controls and dropping the other references. No explicit GC runs during the measured window. FinalizationRegistry observes 48–50 dropped managers finalised in the three plain runs at each size. Held controls remain usable. Later forced GC is a separate diagnostic after releasing controls, outside measured wall/CPU/event-loop statistics.

Three plain windows: 405.2–435.4 ms for 2,000 entries and 750.1–828.8 ms for 5,000 entries. Memory is process-wide, and fixture bytes vary with the workspace path in its header. Finalization timing is nondeterministic: missing or delayed callbacks do not prove retention/leaks, and reclamation does not prove absence of leaks. CPU samples and event-loop delays cannot uniquely identify every automatic GC pause. Whole-child CPU includes setup and the later explicit diagnostic; the report's measured CPU delta excludes both. No undocumented per-GC telemetry or leak-free guarantee is invented.

## Evidence and unfinished scope

The [final qualification receipt](receipts/pi-103-deeper-qualification.json) binds clean frozen head `d8a95676a7e0ad70e34255902e71d2945b901bb7`, tree `3334ed9685052a0745c36c760e4de18283e9c50c`, before and after every gate. Types, scoped lint and diff checks pass. Focused tests pass 77 / 841 assertions; the full gate passes 6,527 tests / 8 existing skips / 0 failures / 42,737 assertions in 652.1 s, plus 25 feature and nine web-build tests. Actual descendant CPU ticks, RSS pages and niceness are sampled; these coarse samples cannot identify function-level hotspots or all short-lived children. The test process ran at nice 10. Publication adds documentation only; runtime, tests and dependencies retain frozen-source parity.

Sixteen successful child runs include three plain plus one CPU run for the scheduler, family writes and each history size. Each row records its launch source identity. The series contains two source heads: seven completed runs on `23f74e540` and nine after the test-only EINTR memory-read correction `850790917`. The final before/after attestation covers only the resumed invocation. Runtime admission code is identical; dependencies are unchanged. Earlier pre-review series and failures stay separate. Earlier typecheck logs retain 95 unchanged compose diagnostics; the scoped lint result existed only in the tool transcript. Final static checks and full qualification need their own receipt.

The first scheduler fixture asserted before the real queue's deferred start; the corrected version waits for explicit lane starts. Family setup initially lacked a synthetic cookie. Review strengthened exact source joins, recurrence, post-poll counts, namespaces, cleanup and observation boundaries. A CPU-profile telemetry call failed with Linux EINTR; at most two retries are allowed for errno 4 only. That failed run is excluded; unrelated telemetry errors still propagate. Available failed-run logs have hashes in the receipt. Review comments/timeouts have transcript-only provenance. Successful measurement rows are not a complete failure ledger.

Whole-plan gates still include production Delegate raw provider/auth settlement and account-generation contracts, immutable core/add-on/policy/credential/owner/orphan qualification, live account/server canary/soak and operational rollback. Deployment and live calls need separate permission. Longer automatic-GC retention soaks, scheduler private-connection/real-agent behaviour and broader workload/platform distributions remain separate. Source merge does not authorise deployment.
