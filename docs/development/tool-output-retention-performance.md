# Batch expired tool-output FTS cleanup

`deleteToolOutputsBefore()` batches full-text cleanup for successfully deleted
metadata rows, avoiding a repeated scan of FTS5's unindexed `output_id` column.
It retains the scoped SELECT, validates every selected path before mutation,
deletes metadata individually, then removes matching FTS rows in groups of 100
bound IDs. The final authority check precedes commit. All steps use the same
immediate transaction; SQL and validation failures roll back metadata and FTS.

The function returns only directly deleted rows. A `RAISE(IGNORE)` trigger no
longer supplies a record that could authorise the caller to unlink its file.
SQLite `changes()` supplies the direct statement count; Bun's `run().changes`
can include trigger-side writes. The single-output delete helper is unchanged.
There is no schema, timeout, durability, scheduler or filesystem cleanup change.

## Measurements

The [receipt](receipts/tool-output-retention-profile.json) records 34 actual
fixture-child processes on Smith, Bun 1.4.2, against disposable full-schema disk
WAL databases with `synchronous=2` and `busy_timeout=5000`. Each output has ten
FTS chunks; half the outputs expire. Three unprofiled processes per source/size
run in baseline/candidate/candidate/baseline/baseline/candidate order. Final
metadata and FTS digests agree for every size and both revisions.

| Stored outputs | Expired outputs | Baseline median | Candidate median | Baseline CPU median | Candidate CPU median |
|---:|---:|---:|---:|---:|---:|
| 10 | 5 | 21.91 ms | 19.96 ms | 0.93 ms | 0.86 ms |
| 100 | 50 | 32.14 ms | 15.11 ms | 8.55 ms | 2.51 ms |
| 1,000 | 500 | 589.31 ms | 59.51 ms | 533.80 ms | 25.52 ms |

For 500 expired outputs, instrumented preparation calls fall from 1,001 to 506;
DELETE steps fall from 1,000 to 505. Candidate instrumentation additionally
records 500 direct-count queries. Aggregate DELETE time falls from 527.89 ms
to 18.52 ms. The zero-delay timer spans the same synchronous transaction.
Internal begin/commit waiting is outside public statement wrappers.

Candidate wall outliers remain in the receipt: 245.85 ms at 100 outputs and
228.20 ms at 1,000. Three observations per variant provide a median and range,
not percentile guarantees. Small stores show little improvement. This patch
does not reduce common-term FTS search cost.

Ten CPU profiles cover the actual fixture children, including module loading,
startup and transactional seeding. Profile hashes and self-sample rankings
separate whole-child, retention and search ancestry. Bun can omit the parent
name around transaction callbacks; anonymous retention frames use exact
revision-bound source line ranges. Low candidate sample counts limit ratios.

## Correctness and validation

Focused DB/tool-output/family suites passed **44 tests / 266 assertions**,
including a disk-WAL child. Coverage includes batch boundaries 0/1/100/101/205,
idempotence, live rows, all-record validation before deletion, final authority
validation, second-batch failure, metadata trigger failure, complete rollback,
an independent disk reader, trigger-side writes, ignored deletes, owner/root/
execution-kind isolation and existing file/path/permission contracts.

The first trigger-observation test failed because Bun's change count included
the observation insert. `SELECT changes()` fixed the direct-count contract;
the corrected suite passes without changing timeouts. Source review found no
blockers before the expanded disk fixture. Final source review found no code
blockers; its CPU-receipt auditability finding was corrected and cleared by a
follow-up review.

The full local `make ci-fast` gate passed on frozen tree
`dd34a5d9eb199aec74e2a49af8693c6cbc21c24a`: **6,078 runtime tests, 8 skipped,
zero failed** (943.71 seconds), followed by 25 feature and 9 web build tests.
The historical 0.99.1 stage separately passed 468 tests / 8,720 assertions;
that stage is not 1.0.0 qualification. Full log SHA-256:
`f0989f58c40dcd5a951fca7753aa15f22325d1342b72d7f3e6389b00c2c76280`.
Final focused validation passed **44 tests / 266 assertions** (7.76 seconds)
with the frozen tree unchanged. Publication adds only this validation record.

All five type projects and strict new-fixture compilation pass; compose retains
95 unchanged transitive diagnostics. New tests/fixtures have zero lint errors.
The source file retains two baseline diagnostics in its unchanged search-error
handler, reproduced on the base revision. Pack hygiene checked 24,682 files.

## Scope limits

- Comparative timings cover DB helpers and unowned single-user synthetic data.
  Family/path/file behaviour is tested separately, without performance claims.
- No background timer invocation, HTTP request, competing writer, cold OS
  cache, physical write/fsync traffic, heap/GC or live data is measured.
- Metadata deletion now precedes all FTS cleanup within the transaction.
  Production has no tool-output DELETE triggers; arbitrary trusted triggers
  that reinsert rows or delete other metadata are outside these contracts.
- Callback validation and rollback remain mandatory. No permission result is
  cached, and no failure is suppressed.
- The patch is not deployed. It does not complete safe MCP Apply, native MCP
  acceptance, production Delegate integration or the broader DB/CPU audit.

## Reproduce

```sh
bun run test:local --cwd runtime --env PICLAW_DB_IN_MEMORY=1 -- bun test \
  test/db/tool-output-retention.test.ts test/tools/tool-output.test.ts \
  test/tools/tool-output-owner-scope.test.ts test/tools/tool-output-family-boundary.test.ts

bun run test:local --cwd runtime --env PICLAW_DB_IN_MEMORY=0 --env PI_OFFLINE=1 \
  --env OTEL_SDK_DISABLED=true -- bun --no-env-file \
  test/fixtures/tool-output-retention-profile.ts 1000 plain
```
