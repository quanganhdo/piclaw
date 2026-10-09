# Fresh SQLite startup batching

New empty databases now create the base tables, indexes and FTS triggers in one immediate transaction. Existing databases keep their previous schema/migration call order and transaction boundaries. The busy timeout is set before schema inspection and file-header pragmas. WAL selection verifies the returned mode and retries only `SQLITE_BUSY` within a five-second monotonic deadline; SQLite can bypass its normal busy handler for this transition. The helper temporarily disables SQLite's own wait so the two waits cannot multiply, then restores the caller's timeout on every exit.

The existing late incremental-auto-vacuum/VACUUM migration is unchanged for both new and existing files. An attempted early-auto-vacuum optimisation was removed after a simultaneous initializer hit `SQLITE_BUSY`; it is not part of the candidate. Synchronous=2, WAL, secure-delete and caller foreign-key behaviour are preserved.

## Measurements

[Machine-readable results](receipts/db-startup-profile.json) record three runs per mode and implementation, each measuring fresh creation, same-handle reuse and close/reopen. The workload uses disposable empty disk databases on Smith LXC, Bun 1.4.2. CPU profiles attach to the actual fixture process; method instrumentation records categories/counts/time without SQL text or bind values.

| Fresh startup | Baseline median (range), ms | Candidate median (range), ms |
|---|---:|---:|
| Uninstrumented | 3,906.4 (3,609.9–4,202.9) | 2,851.0 (2,442.5–2,891.6) |
| Method instrumentation | 3,769.1 (3,230.9–4,527.2) | 2,801.0 (2,641.4–2,905.5) |
| Instrumentation and CPU sampling | 3,749.6 (3,140.1–4,376.5) | 2,714.6 (2,477.9–2,910.2) |

The uninstrumented fresh-start median fell 27.0%. Median process CPU time fell from 117.2 ms to 94.9 ms; seconds of wall time are largely synchronous I/O, not CPU computation. Event-loop delay approached the full synchronous startup duration. Sampling native SQLite frames alone cannot separate CPU work from blocked I/O.

Schema fingerprints matched across all 54 measured phases. Instrumented baseline and final candidate fresh creation each ran one full `VACUUM`; no vacuum behaviour was removed. Uninstrumented runs intentionally have no method counters. Reuse/reopen timings are small and variable; this change does not claim a stable improvement there. It still executes the existing repeatable schema checks on reuse.

The first exploratory profile measured 5.23 seconds of startup with 4.51 seconds inside DDL calls and 0.29 seconds in vacuum. A first patch set auto-vacuum too late; moving it earlier then introduced a contended header-write failure in a final repeated test. Both variants are rejected and their logs remain separate. A later final test exposed a separate `SQLITE_BUSY` at the original WAL pragma. That candidate was held until bounded WAL retry and real held-lock/persistent-lock tests were added. The published measurements use the final transaction-plus-bounded-WAL candidate, with the original vacuum path. No live store was opened.

## Safety tests

The on-disk child fixtures cover fresh files, pre-existing empty files, a database containing an unrelated table/row, injected base-schema failure and two simultaneous processes opening the same file. They check:

- base DDL runs in a transaction only for the empty-schema path;
- an injected failure rolls back a partially created table and a later attempt succeeds;
- existing rows and inserted message/FTS results survive reuse and reopen;
- schema fingerprints stay unchanged and `quick_check` passes;
- WAL, synchronous=2, secure-delete and requested foreign-key state survive;
- all auto-vacuum=0 databases retain the old vacuum migration path;
- two barrier-released initializers both succeed on one disposable database;
- WAL selection succeeds after another process releases a real lock, stops after the bounded persistent-lock deadline, preserves synchronous durability/restores timeouts, and rejects non-busy errors or a non-WAL result.

The earlier reduced candidate passed five repeated simultaneous-initialisation runs but later hit the WAL race. The final bounded-WAL candidate passed six fresh simultaneous-initialisation repetitions, plus a real other-process held-lock test. Earlier passes do not override that recorded failure. The concurrency barrier aligns process starts, not individual SQLite instructions. This is bounded contention evidence, not proof against every process schedule. Power failure, disk-full and forced termination between every migration statement are not qualified here. No broader migration batching or durability relaxation is introduced.

## Reproduce

Run contract tests through the normal isolated launcher:

```sh
bun run test:local --cwd runtime -- bun test test/db/startup-profile.test.ts test/db/connection.test.ts test/db/sqlite-journal.test.ts
```

The profiling fixture requires disk-backed isolated state. From the repository root:

```sh
bun --no-env-file -e 'import {runLocalTestCommand} from "./runtime/scripts/local-test-priority.ts"; await runLocalTestCommand([process.execPath,"test/fixtures/db-startup-profile.ts","--instrument"],{cwd:process.cwd()+"/runtime",env:{PICLAW_DB_IN_MEMORY:"0"}});'
```

For sampled profiles add `--cpu-prof` and `--cpu-prof-dir=<owned-output-directory>` before the fixture path. Omit `--instrument` for plain timing. Never run this fixture against an existing operator store. Raw profiles and rejected-variant logs are retained locally under `/workspace/tmp/db-startup-profile/`.

## Final validation

The final WAL-retry candidate at frozen tree `8ffcbbaecf3a6ca88bd8f15b880d5ff3c7ef7b61` passed one complete `make ci-fast` run: 6,003 runtime tests, eight existing skips, zero failures; 25 feature tests and nine web checks. The separate frozen 0.99.1 consumer passed 468 tests / 8,720 assertions. All database-directory tests passed (370 tests / 2,483 assertions); final focused startup/lock tests passed 14 tests / 48 assertions. All five typechecks passed with the unchanged 95-diagnostic compose baseline; scoped lint, stale-dist and pack hygiene (24,749 files) passed. A second independent review found no blocker in this final scope.

Earlier runs are not combined into that result: the first hit an unrelated 15-second retention timeout (its unchanged isolated test passed on base and candidate); one reduced-candidate run finished the runtime suite after its shell was interrupted, with remaining stages recovered separately; final repetition then exposed the WAL transition race. Both the early-auto-vacuum and no-retry variants stayed unmerged. No test timeout or assertion was weakened.

Final full log: `/workspace/tmp/db-startup-profile/ci-fast-wal.log`, SHA-256 `c1036d133d4384a73314fde33184ba9548bb65e74130420f3ec4a77ecbbdd688`. Only validation prose was added after the frozen gate. No production database or deployed runtime was changed.

## Remaining work

Fresh startup still spends seconds in later schema installers; these require separate transaction/locking review and fault tests before further batching. Repeated auth/config parsing, query preparation, FTS plans, contention, background maintenance and long-history CPU costs remain in the broader performance inventory. This patch does not complete that audit or alter the mainline Pi adoption scope.
