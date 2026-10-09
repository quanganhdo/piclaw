# Remaining performance audit — 5 October 2026

The initial mixed, long-history and background workloads are measured. Both proposed FTS search changes were rejected and reverted; production search code and schema are unchanged. This report does not complete performance acceptance or authorise deployment.

## Measurements

Bun 1.4.2 on Smith LXC, isolated synthetic disk SQLite with WAL / synchronous=FULL / busy timeout5000. No production database, credentials, inference, GPU workloads or restart. Initial source44affa34d; fixtures604556e30. These initial timings precede the merged GPU meters. The audit worktree now includes e3fbf6cf1 and matches its runtime source; a fresh mixed smoke passes on that closure.

| Workload | Three plain-run work total, median (range) | Scope |
| --- | --- | --- |
| Long history | 114.2ms (113.1–128.2) | Six public SDK opens of an11.3MB/5,000-entry JSONL history, ten context projections per open |
| Mixed handlers | 3,596.6ms (3,588.8–3,634.6) | 500 authorised principal resolutions, 50-row timeline pages, tool-output searches and25 rotating statement shapes |
| Background cleanup | 95.2ms (90.3–112.6) | Expired auth, DB+registered/orphan files, idempotent repeat, owned synthetic rows |

23 successful initial child runs:18 plain/instrumented,3 CPU profiles and2 final heap snapshots. Seed/setup is excluded from workload timings but included in whole-child CPU captures. Instrumented overhead/spread and event-loop counts are in the JSON. CPU percentages are sample attribution, not elapsed-time gains.

## Ranked observations

1. Mixed SQL `all()` calls dominate: ~2,981ms attributed in one instrumented run,1,500 calls. Whole-child CPU samples identify native SQLite `all` as the largest self-sample group. The common-term tool-output search is the main lead.
2. Background transaction wall time dominates its small workload. One instrumented run records4 immediate transactions/~121ms versus519SQLrun calls/~22ms. These are overlapping inclusive measurements; do not add them. Durable commit and filesystem work need their own attribution before changing durability or scheduling.
3. Long-history opens parse30,012JSON values/~67.7Mcode units in one instrumented run. Plain heap grows ~15MB→61–79MB and returns ~15MB after explicitGC. Six repeated opens deliberately reparse the file; this supplies no justification for caching stale session or auth data.
4. ExplicitGC takes roughly5.8–8.0ms in these observations. Final heap snapshots mostly contain objects/code. They do not measure automatic-GC pause causation, retained references over a soak or allocation stacks.

## Rejected search proposals

`output_id` is UNINDEXED in the FTS table. Resolving target rowids first improves broad, late-output searches but penalises rare terms (~6→160ms/100calls). A64-match probe retained rare performance at ~7.6ms while reducing a chosen late/common workload; independent review rejected it because global frequency alone does not establish a cost crossover and introduces shared-corpus work.

New query-only distributions cover11,000/101,000chunks, early/middle/late/1,000-chunk targets,63/64/65global matches, rare and absent terms. They confirm the blocker:

- On101,000chunks, ten early/common baseline queries take~0.34ms versus~95–101ms for target-first/probed plans.
- Sparse64-match baseline queries take~0.15–0.41ms across tested positions versus~103–167ms for alternative plans.
- Late/common still favours target-first in this fixture; that best-case gain does not justify unconditional/default adoption.

Both candidate commits are reverted in the audit branch and were never merged to main. Full result sets/limits/owner denial and existing family regressions pass, but correctness does not waive cost concerns. No schema/index/storage change is adopted. Future proposals need a cost-aware design with write amplification, scoped ownership, corpus position and chunk cardinality included.

The first transaction instrumentation used a Proxy incompatible with Bun's frozen transaction methods; its failed run is excluded and retained locally. The older search profiler did not wrap `query().all()`; its instrumented probe timings are excluded. The distribution probe measures `all()` directly and separately from the selected query.

## Actual note writer and concurrent parent reads

