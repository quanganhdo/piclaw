# 17 September merge re-audit

Rui authorised **“re-audit, merge and validate”** at 2026-09-17 16:06 UTC, referencing the request to merge A then B with the recorded baseline lint/timing and coverage limits. This authorises repository merges after verification; it does not authorise deployment or restarting Smith.

## Frozen input

- Main: `ad922bdaac40b3a5119aa3017a10ee63897e318b`.
- Original A: `83b42a1be1950241da43ec2f05bb2a54f3c737b7`.
- Original B: `c34e54f2fe2400e6b74ab6e2c9f3e671b3eb8a09`.
- Both worktrees were clean; remote main had not moved.
- B's hosted check was successful. A retained its documented unchanged scheduler-timing failure; fresh local runs were required rather than treating it as green.

## Review findings and repairs

| Finding | Repair | Regression evidence |
|---|---|---|
| A accepted any source-only import exception as exclusion | Check `import.meta.resolve` without evaluating the unsupported module; require the expected Node/Bun export-resolution error and exact subpath | Exposed throwing module resolves and is rejected as an admission failure; real Node 22.19.0/26.7.0 and Bun 1.4.1 consumer probes pass |
| B independent fake resolver leaked rejected environments | Bounded candidate reads and deduplicated receiver-bound best-effort cleanup without importing the current resolver | Same hostile candidate tests run against both resolver implementations |
| B fake wait could reject while retaining group ownership | Convert throwing start/rejected release into typed errors; always retire group ownership and timer/listener state | Direct fake regressions cover both failure paths and idempotent cleanup |
| B completion metadata could contradict the final delivered shell view | Require successful normalized truncation/spill/partial-line metadata to agree with the last accepted update | Contradictory truncation, spill path and partial-line cases fail; matching metadata and actual NodeExecutionEnv behavior pass |

The runtime regressions first reproduced five failures before repair, then passed. B repair commit: `7a743d4e4`; A repair commit: `99faafce4`. A was merged into the B branch without rebasing. Independent bounded reviews found no remaining correctness blockers in these changes; aborted/timed-out reviews supplied no approval.

## Validation and limits

- Fresh A `make ci-fast`: 5,334 runtime passes, four skips, 25 feature passes and nine web-build passes. Type checking passes.
- B with runtime repairs, before integrating A's checker-only update: `make ci-fast` passes with 5,350 runtime tests, four skips, 25 feature tests and nine web-build tests.
- Integrated B focused tests: 53 pass across seven files; all typecheck phases pass.
- Candidate lint has the same 20 diagnostics as the unchanged baseline; no added diagnostics.
- Concurrent full-suite attempts suffered source-scan/SQLite/startup timeouts. The serial A attempt also hit one existing SQLite deadline; its isolated 50-test contract rerun and subsequent full A gate passed. No timeouts, assertions or tests were relaxed.
- Final integrated/merged-tree validation and artifact identities are recorded in the merge receipt and PR comments after this commit.

Canary archive integrity and its synthetic checkpoint verifier were rechecked: exact baseline restoration, nine messages, six usage rows and four browser smoke receipts pass. This is the earlier [canary artifact](earendil-0851-canary-result.md), not a claim that newly repaired adapter code ran on that VM. The repair changes the inactive current-Piclaw effector adapter/fakes and its tests; it does not change the active coding-agent creation path, model selection or service configuration. Real local NodeExecutionEnv regression tests cover the new metadata check. No new VM or production restart was performed for this re-audit.

Public Memory/JSONL SessionRepo scope remains accepted. Raw Storage exports, full HC completion (#1332), later-release work (#1333), non-Linux execution and baseline run-abort defect (#1334) remain explicit follow-ups. No Harness/pi-server activation, production schema migration, provider spending or live deployment occurs with these merges.
