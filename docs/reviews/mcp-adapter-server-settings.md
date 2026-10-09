# Adapter MCP server Settings

Both MCP panes now preview and apply adapter server overrides through owner-only direct routes on released Pi 1.0.2, retaining the shipped wrapper. Native engine replacement is outside this integration scope. Source only: no production installation, restart, configuration mutation or real-account test.

## Change boundary

The exact public adapter dependency is `dddfcf630508f42c169889c11dee94e69b746e7c`, merged PR10 after 1,436 Bun tests/public-package checks. Server GET/preview use its virtual highest-project override reader; they do not write, resolve credentials or execute servers. Opaque five-minute bounded tokens retain private candidates, instance/bridge/workspace bindings and exact preview state.

Explicit per-server patches preserve unrelated raw settings/imports/servers and private/advanced fields. Withheld argument/map/credential values stay out of browser payloads. Unknown enabled semantics reject; disabled/private definitions can be retained inertly. Effective inherited credential reuse after endpoint/transport change rejects, including retained values inside changed header objects. Removing an override previews any revealed inherited definition; disabling keeps it inert.

All Apply flows share one controller phase and captured-prompt fence. Server changes drain main/side lifecycle work, abort turns, await all public adapter shutdown acknowledgements and release old credential leases. A private single-use batch receipt prevents captured ordinary reloads before instance commit/hydration. Fresh owner/cancellation/file/workspace/source identity checks run after lock and before rename. The synchronous rename callback records commit before asynchronous unlock/deadline tails. Its private receipt binds the committed file hash/inode, unchanged original lower sources and exact previewed effective configuration through hydration and startup admission.

Guarded hydration checks authority/signal/source identities before and after late keychain results and before publication. Reload uses public session APIs and a common startup barrier; no participant resumes until all reloads finish. Failed/late participants are quarantined and admissions stay blocked. A post-rename failure reports saved-but-not-activated. No automatic fallback, rollback claim or provider execution is introduced. Session identity/history is retained.

## Evidence so far

- Corrected authority/controller/writer/ACK/API/model/codemode/exact-package regression: 181 passed / 791 assertions across 14 files, 13.58 seconds.
- Actual offline Pi1.0.1 + synthetic stdio MCP current/new-session test passed; old process closes before replacement, identity/history retained, no external network/provider.
- Rebuilt Classic/Visual browser matrix: 14 passed / 590 assertions; Chromium/WebKit, desktop/mobile codemode regressions plus server preview/disable/Apply/remove/private preservation/owner denial.
- Web build: nine passed / 26 assertions. Five type stages pass with 95 unchanged frontend transitive diagnostics. Changed-file lint/circular-dependency/pack/stale checks pass.
- Synthetic isolated disk-backed 100 read/preview requests with 25 servers: wall187.15ms, CPU user165179µs/system27274µs, maxeventloop14.78ms/p9913.27ms, 1051JSONparse6.67ms/600serialise1.20ms/250SQLquerylookups0.54ms. Uses direct owner handler with SELECT1 authority probe; excludes complete HTTP auth/CSRF, credentials, Apply, servers/providers, production throughput and separate commit costs.

Local logs under `/workspace/tmp/mcp-server-*`. Machine-readable profiling/receipt is maintained separately. Full frozen qualification and final independent source review are required before publication.

The first frozen full run at `b4cc07012950d0ed691133a61c26a22c95e8c3bf` failed: 6,383 passed, eight skipped, one stale exact-adapter-pin assertion, 41,017 assertions in 1,008.28 seconds. Log SHA256 `d09a9c871cd64ac1857155163a1bc82ab594fedd5092085591ed86ac5adf188b`. Final review separately found retained stdio credentials could follow changed executable/arguments/cwd, and post-rename unlock mutations could activate unpreviewed configuration. Both have targeted local/inherited and gated unlock/startup regressions. Stdio identity now includes arguments/cwd and preserved credential-bearing environment/argument references; the rename receipt fences committed and lower files through activation. The old full run does not qualify these corrections.

