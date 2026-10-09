# Multi-agent session responsiveness

Two measured local costs are reduced: repeated idle-session reconstruction and forced memory reclamation during active work. The normal main-session cache retains up to four sessions instead of one. Memory pressure retains its existing 384 MiB threshold and one-session cap; explicit operator overrides still win.

Forced GC and SQLite cache trimming are coalesced. Pressure entry or eviction requests reclamation, which waits until protected runs, session creation/prewarm/disposal and streaming/bash/compaction have drained. Repeated ticks in the same pressure episode do not force collection again unless another eviction requests it. The existing cleanup interval bounds collection frequency. Ordinary runtime GC remains enabled. Under continuous work, explicit reclamation can remain pending; this change does not promise unconditional idle time or impose a new memory ceiling.

## Measurements

Smith LXC, Bun1.4.2/Pi1.0.4; baseline source a2a3c8f5b. Disposable synthetic histories, public SDK session reconstruction/context projection, no model inference or real credentials. Six alternating rounds, four sessions, 5,001 messages per session. Actual AgentPool pressure policy remains enabled. Three process runs per cache setting, interleaved by repetition:

| Median metric | One-slot cache | Four-slot cache |
| --- | ---: | ---: |
| Session reconstructions | 24 | 4 |
| History bytes reconstructed | 175,403,856 | 29,233,536 |
| Acquisition mean per run | 10.29ms | 2.31ms |
| History open/parse cumulative | 194.16ms | 36.37ms |
| SDK construction cumulative | 32.44ms | 9.74ms |
| Workload wall time, including sleeps/context checks | 708.01ms | 533.99ms |
| End RSS | 508,973,056B | 319,913,984B |
| Maximum timer delay per run | 28.27ms | 27.23ms |

The four-slot run spread includes a pressure-hit run with 12 reconstructions and 416.9MB end RSS. Acquisition means range 9.86–10.52ms for one slot and 2.28–6.05ms for four. The maximum timer delay does not establish a large worst-case improvement. These are local reconstruction costs, not provider or end-to-end chat latency. Correctness checks verify 5,001 context messages and stable context hashes on every visit.

Additional 1/2/4-session manager profiles and small full-pool histories verify the churn pattern. CPU samples from actual profile children expose parse/stringify/SDK work; fixture seeding, hashing, and launcher startup are included and separated from timed acquisition. Raw profiles remain local and are not standalone production attribution.

## Cleanup evidence

Three repeated cleanup profiles with a retained synthetic object graph: twelve forced-pressure calls roughly5ms apart cost a median135.39ms cumulatively before coalescing and14.89ms after. This measures suppression of repeated forced collections; it is not a six-minute natural-cadence comparison. These initial fixtures used an in-memory database even when labelled disk, because the shared helper enforces memory mode; those results are retained with the correction.

The corrected owned disk fixture verifies an actual file path, WAL and synchronous=2. At the real30-second cadence, three protected-work ticks over90 seconds performed no forced collection; the first idle tick performed one. Protected tick cumulative0.363ms; first idle10.95ms; RSS161.3→142.7MB before release. This synthetic soak supports deferred reclamation and preserved SQLite durability; it does not reproduce active production provider calls or establish every memory-growth scenario.

## Safety and qualification

Regression checks cover pressure-episode coalescing, cooldown, pending eviction requests, deferred work, active-run protection, asynchronous teardown draining, existing immediate pressure eviction, MCP admission fencing and config overrides/defaults. A focused suite passes117 tests/820 assertions. Types/scoped lint/static checks pass, with94 unchanged transitive frontend diagnostics. Explicit6.1 review clears the exact runtime diff; it identified the disk-fixture labelling issue, corrected before final evidence.

Full qualification is required before publication. No source change to database writes, indexes, credentials or provider admission. No live configuration, production install or restart. Storage contention, credential-lock waits and unrelated model/tool-transition stalls still need separate attribution; this slice does not claim every responsiveness issue fixed.
