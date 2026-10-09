# Expired-session rejection under SQLite contention

Rejecting an already-expired or malformed session no longer takes a SQLite write lock. `getWebSession()` returns `null` after reading the row; the existing authentication maintenance sweep removes invalid rows and their pending registration state. A plaintext legacy row is checked before attempting token migration.

Valid legacy token and login-ID migrations still require successful writes and propagate errors. A valid legacy row can expire while its migration waits: it may be updated and then rejected by the later expiry check. This slice does not remove those writes or their contention. Modern valid-session reads and missing-token reads are unchanged.

## Measured effect

The [receipt](receipts/auth-contention-profile.json) contains 49 baseline cases and 32 comparison/profiling cases on Smith, Bun 1.4.2. Each process uses a disposable full-schema WAL database, `synchronous=2` and the unchanged 5,000 ms busy timeout. A separate Bun writer holds `BEGIN IMMEDIATE` around an unrelated user update and signals readiness before the authentication call. The main test invokes the real `WebAuthGateway.isAuthenticated()` with synthetic cookie state; it does not run an HTTP server.

Unprofiled expired hashed-cookie comparison:

| Writer hold | Baseline call | Candidate call | Candidate result |
|---|---:|---:|---|
| None | 12.13 ms | 0.68 ms | Denied |
| 250 ms | 348.53 ms | 0.81 ms | Denied before writer release |
| 6,000 ms | 5,014.02 ms, `SQLITE_BUSY` | 0.79 ms | Denied before writer release |

Expired/malformed hashed and plaintext-legacy comparisons all finish in about 1 ms with the candidate and perform no write. These are individual matched observations, not percentile guarantees or performance thresholds. The test asserts that rejection finishes before writer release and that only SELECT-class steps execute; it does not assert a 1 ms limit.

Baseline modern and missing-cookie checks complete in about 1 ms even while the writer holds its lock. Baseline expired/malformed rejection, valid legacy repair and maintenance can synchronously wait about five seconds and then throw `SQLITE_BUSY`. The low `process.cpuUsage` during the stall indicates waiting rather than CPU computation. A zero-delay timer records the same event-loop stall. Internal transaction-begin time is not captured by the public statement wrappers, so maintenance's few fast DELETE steps do not explain its wall time; its immediate transaction acquires the writer lock first.

The old `isRequestAuthenticated`/`isRequestTotpSession` sweep helpers are exported through `auth-runtime.ts`, but a production callsite audit found no caller. The live gateway resolves the principal directly; this report does not attribute the old helper's unconditional sweep to the live gateway.

## Deferred physical cleanup

Startup validates access before starting the existing maintenance loop. It sweeps immediately and every 60 seconds; failures are logged and retried. Cleanup is eventual, not guaranteed within 60 seconds under contention. This patch does not add workers, timers, queues or failure suppression.

Rows awaiting cleanup do not confer authority. Session lookup, principal resolution and sensitive account/registration operations independently validate expiry. TOTP/passkey consumers re-read account/login authority. Inventories and pending-registration rows can remain present until the next successful sweep. The sweep deletes sessions, fires the TOTP logout trigger and removes passkey orphans in the same maintenance transaction.

Explicit revocation still writes synchronously. Valid legacy migration errors still throw and cannot produce an authenticated result. No authorisation, SQLite timeout, durability or deletion-trigger policy is weakened.

## Verification

