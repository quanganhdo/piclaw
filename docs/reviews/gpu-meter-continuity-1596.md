# GPU meter continuity — issue1596

Proven GPU rows now remain stable through temporary counter loss, with unknown current values and null history gaps. Theme strokes and single/sparse samples remain drawable. Explicit removal/disablement resets capability. This implements the latest issue policy; cold/unproven metrics remain hidden.

The starting patch was taken from issue comment6045818289's authorised Sigma frontend hotfix. Additional regressions and source review found history-recovery, between-poll gap, replacement and pending-disable defects; those were corrected before qualification.

## Qualification

Frozen head `757308fec5cc3a8c53572d233d322c0eea0a6258`, tree `515c2ea9568686ff607f29f907fbc12273a42fae`, runtime tree `802145235f2d7ffba08d98225687ab64c58fa254`.

| Gate | Result |
| --- | --- |
| Complete runtime suite | 6,686 passed /71 skipped /0 failed;43,444 assertions;958 files;657.02s |
| Focused UI and unchanged collectors | 60 passed /466 assertions;5 files |
| Rebuilt browser matrix | 9 passed /145 assertions;Classic/Visual Chromium/WebKit, desktop/tablet/compact and pending-response disable race |
| Settings/pane contracts | 25 passed /253 assertions |
| Web build tests | 9 passed /26 assertions |
| Types, scoped lint and static policies | Passed;94 unchanged transitive frontend diagnostics |
| Explicit6.1 source reviews | Final scoped CLEAR after corrections;reviewers ran no tests |

The complete gate queued behind an existing run, then ran7October2026 21:08:23–21:19:30UTC. Head/tree and clean worktree remained unchanged. Wrapper logSHA `e672c59cb37643441b857c01e340f735e74bff1a168adc0d3b947adf82b272bb`. Private canonicalci-fast receipt `3ff124c1-f4ec-4662-82db-c10e8140a5d3` passed for exact frozen source; aggregate6720/71skip0 across three summaries, raw loghash `139951e376aba12f300584827ca0585786ba94585211ed2d177e82fe0e83cb62`. Browser capability is separate;other receipt capabilities are not-run.

## Corrected cases and retained failures

- A recovery without backend history previously discarded old samples and null gaps; retained now.
- Fresh object identity was an incorrect deduplication signal. Repeated same-sample objects no longer append gaps; timestamped history is sorted/deduplicated from its initial seed onward.
- Backend samples collected between polls are merged, including nulls; chart segments do not bridge a known loss interval.
- Legacy synthetic aggregate identity is cleared by explicit replacement/disabled snapshots. Nullable aggregate history no longer coerces null to zero.
- Established byte/percentage scaling survives unavailable counters and changing capacity information.
- A successful response could arrive after disable but before effect cleanup. A synchronous generation/enabled fence rejects it; trackers do not update during disabled rendering. Poll requests do not overlap.
- Added polling stages exceeded the original combined browser test's twenty-second deadline. The independent pending-response race was split into its own twenty-second test, retaining all assertions and original deadlines. Failed combined logs are preserved;final rebuilt matrix passes.
- Initial byte-label expectation, a local scope error, and review timeout are retained. Existing byte formatting was preserved; timeout supplied no approval.

Evidence logs are under `/workspace/exports/gpu1596-*`. No deadline, assertion or database/collector semantics were weakened. No new GPU workload, account/provider request, live UI configuration, installation or restart occurred. Historical Sigma Intel load remains issue evidence;no physical NVIDIA claim is made.

Publication changes are docs/receipts only and must retain the qualified runtime tree. Merge requires separate approval.

## Approved current-main integration

Rui authorised merge7October2026 at21:35UTC. Main3d33978e8 adds Actions measurement docs/scripts/tests and was integrated without rebase at `f6de1fc11e14498105a1577bbe11a1a794dba000`, tree11ff94035ca5eedf1ac51cb8b87bef0cc5287501. Combined focus63/485passed. The first integrated complete run failed the unchanged receipt-retention15s test; retained failed receiptcf186183-33dc-4aec-ac12-afc255305778 and logSHA0f9a09be0791f2317f866cd5519535c117b77de44d6f54c20f33c6eb089495fb. Whole affected file7/146passed unchanged; cause remains unproven. A fresh unchanged complete run passed6686/71skip0/43444assertions+25/253+9/26, private receipt20a8c6ee-2904-4bf3-8108-c1f7b3577765passed. WrapperlogSHA9a63edd6f414c6202e8ed26d136a14d0fef8537cfbbb7a41aeea8b1dce84f4b2. No deadline/assertion changes or isolated-pass substitution. Runtime tree `bf79cbacfcbbce5f9b42c32cb322dfb9e2d3d983`; final publication documentation only. No deployment/restart.
