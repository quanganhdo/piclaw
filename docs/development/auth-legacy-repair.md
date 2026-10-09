# Revalidate legacy login repairs after writer waits

Legacy token and login-ID repair now compare the observed login fields in the UPDATE and re-read the complete canonical row after the write. A deleted, expired or identity-mutated login is denied instead of returning a pre-wait snapshot.

The compared fields are owner, authentication method, creation time, expiry and established login ID. SQL `IS ?` preserves nullable-method/ID comparisons. A previously null ID may acquire an ID from a concurrent legitimate repair. If this lookup assigned the ID itself, it must read back that same ID. Zero-change token migration can succeed only when a matching canonical row now exists. SQL failures and primary-key collisions propagate; there is no conflict suppression.

Modern hashed-session reads with an existing ID are unchanged: no new transaction, lock, reread or cache is added. The legacy write still uses the existing 5,000 ms busy timeout and WAL/full synchronous durability; this is a correctness fix, not a lock-wait speedup.

## Reproduction and verification

The [fixture](../../runtime/test/fixtures/auth-legacy-race.ts) creates synthetic login data in a disposable full-schema WAL database. A second Bun process changes the login inside an uncommitted writer transaction. The reader sees the old committed row, and a narrow instrumentation hook signals the writer only when `getWebSession()` reaches its actual repair. The writer commits after 250 ms; the real UPDATE blocks and resumes against the new state. No SQL result is simulated.

The [receipt](receipts/auth-legacy-race.json) records fifteen baseline observations and fifteen corrected cases, including reader/writer CPU, SELECT/UPDATE calls and a reader timer spanning the synchronous wait. The baseline delete case returned a row after committed deletion. Expiry, owner, auth-method, creation-time and established-ID changes could likewise leave stale metadata. Missing-ID repair threw `TypeError` after deletion. A separate strict baseline deletion run fails its assertion; observation-mode exit zero is not qualification.

The corrected cases deny all twelve revocation/identity mutation modes and preserve three legitimate races: concurrent token migration, concurrent ID assignment and both repairs together. Nullable authentication methods and established IDs are tested. [Unit tests](../../runtime/test/db/web-session-repair.test.ts) also cover a post-assignment ID mutation, expiry crossing during an ID repair, trigger failure and an actual token-primary-key collision with rollback.

The expanded auth suite passed **118 tests / 588 assertions**, including fifteen two-process races. No timeout was changed. All five type projects and explicit fixture compilation pass; compose retains 95 unchanged transitive diagnostics. Scoped lint reports zero warnings/errors, and pack hygiene checks 24,681 files. Two independent source reviews found no blockers.

The frozen candidate passed `make ci-fast`: **6,030 passed, 8 skipped, zero failed** (907.33 seconds), followed by 25 feature and 9 web build tests. The separate historical 0.99.1 gate passed 468 tests / 8,720 assertions; those results remain historical. Final unchanged-tree auth checks passed 118 / 588 again. Tested tree: `c1f7c328718042ba613545c06a91801666fee496`. Full-gate log SHA-256: `1afdea13ea1415f558d3e5097f8f5faf802a3b0f362358768333361c0469aa78`. Only validation prose changed after the gate.

## Limits

- Revocation immediately after the final read remains possible under normal SQLite autocommit semantics. This patch does not make all authentication reads serialisable.
- Deleting and reinserting a legacy row with a null ID and every compared field exactly equal is indistinguishable without a persisted generation column. No schema change is made here.
- Label changes are not identity changes. They are not used for authentication and are not in the comparison.
- Ordinary request-principal caching, broader permission revalidation and maintenance worker lifecycle are separate work.
- The direct storage function is exercised; this is not a complete HTTP/authentication-gateway concurrency test.
- No CPU sampling profile is used for the writer races. The earlier contention audit found profiled waiting could change `SQLITE_BUSY` behaviour. This receipt retains direct process CPU, writer hold time, call counts and timer delay; it makes no sampled-hotspot or speedup claim.
- Initial six-case timing probes signalled before invoking the function; final receipts strengthen ordering by signalling from the repair call. Only the latter establish the deterministic overlap contract.

## Other pending authentication changes

This branch starts from the shared main checkpoint. PR #1530 changes compiled-query reuse and PR #1532 moves already-invalid-row deletion to maintenance. This patch does not merge or modify either branch. When integrating them, retain both early invalid-row rejection and the post-repair checks; #1530's sweep-count assertion must include the row intentionally retained by #1532. Expired-row cleanup on this branch still follows the original mainline behaviour. An isolated combined check applied both pending source changes, copied their tests and adjusted only the documented expiry-sweep count: **26 tests / 110 assertions passed**, including the fifteen races. Temporary files were removed and this branch's source restored; neither published branch was changed.

## Reproduce

On 3 October, the integration update incorporates merged PRs #1529, #1530 and #1532. Invalid plaintext expiry is checked before token repair, invalid hashed rows deny read-only, and all canonical rereads reuse the same compiled SELECT while validating freshly bound results. Full-state CAS, assigned-ID checks and post-repair expiry checks remain intact. The cache fixture retains the maintenance-count adjustment and explicit storage assertions. Earlier performance/race receipts retain their original source scope; combined validation is recorded separately.

The merged-source focused gate passed **61 tests / 264 assertions** across auth races, repair, expiry, cache, contention/principals and MCP lifecycle (92.42 seconds). The race fixture counts executed reads through both `query()` and `prepare()` and requires at least an initial and canonical read. All five type projects, strict changed-fixture compilation, environment-reference checks and scoped lint passed; compose retains the same 95 transitive diagnostics. A narrow independent integration review found no blockers after an earlier review timed out. The combined full integration gate is still required; the earlier per-PR full gates above do not establish that result.

The subsequent isolated combined gate passed **6,065 runtime tests, 8 skipped, zero failed** (958.93 seconds), followed by 25 feature and 9 web build tests. It included this auth integration and the separately reviewed test-only Dream clock cleanup, which is published in its own PR. Frozen combined head: `a828240febedb0c38a60e107940c2bf772f7a353`; tree: `cb7770c75c0cf421073d3ebf4f1a990f6e5808b6`; log SHA-256: `3dc1cc2d56e158b49ac96237546adba7efca2ec2e2b7d2ec2a06fdaf905d6dd7`. The historical 0.99.1 stage separately passed 468 tests / 8,720 assertions.

After incorporating the already validated QuickActions PR #1534, final auth/MCP checks passed **45 tests / 188 assertions** (57.24 seconds). The updated combined tree also passed **23 tests / 1,907 assertions** (16.27 seconds), including four Chromium/WebKit source/built theme cases and the Dream/CLI/idle-clock tests. An initial browser rerun failed before launch because the isolated HOME had no browser binaries; the retained retry used an existing read-only browser cache and required no download. No runtime assertion or timeout was weakened. The full gate's frozen tree predates the CSS-only merge; these final checks qualify that later delta separately.

```sh
bun run test:local --cwd runtime --env PICLAW_DB_IN_MEMORY=1 -- bun test \
  test/db/auth-legacy-race.test.ts test/db/web-session-repair.test.ts
```

Use the fixture's `reader <mode> --observe` only to record baseline behaviour. Omit `--observe` for strict corrected assertions. All inputs are synthetic; no live store, credentials, provider calls, installation or restart is required.
