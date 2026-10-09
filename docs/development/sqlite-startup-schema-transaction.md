# SQLite startup schema transaction

Database startup now performs the ordered schema and migration steps in one IMMEDIATE transaction. This prevents competing initializers from starving behind separately committed DDL and reduces startup cost on the measured ZFS-backed container. SQLite's five-second busy timeout, WAL/FULL durability and final VACUUM remain unchanged.

## Measured failure

On Smith (Debian LXC, Bun1.4.2, ZFS), the unchanged `62a71d139` concurrent-empty-database test failed with `SQLITE_BUSY` while entering the base-schema transaction. One process could commit the base schema and repeatedly acquire the writer for later individual initializers; the other exhausted its existing lock wait. An independent unchanged run reproduced the failure. No longer timeout or unbounded storage retry was added.

An owned fresh-startup profile measured about9.15seconds: the base-schema statement took4.6ms,65later DDL calls took about8.04seconds, and the finalVACUUM took152ms. A legacy-seed profile measured9.63seconds, including2.25seconds in baseDDL and7.06seconds in laterDDL. Statement wall times include their individual commits; they do not separately measure fsync or kernel work.

## Transaction boundary

`runtime/src/db/connection.ts` extracts `initializeSchema(database)` with all46initializer calls in their original order. Base-schema creation still runs once. The helper runs inside one outer IMMEDIATE transaction for fresh and existing databases. Existing nested migration transactions become SQLite savepoints.

Foreign-key policy, journal/cache pragmas and file-header setup occur before the transaction. The original foreign-key policy is restored afterwards. Auto-vacuum setup, fullVACUUM and incremental reclamation remain outside the transaction. No schema text, migration identity/checksum, media value, authority policy or connection lifetime is changed.

A propagated initializer error rolls back the entire schema batch, including owned-ledger writes. Helpers that deliberately catch migration errors retain that behaviour; the outer transaction does not convert suppressed errors into fatal errors. Logs and connection pragmas are outside database rollback. No claim of coverage for every historical schema variant follows this change.

## Regression checks

- Two real processes initialise the same empty WAL database and verify quick_check, FTS, incremental auto-vacuum and FULL synchronization.
- Fresh, empty-file and legacy-seed startup preserve schema/rows/FTS across repeat initialization and reopen.
- Failure during base creation or the last initializer rolls fresh schema back to empty. Late failure with an existing legacy table retains its data and removes all partial new schema; retry completes normally.
- Existing foreign-key policy and exactly one required VACUUM remain checked.
- The two legacy migration test fixtures now seed their unchanged schema/data atomically; migration assertions and15-second test bounds are retained.

The fresh-only prototype fixed the original concurrency test but broader tests exposed existing-schema latency. Its failed runs are retained. Batching only fixture setup did not fix those runs. The expanded schema transaction passed441tests/2,769assertions across48DB/MCP files twice, with five type checks and changed-file lint. Scoped independent source review verified initializer order, nested savepoints and pragma/VACUUM placement.

## Comparable startup profile

Three interleaved baseline/candidate pairs per mode use the same host, Bun, seed and WAL/FULL policy. All six schema fingerprints per mode match exactly:135tables for fresh startup and136with the legacy seed.

| Mode | Baseline elapsed range / median | Candidate elapsed range / median | User + system CPU range |
| --- | --- | --- | --- |
| Fresh | 7.02–8.60s / 7.558s | 0.360–0.419s / 0.396s | Baseline152–163ms; candidate73–93ms |
| Legacy seed | 8.36–11.37s / 8.605s | 0.195–0.272s / 0.259s | Baseline172–175ms; candidate71–92ms |

The timer probe schedules one10ms callback before synchronous initialization; it observes the startup blocking duration, not steady-state responsiveness or event-loop percentiles. The two candidate CPUartifacts contain120 and112samples over350 and548ms and include module loading/startup. Profiles wrap exec counts/timing without recording SQL text or binds. Outer transaction commit time is included in elapsed but outside the exec hook.

Machine report: `/workspace/tmp/pi-101-epic-audit/db-startup-final-profile/comparison.json`; profiler `runtime/test/fixtures/db-startup-contention-profile.ts`. The comparison measures an empty database and a small legacy seed, not a live large-history database or all concurrent external writer workloads. No production database, credentials, providers, installation or restart were used.

The first full repository gate at `b225db3fd` failed with6,311passed,8skipped and2failures. One source-binding assertion still named the old local variable; it now checks the preserved composition call and the outer transaction. An unrelated latent EF-S02 test aggregated23independent contract cases under one15-second deadline and timed out. Those existing cases are now registered individually with the same15-second bound, fresh-subject/restore semantics and leak checks; no store/runtime implementation or contract assertion was removed. The case selector rejects unknown names, and each result must match its registered case. The corrected startup/source/contract slice passed81tests/1,073assertions.

Publication requires a fresh frozen full repository gate and exact-head hosted verification. Failed startup/broad attempts stay separate from passing evidence; no assertions, timeouts or durability settings were relaxed.
