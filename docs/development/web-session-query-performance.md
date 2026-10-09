# Web-session statement preparation

Reusing two compiled SQL statements across three call sites reduces repeated authentication lookup work while retaining every row read, token bind, expiry check and revocation check. `getWebSession()` now uses Bun's connection-local `query()` cache for its hashed and legacy-token SELECTs; `deleteExpiredWebSessions()` uses it for the expiry DELETE. SQL text, bind values and write behaviour are unchanged.

No credential record or authentication decision is memoised. Bun can retain a statement's last bound values; both SELECT paths and the DELETE explicitly bind their argument on every call. The two identical SELECT strings share one compiled cache entry. Closing the database finalises cached statements, and reopening creates an independent cache. Transaction snapshot semantics are unchanged.

## Measured workload

The [profile receipt](receipts/web-session-query-profile.json) records 24 isolated processes on Smith (Debian LXC, Bun 1.4.2), using a disposable full-schema database, WAL and `synchronous=2`. Each process seeds 1,000 synthetic sessions and performs 10,000 calls for each of four paths. It warms each path with 100 calls, runs batches of 100, and yields for 1 ms between batches. Reported work time excludes the yields and database setup.

Three baseline and three candidate runs for each of plain, instrumented and CPU-profiled execution provide separate evidence. A further six plain runs alternate in baseline/candidate/candidate/baseline/baseline/candidate order to reduce run-order bias. The table uses those interleaved results, which were less favourable than the first series in three paths.

| 10,000-call path | Baseline median | Candidate median | Reduction |
|---|---:|---:|---:|
| Session lookup | 90.5 ms | 36.1 ms | 60.1% |
| Request-principal resolver | 122.4 ms | 85.8 ms | 29.9% |
| Cookie-auth helper including expiry deletion | 183.5 ms | 48.9 ms | 73.4% |
| Missing-token lookup, including legacy fallback | 142.6 ms | 16.7 ms | 88.3% |

The principal path includes cookie extraction and the current user-enabled check. The cookie-auth path calls `isRequestAuthenticated`; it is not a complete HTTP gateway benchmark. Requests are constructed before timing. No real account, network request, inference or live database is used.

### Attribution

Instrumented runs count statement acquisition and SQLite steps without recording SQL binds or token values. They use weak identity tracking/proxies to avoid retaining uncached baseline statements artificially. The initial exploratory run used a strong set; it is excluded from the repeated measurement receipt.

- Baseline lookup: 10,000 newly observed statements and 10,000 SELECT steps. Candidate: one observed cached statement and the same 10,000 SELECT steps.
- Baseline cookie-auth helper: 20,000 statements. Candidate: two cached statements, with the same 10,000 expiry DELETEs and 10,000 SELECTs.
- Missing-token fallback still performs two SELECTs per call. It rebinds the same compiled statement to the hash, then the supplied token.
- Workload JSON parse/serialisation counters are zero. Cookie parsing, SHA-256 hashing and expiry parsing still occur; their individual durations were not instrumented.
- All 24 database schema fingerprints match; query plans and integrity checks also match. Token lookups and expiry deletes use existing indexes. No schema or durability setting changes.

The receipt sums self-sample counts from three actual-child CPU profiles per revision, grouped by function name and normalised file URL; it records each profile's sample count and SHA-256. Native `prepare` self samples fell from 1,062/2,428 (43.7%) to 21/1,264 (1.7%). These profiles include startup and seed writes, so remaining native `run` samples cannot be attributed solely to request-time expiry deletion. Counters cover only the workload. CPU percentages are sampled proportions, not elapsed-time savings.

The receipt includes all timing spreads, CPU usage, RSS and 1 ms event-loop sample counts/delays. Instrumented results are separate from correctness and uninstrumented timing runs. Raw CPU profiles remain local because they can contain filesystem paths.

## Correctness

The [disk contract fixture](../../runtime/test/fixtures/web-session-cache-contracts.ts), run through [its isolated test driver](../../runtime/test/db/web-session-cache.test.ts), checks:

- alternating token and missing-token binds, detached result mutation and statement-cache eviction;
- cross-connection login revocation and user disable/re-enable;
- committed versus active-transaction visibility, plus rollback;
- rechecked expiry and changing expiry-DELETE timestamp binds;
- plaintext-token migration with stable login identity;
- table replacement/reprepare and database close/reopen.

A held transaction retains SQLite's existing snapshot until commit; caching a compiled statement neither strengthens nor weakens that visibility rule. The negative control runs the old source against the no-recompilation regression and fails with four preparations instead of zero. No test timeout is relaxed.

Existing auth/family tests plus the final contract revision passed **118 tests / 860 assertions**. Five TypeScript projects and explicit strict fixture compilation pass (95 unchanged compose transitive diagnostics); scoped lint reports zero warnings/errors. The frozen candidate passed `make ci-fast`: **6,011 passed, 8 skipped, zero failed** (867.08 seconds), followed by 25 feature and 9 web build tests. The separate historical 0.99.1 gate passed 468 tests / 8,720 assertions; those results remain historical. Final unchanged-tree auth/family checks passed 118 / 860 again. Tested tree: `f1779568106ff46b65d683f7c6212f187bb94805`; full-gate log SHA-256: `edad580686bc15f096150c6a6ba5285c0749408d0327ebf6cdf00c2fd9381fa9`. Only validation prose changed afterwards. Pack hygiene checked 24,681 files.

Review found no runtime/authentication blocker. Two evidence corrections added per-profile sample counts/hashes and explicit aggregation, plus a statement-identity assertion proving actual eviction. A narrow follow-up review confirmed those corrections; an earlier 150-second review timeout supplied no approval.

## Remaining investigations

Device-session listing currently scans `web_sessions` and creates a temporary sort tree. It is outside these timed paths; add an index only after measuring representative account/device cardinalities and write costs. This slice also does not measure contending writers, busy-wait distributions, cold-cache eviction costs, FTS, background work, large histories or dedicated heap/GC behaviour. It contributes to the broader DB/CPU audit and #1455 qualification without completing them.

## Reproduce

From the repository root:

```sh
bun run test:local --cwd runtime --env PICLAW_DB_IN_MEMORY=1 -- bun test \
  test/db/web-session-cache.test.ts test/db/web-session-principals.test.ts

bun run test:local --cwd runtime --env PICLAW_DB_IN_MEMORY=0 --env PI_OFFLINE=1 \
  --env OTEL_SDK_DISABLED=true -- bun --no-env-file test/fixtures/web-session-profile.ts
```

Add `--instrument` after the fixture path for counters, or Bun's `--cpu-prof --cpu-prof-dir=<private-directory>` before it for a separate actual-child CPU profile. Compare the same fixture on the parent revision and candidate. Keep SQL, dataset, runtime and durability settings identical.
