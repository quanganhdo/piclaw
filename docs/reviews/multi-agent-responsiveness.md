# Multi-agent responsiveness improvements

The normal idle-session cache now retains four main sessions, and forced GC/SQLite cache trimming wait for idle lifecycle boundaries and are coalesced. Both changes address measured reconstruction and repeated-cleanup costs. The existing 384 MiB pressure threshold, one-session pressure cap, active-run protections, credentials, SQLite durability and operator overrides remain intact.

## Qualification

Frozen source `f9a6e1938b7b386a278abc883ad22f721d1fc6f6`, tree `42e32abbc985a9220b044a9d8de53a8f138680ed`, runtime tree `efff2f66cd53645c47604dedb67eff5fb0bca6db`.

| Gate | Result |
| --- | --- |
| Complete runtime suite | 6,656 passed / 71 skipped / 0 failed; 43,279 assertions; 955 files; 660.65s |
| Focused session/config/MCP fencing | 117 passed / 820 assertions |
| Settings/pane contracts | 25 passed / 253 assertions |
| Web build tests | 9 passed / 26 assertions |
| Types, scoped lint and static policies | Passed; 94 unchanged transitive frontend diagnostics |
| Explicit 6.1 final source review | Exact scoped diff and gate CLEAR; no reviewer tests |

Full run queued behind existing complete gates, then ran 7 October 2026 17:39:08–17:50:18 UTC. Frozen head/tree and clean worktree remained unchanged. Log: `/workspace/exports/responsiveness-20261007/full/ci-fast.log`, SHA-256 `64707b4cb800cb7f140c0f6dc0aa723f07b4ae5b48ab928eb4aa297b82ad399f`.

## Cost and safety evidence

Actual public SDK/full AgentPool profiles used disposable synthetic 1,001/5,001-message histories, stable output count/hash checks, 1/2/4-session interleaving, and child CPU profiles. With four large sessions and the pressure policy enabled, three runs per cache setting had median acquisition means10.29→2.31ms, reconstructions24→4, reconstructed bytes175.4→29.2MB, and end RSS509→320MB. One four-slot run crossed pressure and reconstructed12 sessions; its cost and memory spread are retained. End-to-end provider latency and the previously observed956ms service stall remain unattributed.

Repeated forced-pressure cleanup calls cost median135.39→14.89ms cumulatively over12 closely spaced calls. This is repeated-work suppression rather than a natural-cadence soak. Review caught the initial disk-labelled fixture actually used memory mode; these results are retained and relabelled. The corrected fixture verifies an owned database file, WAL and synchronous=2. At30-second cadence, three protected ticks over90 seconds did not force GC; one idle tick collected, with RSS falling during the hold. This synthetic fixture does not prove every sustained-memory scenario or guarantee idle time under continuous work.

Tests retain eviction/pressure caps and config override precedence, pending cleanup across busy work/cooldown, asynchronous teardown draining, protected/busy sessions, and MCP admission fencing. Ordinary runtime GC remains enabled. Initial added config-test helper failures are retained and corrected; no production assertions, deadlines or durability guarantees were relaxed.

Reproducible fixtures: `runtime/test/fixtures/multi-session-responsiveness-profile.ts` and `session-cleanup-profile.ts`. Detailed method/limits: `docs/development/multi-agent-responsiveness.md`. Aggregated local profiles: `/workspace/exports/responsiveness-20261007/profile-report.json`, SHA-256 `99ea977c067190e236da98a12f8f0de4c1257a2926de1bb11b5e66507ac125b5`.

Publication after the frozen gate changes docs/receipts only and verifies runtime parity. No live configuration, provider account, production installation or restart changed. Storage contention, authentication waits and unrelated model/tool-transition stalls require separate attribution; this is not a claim that all slowdown is eliminated.

## Approved current-main integration

Rui authorised merge on7October2026 at19:17UTC. Main274a6cdbd was merged without rebase. Fresh exact-source complete gate at `a13a3503c0f230644d4bf018b643db683ed8ab7f`, tree79290d7c8be7e09f5f5284f431439e21c355aeaf, passed6656/71skip0/43279assertions+25/253+9/26; focused combined125/909. Private local receipt9e383c94-9f99-4e2a-b9a1-f8509897e560 is passed for canonicalci-fast only. Runtime tree `6a15950d9fb92afd6917baa537d0753b1c626fbb`. Final publication adds documentation/receipts only. No installation or restart.
