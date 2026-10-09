# Bun script output-finalisation failures (#1499)

A storage exception in the Bun child's `close` callback previously escaped the operation Promise. The Windows report observed a runtime exit; a disposable Bun/Linux reproduction emitted the uncaught SQLite stack and stayed unsettled until the probe watchdog stopped it. Those are distinct observations of the same missing callback error boundary.

The callback now ignores events after settlement, uses the existing failure helper for abort/timeout, and catches output-finalisation failures. The rejection retains the original `cause` and warns that the script has already exited and may have changed files. It never reruns the script, returns an unindexed output handle, raises SQLite timeouts or catches global uncaught exceptions.

Normal output access checks and persistence rollback remain intact. If stdout saves successfully and later stderr storage fails, the first stored output may remain without its handle being returned. That pre-existing two-stream atomicity limitation is outside this crash-containment change; ordinary retention still applies.

## Regression evidence

- Reporting host: Windows x64, Bun 1.4.1, PiClaw 3.2.4; eight targeted successful candidate probe hosts reported in issue #1499. This is reporter evidence, not a new Windows run here.
- Local baseline: Bun 1.4.2 on Linux, exact unpatched source `e0fa73752`; large stdout and stderr under a real SQLite WAL writer lock both failed with an uncaught storage stack. Probe hosts were stopped by their deadline; both regression assertions failed.
- Local candidate: nine isolated file-backed host scenarios plus six existing extension tests passed: 15 tests, 66 assertions. Scenarios cover small-output contention, large stdout/stderr contention, healthy searchable output, nonzero script exit, timeout, abort and output ownership denial.
- Fixtures pin output thresholds before importing runtime configuration, check exactly one script execution and settled result, verify retained causes, and require no tracked children or rejected output rows/files. Each child has a bounded self-deadline; the parent also owns PID/watchdog cleanup.
- An initial fixture run failed because inherited deprecated environment settings wrote warnings to stderr. The fixture now sets explicit disposable configuration and removes those unrelated compatibility variables. That failed run is retained.
- Independent review found no blocker in the focused containment patch.
- Full `make ci-fast` passed: 5,909 current-runtime tests, eight existing skips, zero failures; 37,783 assertions across 850 files. Twenty-five feature tests, both frontend builds and nine web checks passed; the separate historical replay passed 468 tests / 8,720 assertions.
- Final pack hygiene checked 24,746 files; all five typechecks passed with the unchanged 95-diagnostic compose baseline. Final focused repeat passed 15 tests / 66 assertions. Scoped lint and strict fixture typechecking passed.
- The first full gate stopped before tests on a comment-only PID-check catch; the fixture now explicitly records that the process is no longer alive. The corrected gate passed. No runtime assertions or timeout limits were weakened.

Local receipts: `/workspace/tmp/windows-1499-1500/1499-red.log`, `1499-green.log`, and `1499-fixture-types.log`. No live database, deployment or service restart was used.
