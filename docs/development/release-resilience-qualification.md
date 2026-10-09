# v3.3.0 resilience release gate

The original exact-source UX run 37461771106 at cf0aac0dc timed out twice in resilience/compaction at the unchanged 18-minute workflow limit. No completed JSON report or per-test progress established the exact hosted cause. Those cancellations remain failed release evidence.

## Scope

All 41 shard cases remain selected; the existing missing-thumbnail case remains the one conditional skip. Six reconnect cases retain transport recovery, delivery, drift, status, refresh and queue coverage. Compaction/model cases retain usage, command/pie triggers, timer/abort mode, model picker/command/switch and post-compaction interaction.

The fixture now creates independent root sessions for reconnect/compaction, waits for real bootstrap/SSE readiness and supplies three short known turns with a small fixture-only retained window. The loopback/disposable model stub can hold one request until explicitly released and returns a valid structured checkpoint for actual summary requests. Tests assert real compaction starts, timer and mode, provider release, successful completion and cleared indicator; absence of an observed transition is no longer a pass.

Reconnect explicitly injects an EventSource transport failure while browser networking is offline (Chromium's offline switch alone does not reliably close an existing stream). Recovery opens the application's real new SSE connection. Missed-message recovery is fenced by an authenticated server-side persisted exact-response read while still offline; queued response identity and uniqueness are asserted. Version drift uses connected.app_asset_version through the actual EventSource listener, asserts the update notice and counts main-frame navigation/document identity.

Compaction-start SSE invalidates a cached idle UI snapshot. A previously attempted status-ref refresh guard was removed after review found real SSE did not update the captured ref; its artificial regression test was removed too. The retained invalidation has a focused cache regression and rebuilt browser coverage.

## Diagnostics and limits

Line reporting and incremental progress JSONL retain test identifiers, phase names, retry counts and timings, not prompt/error/header/credential payloads. Generated test secrets are masked in Actions. Missing completed results yield an explicit incomplete JSON diagnostic, never a PDF/pass claim. Existing retry policy and 18-minute job deadline remain unchanged; acceptance runs use retries=0 and max-failures=2. Production compaction defaults and endpoints are unchanged.

Three comparable corrected disposable local runs on Bun1.4.2/Linux/Chromium: 78,967.597ms, 78,020.846ms, 81,563.114ms; each 40 expected, one skipped, zero unexpected/flaky. No retries. Per-test JSON/progress evidence remains under /workspace/tmp/v330-reviewed-stable-*. This meets the under-five-minute target locally, not proof of hosted elapsed time or the prior timeout's sole cause.

Final local typechecks pass with the same 95 transitive diagnostic signatures; only affected source line positions were rebased. make ci-fast: 6,571 pass, 71 historical/opt-in skips, zero failures; 25 feature and nine web checks. Earlier failures and review findings are retained; they are not qualifying gates. CI receipts/reuse/caches/routing followups are deferred to core1577–1583 and addons180–183 by Rui. No production install/restart.