- The [two-process driver](../../runtime/test/db/auth-contention.test.ts) covers modern, missing, four already-invalid shapes and two valid legacy repair shapes with a 250 ms writer hold. Deadline cases are in the manual measurement receipt.
- [Expiry tests](../../runtime/test/db/web-session-expiry.test.ts) install triggers that fail any UPDATE/DELETE during invalid lookup, verify repeated denial and unchanged rows, then check TOTP and passkey cleanup after maintenance. A failed valid legacy migration propagates its error.
- Final focused auth/maintenance/TOTP checks passed **121 tests / 664 assertions**. The five expiry tests include 38 assertions.
- `make ci-fast` passed **6,023 tests, 8 skipped, zero failed** (873.73 seconds), then 25 feature and 9 web build tests. The separate historical 0.99.1 gate passed 468 tests / 8,720 assertions; those results remain historical. Tested tree: `d783e6c87f3a6434237f753100d00029641f8395`. Log SHA-256: `2709b794ef4665c8e6be488208e6a57300f81699567e7cb15dba0124c1a24ad1`. Only validation prose changed afterwards.
- All five type projects and strict fixture compilation passed; compose retains 95 unchanged transitive diagnostics. Scoped lint reports zero warnings/errors; pack hygiene checked 24,681 files.
- Source review found no security/correctness blocker in this narrow change. It required explicit near-expiry, eventual-cleanup, latency and valid-legacy limitations, and the added passkey-cleanup case.

### Profiling and failure history

Six CPU profiles cover **uncontended** baseline/candidate execution, three per revision, in the actual authentication child. They include startup and are recorded with hashes, sample counts and aggregation method. Separate instrumented contention cases retain SQL-step counts/duration, timer delay, memory-independent CPU usage and the writer's actual hold/CPU. No token, SQL bind or real credential values are published.

Two profiled 250 ms baseline contention attempts unexpectedly returned `SQLITE_BUSY` before the writer released; the second did so at 76.3 ms while the writer held for 251.5 ms. The cause is unresolved. They remain failed observations and are excluded from comparable latency/CPU claims; no timeout was extended. Plain correctness/timing results are separate. Initial fixture compilation required narrowing the spawned process's piped stream types. The first cleanup test expected one changed row; Bun includes the TOTP trigger-side deletion, so the corrected count is two, backed by explicit empty-table assertions.

## Integration and remaining work

This branch starts from the shared main checkpoint and does not include PR #1530's compiled-query changes. The source changes are compatible, but that PR's cache-contract fixture expects expired lookup to physically delete a row. Its later expiry-sweep count must account for that retained invalid row when integrating the changes; neither auth-denial nor maintenance assertions should be removed. An isolated combined test applied #1530's three compiled-query substitutions and changed only that sweep expectation from one to two: **10 tests / 56 assertions passed**. Both source and temporary tests were restored afterwards; neither published branch was modified.

On 3 October, the integration update incorporates merged PRs #1529 and #1530. The cache-contract fixture now asserts that the denied expired row remains stored until maintenance, expects the sweep to remove both expired rows, and explicitly checks their absence afterwards. The earlier isolated receipts above retain their original source scope; combined integration validation is recorded separately.

Maintenance still blocks the main event loop when waiting for a writer. Moving it to a separate worker requires validated database-path/identity handling, deterministic shutdown, no overlapping sweeps and in-memory-test policy. Valid legacy repairs also still block. Their existing concurrent-delete/migration races, HTTP error presentation, general request-principal caching and broader FTS/history/GC work are not resolved here.

## Reproduce

```sh
bun run test:local --cwd runtime --env PICLAW_DB_IN_MEMORY=1 -- bun test \
  test/db/web-session-expiry.test.ts test/db/auth-contention.test.ts

bun run test:local --cwd runtime --env PICLAW_DB_IN_MEMORY=0 --env PI_OFFLINE=1 \
  --env OTEL_SDK_DISABLED=true -- bun --no-env-file \
  test/fixtures/auth-contention.ts expired-legacy 6000 instrument
```

The fixture supports `modern`, `missing`, `expired`, `malformed`, `expired-legacy`, `malformed-legacy`, `legacy-token`, `legacy-id` and `maintenance`, with holds of 0, 250 or 6,000 ms. `--baseline` asserts the old source's blocking behaviour for comparison. Run CPU profiling only with hold 0 for the qualified profile series. No live database, installation or restart is required.
