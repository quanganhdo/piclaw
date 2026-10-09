# Timeline, meters and audit integration

The returned-timeline correction and measured performance audit are combined with the already merged GPU meters. The integration contains exact [timeline PR1556](https://github.com/rcarmo/piclaw/pull/1556) head `753f0a533123f563e7c752463550f6cebfa259cf`; [meters PR1555](https://github.com/rcarmo/piclaw/pull/1555) is preserved at `e3fbf6cf1`.

Six conflicts affected generated Classic bundles and the cache-stamped index only. Classic and Visual assets were rebuilt from the combined source. Source comparison verifies the incoming timeline/Visual code and merged meter backend/UI remain unchanged. The performance work adds fixtures, tests and evidence only; rejected FTS candidates are reverted and production query/schema remain unchanged.

## Verification

Frozen head `936a6ac53bb4ab4e27329db92ea4fc4f1180f9b9`, tree `43fcaf7ecb708b1daa600f1e406998294f18bf2f` passed `make ci-fast`, exit0, unchanged and clean: 6,508 passed, eight existing skips, zero failures, 42,649 assertions across924files,619.77seconds; features25/246 and web/build9/26. Finished5October2026 at12:17:59UTC. Log SHA256 `17f7282b1547b4b9cb01f15321330749052352e636498375d4fff23361ce325b`.

- Complete rebuilt Chromium/WebKit timeline matrix plus Intel fixture:26passed/182assertions, zero failures. Earlier invocation skipped Visual opt-in tests; the final run sets the disposable flag and executes all cases.
- Combined focused timeline/service-factory/meter/search/report slice:77passed/733assertions, zero failures. Canonical fast CI excludes script tests; the report structural test ran separately.
- Five type stages pass with95unchanged compose diagnostics. Static/local-test/fixture scoped lint checks pass.
- Owner reviews cleared timeline continuity/history replacement and measured fixture-only bootstrap correction. Integration delegates timed out or were interrupted and supply no approval; direct source parity, generated rebuild and combined execution are recorded separately.
- The service-factory tests use the real public model runtime with catalogue refresh disabled for collaborator-wiring tests only, owned paths and in-memory settings. Original assertions/five-second limit are intact; production model bootstrap is unchanged.

The audit-only frozen gate at `eebc609f8` passed6,497/eight skips/zero failures before timeline adoption. Timeline owner's frozen gate at `686695bb8` passed6,467/eight skips/zero failures. Neither earlier gate qualifies this combined source; failed owner/bootstrap and rejected-prototype receipts remain retained.

[Remaining audit](remaining-performance-audit.md) records workload scope, outliers and unfinished coverage. [Timeline review](../reviews/timeline-restore-viewport.md) records viewport/catch-up, history anchors, failed-page retry and divider latest-chevron behaviour. Publication adds this prose and receipt only, with runtime/test/dependency/script parity to the frozen combined head checked before push.

No installation, restart, live account/provider access or production database changes occurred. Pi1.0.3 retargeting was authorised after this integration completes; these1.0.2 results remain versioned historical evidence for that next task.