A subsequent v2 gate was stopped for confirmed reference/literal rebinding corrections; exit143, logSHA `6bae91e61bc0f71190a4161e6f880a5093c44ce1ede3d6040dfbe8bace7c834e`. References are compared by environment/keychain identity across fields, keys and formats. Destination changes with opaque old/new argument/map/auth payloads fail closed when clearing cannot be proved. Local and inherited wrapped/rekeyed reference and literal cases reject. An actual offline Pi post-rename mutation fixture confirms saved-but-not-activated, old PID closed and zero replacement processes. No stopped run is qualifying evidence.

The final 1.0.1 full v3 failed outside the MCP feature: 6,418 passed, eight skipped, two failures, 41,082 assertions, 1,721.73 seconds. Concurrent empty-schema startup returned `SQLITE_BUSY`; the small-busy runner child hit its watchdog. Log SHA256 `621f9f1d07cc9c7f14078f5321b2e7dcd9447a1ec9ecd8fa0ff4734eeae09904`. Independent database-startup correction is owned separately.

Runner profiling isolated 6,564 ms in disposable schema setup and 21 ms in script execution/settlement. Its fixture now prepares the same disk database in a separately bounded 15-second setup hook (14-second child cleanup); the original runner test retains its 15-second bound, 10-second child watchdog, all settlement/output/ownership assertions and modes. Prepared suite passed nine tests / 36 assertions; final small-busy passed four assertions in 98.75 ms after setup. No production runner or durability change was made.

Rui retargeted current integration to released Pi 1.0.2. Qualified main PR1549 at `d1858aa84f028038c4affb8d49d79943feb0fea7` was adopted by merge, preserving the approved adapter pin and runner-fixture correction. Prior Pi 1.0.1 results remain historical. Keep the shipped adapter wrapper. Unreleased OAuth cancellation changes, Native parity/removal, installation, restart and real-account tests are excluded.

## Released 1.0.2 integrated evidence

- Integrated Settings/credential/writer/ACK/current+new SDK/startup/runner suite: 203 passed / 852 assertions across 16 files, 17.95 seconds.
- Fresh rebuilt both-skin Chromium/WebKit matrix: 14 passed / 590 assertions, 13.65 seconds. Web build: nine passed / 26 assertions.
- Five type stages, scoped lint, silent-catch/structured logging/dependency/action/env/circular/pack/stale checks pass. MCP security source hashes match final corrected review; only active SDK receipt version/pin fixture conflicts were reconciled during adoption.
- Fresh 100 read/preview requests/25 servers: wall148.21ms, CPUuser139439µs/system15640µs, event-loopmax16.34ms/p999.90ms/52samples; JSONparse1051/4.65ms/stringify650/1.09ms/query250/0.35ms. Synthetic fixture scope remains unchanged; no performance causation or production throughput claim.
- Fresh integrated `make ci-fast` passed on frozen head `04d6c9917f3e66e9255784874de83b6a3c548388`, tree `edbb79d707e76fb1500583ac77c34b0c5be3d9f2`, from 08:38:20 to 08:49:03 UTC on 5 October 2026: 6,456 passed, eight skipped, zero failed; 42,138 assertions, 6,464 tests across 917 files, 632.50 seconds. Features25/246 and web9/26 passed. Final head/tree unchanged and worktree clean. Log SHA256 `7a7661ce3b3e63f51db5c3375609b1092f47a0bd65145064667bfa4c8431b601`.
- Publication adds only qualification prose/JSON. Runtime, dependency, test and script parity with the frozen head is verified. No old failed run or prior-target green substitutes for this gate.

## Retained failures

The first new Classic/WebKit matrix case hit its unchanged20-second deadline; isolated unchanged rerun passed1.87s, then final rebuilt matrix passed all14. Old policy browser locators matched the added editor too; scoped original-section locators retain assertions and identify the added editor separately. No timeout or functional assertion was removed.

Initial HTTP fixtures named non-existent route/rate-rule exports; corrected to actual exported functions. Failed body stream previously returned503 after refactor; fixed400 restored original assertion. Actual runtime fixture omitted a binding callback needed for SDK reload start hook; added public onError binding and reject production reload that bypasses its startup gate. All failed logs remain local. A delegated final source review timed out and supplied no approval.
