# Dream test clock cleanup

Dream tests now restore the module-captured real `Date.now` in `afterEach` and both clock-mutating tests' `finally` blocks. This is a test-only correction; production clocks, Dream behaviour and timeout limits are unchanged.

## Failure

The Quick Actions full gate on `05f46639a` timed out in the first Dream test while it had frozen `Date.now`. Four later offline account-recovery fixtures failed session-age validation. The run then stalled in a session-idle test with a 120 ms deadline measured using `Date.now`.

A per-test capture can capture another test's mocked clock if an earlier timed-out asynchronous test finishes late. Restoring that capture then leaves time frozen for the rest of the process. The previous `afterEach` did nothing. The failed run was stopped after 21 minutes; its log remains `/workspace/tmp/quick-focus-ci.log`.

## Correction and regression

- Capture the real clock once at module scope, before these fixtures replace it.
- Restore that function in `afterEach`, including after a test timeout, and in both `finally` blocks. Do not capture clocks inside individual fixtures.
- Assert there is exactly one direct `const`/`let`/`var` clock-function capture, using the module-level `realDateNow` name. Negative controls reject renamed and same-name local shadows.
- Generate a disposable child from the real fixture cleanup statements. One deliberate 15 ms timeout overlaps late cleanup; the two following tests require the native clock and advancing deadlines. The parent expects only that intentional child failure.
- Run the child from its disposable workspace, remove `BUN_OPTIONS`, and kill it after three seconds if it stalls, below the unchanged five-second parent timeout.

## Evidence

The patch consists of `17dcfc20b` and `3aa6f5754`, kept separate from Quick Actions CSS.

- Original behavioral cleanup reproduced **three child failures**: the deliberate timeout, stale-clock restoration and a non-advancing deadline. Fixed cleanup yields **two child passes and one expected timeout**, with the parent regression passing.
- Original source guard fails; corrected module-capture guard passes. Renamed and same-name capture negative controls are covered.
- Initial affected-file run: **18 passes, 104 assertions**. The final generic-guard revision qualified in the integration lane: **19 passes, 107 assertions**. Five typechecks and scoped lint pass; no timeout was increased.
- Independent final review found no blockers after child-isolation, source-guard and bounded-termination corrections.
- Frozen combined qualification at `a828240fe` / tree `cb7770c7`, including the auth integration and these exact clock files: **6,065 runtime passes, 8 skips, zero failures; 25 feature checks; 9 web-build checks**. Historical 0.99.1 evidence passes separately (**308 + 160 tests, 8,720 assertions**); this is historical evidence, not complete Pi 1.0.0 acceptance.
- Exact source parity with the qualified combined tree:
  - `runtime/test/dream-agent-turn.test.ts`: `17d87aceca1c5a1dee65803b85a880364003179f52c989c09b9a06c1345699d7`
  - `runtime/test/dream-clock-cleanup.test.ts`: `81ab011f13b09077f4b570bc8d2d971d2e1f75beb1e3fd3df77663713d9f2e1f`

After the auth/CSS integration landed, this separate branch merged current main `268298645`. Both clock files remain byte-identical to the final qualified combined tree `32f243429`. The final current-main focused rerun passed **19 tests, 107 assertions**, across Dream cleanup, Dream turns, offline account recovery and session-idle deadlines. No source changes followed that run.

The integration lane also passed **45 auth cases, 188 assertions**, then the combined clock and Quick Actions browser check: **23 cases, 1,907 assertions**. Its first browser attempt failed before launch because the isolated HOME lacked browser binaries; the rerun used the existing cache without downloading. That setup failure is retained and is not counted as passing evidence.

No runtime changes, database changes, installation or restart.
