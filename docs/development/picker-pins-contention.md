# Picker reads and SQLite contention (#1500)

Established picker scopes now read without taking a SQLite writer lock. The reader SELECTs its scope first and inserts only on first use. That first-use path still returns the durable opaque scope chosen by the database; it does not fabricate an empty snapshot or an ephemeral scope.

Recognised busy/locked SQLite errors return HTTP 503 with `Retry-After: 1`, `Cache-Control: private, no-store` and `Vary: Cookie`. The handler recognises named busy/locked variants and numeric SQLite base/extended codes. Contention during account revalidation or session-visibility lookup follows the same path, avoiding a false access denial or a silently incomplete 200 response. Other storage errors keep their existing treatment.

Authentication, browser binding, CSRF origin checks, input limits, immediate POST transactions, per-owner scopes, session filtering, import receipts and unpin tombstones are unchanged. A failed update emits no pin-change broadcast. First-use GET and all updates still need writer admission; the change does not remove the competing writer.

## Regression evidence

The reporting Windows host used Bun 1.4.1 and PiClaw 3.2.4. Its report distinguished a failed HTTP request from the separate runtime crash in #1499. Local qualification uses Bun 1.4.2 on Linux and disposable file-backed databases; it is not a new Windows-host run.

- Unpatched `e0fa73752`: all three new regression tests failed. Established reads failed under a real WAL writer lock, read-only reopen attempted a write, and the HTTP handler failed instead of returning the contention response.
- Candidate: 28 tests / 377 assertions passed across new contention tests, existing picker persistence tests and family authorization tests.
- New DB tests require zero write changes on an established read, stable scope after read-only reopen, actual first-use failure under contention, session filtering and preserved tombstones.
- The disposable HTTP probe verifies first-use GET 503, established GET 200 under writer contention, locked POST 503/no mutation/no broadcast, normal retry, missing binding 409, invalid account/origin 403, named/numeric busy variants, session-lookup contention and post-body account revalidation.
- Query-error injection supplements real SQLite contention; it is used only for hard-to-force extended codes and authorization-read timing. Non-busy storage errors must not become a retryable response.
- Independent review caught the operator lookup's use of `prepare` rather than `query`; the fixture injection was corrected before execution.
- A one-off strict fixture compiler command omitted the repository ambient `gifenc` declaration. The corrected command includes the existing ambient declarations and passes without a package or type workaround.

Full `make ci-fast` passed: 5,903 current-runtime tests, eight existing skips, zero failures; 37,763 assertions across 851 files. Twenty-five feature tests, both frontend builds and nine web checks passed; the separate historical replay passed 468 tests / 8,720 assertions. Final pack hygiene checked 24,746 files; all five typechecks passed with the unchanged 95-diagnostic compose baseline. Final focused repeat passed 28 tests / 377 assertions. Scoped lint and independent final review found no blocker.

Local red/green and full-gate receipts are under `/workspace/tmp/windows-1499-1500/`. No live database, deployment or service restart was used.
