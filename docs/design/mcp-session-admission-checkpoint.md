# MCP session admission checkpoint before Pi 1.0.0

This checkpoint stabilises the real session-manager admission fence on the existing 0.99.1 dependency baseline. The selected upgrade target is now exact Pi 1.0.0. These tests protect retained behaviour during migration; they do not qualify 1.0.0 or complete the MCP settings pane.

## Manager behaviour

- Close main/side admission synchronously and invalidate pre-fence delivery through an epoch. Drain creation, cached retrieval, binding, branch seed, side reseed, recreation, prewarm and disposal work before enumerating participants.
- Reject overlapping snapshots, cancellation and reopening before work drains. Keep eviction/prewarm from changing the fenced pool. Shutdown captures and drains earlier work before disposing cached runtimes.
- Reject lifecycle callback re-entry into manager admission, snapshot, shutdown, quarantine or resume rather than await a cycle. Internal creation uses an admitted refresh method.
- Install per-chat and per-runtime disposal tracking before callbacks execute. Replacements wait for old teardown; stale cleanup does not delete a replacement generation.
- Retain failed runtime disposal and block admission/snapshot/resume until explicit quarantine retry succeeds. Concurrent quarantine coalesces; sequential quarantine repeats teardown to close resources created by a late public reload.
- Track the full direct-quarantine tail and reject callback-triggered resume. This fixes the last review finding before the checkpoint.

Existing shutdown tests now launch shutdown, release pending creation and await cleanup in that order. Disposal-count assertions wait for callback entry instead of assuming a particular microtask count. Initial fixture marker, ordering, and review failures are retained in local logs; they are not reported as first-run success.

## Validation and limits

Focused session-manager, binder, persistence, add-on ownership and family isolation tests: 73 passed, 298 assertions. The broader affected pool/thinking-policy set passed 98 tests / 412 assertions. Scoped strict typing, Oxlint and diff checks pass. Independent delta review cleared the quarantine-tail fix.

The first full gate retained 6,070 passes / eight skips / three failures: two tests assumed synchronous disposal and one called the changed manager method with a partial prototype receiver. Those fixtures now await disposal and construct a real manager. The corrected frozen gate passed 6,073 tests / eight skips / zero failures, plus 25 feature tests and nine web checks. Pack hygiene passed 24,747 files and all five typechecks passed with the unchanged 95-diagnostic compose baseline. Both receipts are preserved locally; no test budget was relaxed.

The fence facility is not connected to an engine-switch endpoint or settings UI. Agent prompt/result generation fencing, real adapter/native owner factories and teardown qualification, authorised instance backend and pane remain unfinished. No live setting, dependency pin, credential, service or deployment was changed. All execution is Bun-only.

## Retarget handoff

Build on this commit rather than discarding it. Exact target: `@earendil-works/*` 1.0.0 at registry git head `a13d35a742c6ef8462812a28fbe1d8c8b7431c32`, subject to fresh admission (#1492). Preserve historical 0.99.1 receipts. Removed Harness/Pico3 imports require explicit boundary migration; experimental `pi-durable` is a separately reviewed architecture (#1493/#1494), not an automatic production replacement. Provider/MCP/Delegate deltas are tracked by #1495 and #1458. Retain the approved instance-wide selector, adapter default, codemode Auto/On/Off and whole-extension reload policy.
