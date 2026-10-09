# GPU meter continuity

GPU activity and memory rows appear after their first usable current sample with drawable history. Once established, each row remains visible through transient unavailable or stale readings, showing `—` for its current value. Cold, unproven metrics remain hidden. Valid zero readings remain zero.

## History and identity

The mounted HUD tracks activity and memory separately for each provider/device identity. It retains up to thirty samples, including null gaps, and merges unseen timestamped backend entries so readings collected between HUD polls are not lost. Initial and subsequent timestamped histories are sorted and deduplicated. Historyless responses use the actual current sample; missing readings append null rather than a previous value or zero. Re-rendering the same sample does not append another point.

Memory scaling stays consistent: observed-client bytes remain bytes, while established capacity-percentage history stays percentage-valued during telemetry loss. Capacity missing from a percentage metric does not convert that history to bytes. Observed client memory can overlap system RAM and shared buffers; it is not dedicated VRAM.

Removal, explicit disablement and identity change revoke remembered capability. Reappearance needs another usable reading. Disabling the HUD synchronously invalidates pending refreshes, clears its metrics and trackers, and prevents disabled renders from repopulating them. Polling avoids overlapping requests. State lasts only for the mounted HUD/page; no readings or capability flags are stored in browser persistence.

## Legacy aggregate NVIDIA memory

The legacy aggregate transport has no physical-removal signal. After successful telemetry, a null response retains an unavailable synthetic identity, without a current reading. Null alone cannot distinguish removal from a reader failure. Explicit device snapshots, including disabled or replacement devices, supersede and clear that synthetic identity. A changed provider also clears it.

## Rendering

GPU/GMEM paths receive the shared theme's activity/memory chart colours. A single valid sample draws a full-width line. Sparse isolated samples have nonzero round-cap segments, without bridging null gaps. Vertical coordinates are inset to keep the stroke visible at zero and one hundred percent.

Existing meter buttons open details through tap, click and keyboard. A proven unavailable row retains its accessible details; removing or disabling its device closes the dialog. No standalone details pill is introduced. Compact layout remains values-only. No-visible-client notes are shown when relevant.

## Verification boundaries

The upstream source change uses synthetic Intel, generic NVIDIA and legacy aggregate NVIDIA fixtures. It does not alter backend collectors or require hardware workloads. Issue #1596 records a separately authorised historical Intel workload and Sigma frontend hotfix; those are not new acceptance tests on Smith. Physical NVIDIA behaviour remains unverified. Qualification is recorded in `docs/reviews/gpu-meter-continuity-1596.md`.
