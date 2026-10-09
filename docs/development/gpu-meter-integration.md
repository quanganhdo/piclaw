# Intel and NVIDIA meter integration

Intel DRM activity/memory meters and the NVIDIA NVML worker share the system-metrics endpoint. The integration contains exact incoming heads [PR1553](https://github.com/rcarmo/piclaw/pull/1553) `c408af43c485d011d6e8c935410263899bf3f0b5` and [PR1554](https://github.com/rcarmo/piclaw/pull/1554) `c383f45ed8b1ff4f56c78713e37d5cd26eb62c35`, plus two reviewed integration corrections. Both incoming heads passed their exact hosted checks.

Visible meters renew Intel demand and read cached NVML snapshots. General UI-status polling skips both GPU readers and returns no GPU sample without erasing existing VRAM history. The NVIDIA subprocess sampler is removed. Intel `gpus` and NVIDIA `vram_*` fields retain their separate accounting semantics.

## Corrections

- Passive polling originally cleared the shared VRAM series. The integration updates GPU history only for GPU-demand reads. A GPU → opt-out → GPU regression verifies the retained series and unchanged reader counts during opt-out.
- A partial non-empty sysfs scan originally dropped known Intel devices. Incomplete scans now merge bounded known/discovered identities; only complete scans confirm removal. The two-device fixture verifies partial retention followed by confirmed removal.
- Intel PR1553 advanced during qualification. Its value-only GPU detail interactions were merged and retested; the earlier frozen result remains separate.

The native NVML worker keeps synchronous C calls off the HTTP thread. It does not isolate native crashes or interrupt a hung C call. Intel filesystem budgets are cooperative; incomplete process scans report truncated observed-client coverage. [NVIDIA limits](../gpu-metrics.md) and [Intel accounting](../intel-gpu-meters.md) remain explicit. No physical driver, GPU workload, permission, deployment or service change occurred on Smith.

## Qualification

Final frozen head `e19c834eb1af0a49be7593bb14934279d7173c74`, tree `2ddf226047dca3d9ec6861a6437aa7c9d3300095`:

- Canonical `make ci-fast` stages completed: 6,496 passed, eight existing skips, zero failures, 42,503 assertions across 922 files; runtime 655.48 seconds. Features25/246 and web/build9/26 passed. The original tool wait was interrupted while its child continued; the launcher exit code was not captured. The surviving complete log, terminal stage summaries, unchanged source and clean worktree are recorded without inventing an exit receipt.
- Full log SHA256 `419955663950e040472b68a31995af671602e68efe4b81851c8e9d878f11255b`.
- Corrected focused backend/UI/cache/ABI slice: 53 passed / 531 assertions, seven files, zero failures.
- Final Chromium desktop/tablet fixture: one passed / 30 assertions, including no-GPU hiding, direct tap/keyboard controls, focus/dismissal, live removal and no accidental reopen.
- Five type stages and scoped lint passed; compose retained its existing 95 transitive diagnostics.
- Scoped source reviews cleared accounting, corrected incomplete-device handling, NVML ABI/cache/poller semantics and the corrected opt-out history path. Larger delegated Intel reviews timed out and supply no approval.

Earlier combined heads `494711c26` and `3df108350` each passed their full stages at 6,495/8skip/0fail. They do not qualify the final correction. Historical logs stay separate. Publication adds only this record and its receipt; runtime/dependency/test parity with the final frozen head is checked separately. No installation or restart follows a source merge.