A further seven runs use100 owned synthetic notes with20sections each: three plain, three instrumented and one CPU profile of the actual writer child. A private inherited fd3 binding supplies writer authority; the parent probes synthetic web-session/timeline and scheduler due-task reads every five milliseconds. Publication is verified ready, with no staging/writer lease and exactly200 source opens. No scheduled task or provider is executed.

Plain writer times2.331–3.175s (median2.942s). A later final correctness smoke took4.343s, outside that comparable series, so these observations establish no latency bound. Parent probe batches continue throughout; initial plain maxima4.96–12.75ms. Instrumented writer109immediate transactions total2.054–3.013s inclusive, while4,604SQLrun calls total44–51ms. Commit/transaction/check costs dominate but are not separated by those inclusive totals. Actual writerCPU635samples identifies native SQLite run and repeated filesystem/config authority checks; this does not justify weakening late revocation or durable commits.

The fixture checks publication, database integrity and zero network. The delegated review timed out and supplies no approval. Type/lint/final correctness checks pass. No batching or production change is adopted; raw writerCPU and logs stay local.

## HTTP and scheduled-execution plumbing

The extended audit adds14HTTP runs: three plain, three instrumented and one whole-childCPU run each for single-user and family modes. The actual owned loopback server executes RequestRouterService, WebAuthGateway and timeline/owner gates against10,000synthetic rows. Each run has100requests at concurrency4 plus a serial revoked-cookie probe. Family mode has75owned successes and25foreign denials; single-user has100successes. The modes are different workloads and supply no relative speedup.

Plain100-request batch totals459–495ms(single-user) and409–445ms(family); total wall includes135ms intentional sleeps plus revocation. In-report CPU deltas exclude setup; external CPU profiles include setup. Onlyrequest IDs and family private-cache headers are asserted, not every security header. Original `responseBytesTotal` used stringlength; final corrected checks use UTF-8 bytes. Wrapped fetch denies nonserver-origin requests after setup, without claiming a universal network sandbox. The first fixture followed a revocation redirect into an unconfigured login-page fixture; that failure is retained and manual redirect handling now verifies the original denial.

Seven scheduled-plumbing runs use20actual `runScheduledTask` calls in batches of4with an injected5ms synthetic agent, restore/message counting stubs and no nudges. All20logs persist and recurrence remains unchanged. Plain wall304–320ms and event-loop maxima53–59ms; an earlier827ms/446ms smoke outlier is preserved separately. A final attributed run records20task-log inserts/~223ms and parent timer lateness~45–48ms. The parent auth query itself is short, but does not establish responsiveness while synchronous durable writes stall timers. No real Agent/provider, durable scheduler claim loop, external delivery or SDK leaf restoration is qualified. In-report CPU is post-seed; external CPU includes setup. WAL/FULL durability is unchanged.

A separate real HTTP read probe runs20authorised timeline requests while an owned external process holds anIMMEDIATEWALwrite lock for500ms. Three runs finish the reads in163–190ms, with10ms timers observed at10.1–15.5ms. After release, cookie revocation denies access. This checks read responsiveness only, without family mutations or a full write-admission workload; it supplies no absolute latency guarantee.

## Open coverage

- Broader HTTP/message admission/CSRF mutations and concurrent family execution, beyond read/denial routes.
- Real scheduler claim-loop/inference execution, concurrent retention/index writers and separate contending writers beyond existing earlier fixtures.
- Automatic GC pause/retention causation and wider large-history/context assembly shapes.
- Required production Delegate settlement/account contracts and immutable artifact/policy/credential/process qualification.
- Explicit deployment/restart/live account/server canary permission and operational rollback.

`safe-audit-report.json` contains reviewed synthetic aggregates, source parity, profile hashes, rejected-prototype dispositions and gaps. Raw CPU/heap files stay local under `/workspace/tmp/pi102-remaining-performance/profiles/`. The replay scripts/qualification-only patch are included for further isolated work; they do not install or activate anything.
