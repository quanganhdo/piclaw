# Note-recall release measurements and gate disposition

**First-release workload limits accepted by Rui on 29 September 2026.** See the [acceptance receipt](../design/local-note-first-release-acceptance.md) and [accepted limits](../../runtime/test/fixtures/note-retrieval/accepted-release-budgets.json). The integrated workflow passes the accepted fixed-workload limits. It did **not** meet every older proposed file-search threshold; the old proposals and failed observations remain unchanged below.

## Reproduce

```sh
bun run test:controlled -- runtime/test/note-retrieval/release-workflow.test.ts runtime/test/note-retrieval/files-limits.test.ts runtime/test/extensions/extensions-memory-guidance.test.ts
```

The release worker copies the consulted 16-note regression corpus and creates 500 normal ~8 KiB filler notes with complete lines. It asserts all 516 sources were indexed, not excluded. Six independent processes use **the same disposable store** for build, three reopens without refresh, three interrupted writer attempts followed by recovery, and a single-file dirty/incremental refresh. All leaf/parent references are read with `memory_get`; all corpus source IDs, ordered evidence text, revisions, bounds, signals, coverage and statuses must remain identical across phases. Dynamic timing, generation timestamps and serialized rank lengths are not reference identity. No provider/model calls or live workspace/store access.

## Recorded run

Measured on Smith LXC with Bun 1.4.2, source based on #1431 `d59b8cafb`, plus #377 guidance and reviewed allocation/cleanup fixes. Run log: `/workspace/tmp/377-final-focused.log`.

| Metric | Build | Reopen | Incremental |
|---|---:|---:|---:|
| Indexed files | 516 | 516 | 516 |
| Source bytes | 4,387,001 | 4,387,001 | 4,387,032 |
| Note-owned table/index pages (bytes) | 9,949,184 | 9,949,184 | 10,719,232 |
| Note pages / source bytes | 2.27× | 2.27× | 2.44× |
| Refresh wall time including bound worker startup | 8,270 ms | none | 500 ms |
| First measured query | 13.15 ms | 13.15 ms | 19.54 ms |
| p95 of 22 query calls | 20.22 ms | 18.51 ms | 21.58 ms |
| Max encoded query response | 6,385 bytes | 6,385 bytes | 6,387 bytes |
| Parent/leaf evidence covering full labelled spans | 12/12 | 12/12 | 12/12 |

RSS at report was 81.6/80.8/83.0 MB; the controlled runner sampled a 164 MiB process-tree peak. Report RSS is not peak RSS. Note page totals include autoindexes selected via `sqlite_schema.tbl_name`; whole messages-DB bytes (11.8 MB initially, 22.8 MB after incremental staging) also include unrelated schema and free pages, so are not labelled note-index size. The test is not a long-duration storage growth bound. These source bytes are real normal paragraphs, but unrelated fillers do not demonstrate ranking under a dense relevant corpus. Times are one local run, not a statistically robust production latency estimate.

## Repeated warm queries and writer-interruption follow-up

The extended run (`/workspace/tmp/377-repeated-release.log`) passed **6 tests / 101 assertions** in 34 seconds. Each of the six phases measured 22 first-pass query calls and five subsequent repeats of each query (110 warm calls per phase, 660 total). After removing validation timestamps, every warm response must match its first-pass response, including ordered citations, snippets, context, ranks, signals and status. The three same-store reopen processes preserved all corpus chunk IDs and evidence. These are process-cold calls, not disk-cache-cold measurements.

| Phase | Warm p95 (110 calls) | First query | Note pages/source | Refresh wall time |
|---|---:|---:|---:|---:|
| Build | 17.11 ms | 16.04 ms | 2.27× | 8,559 ms |
| Reopen 1 | 17.41 ms | 12.39 ms | 2.27× | none |
| Reopen 2 | 16.20 ms | 11.20 ms | 2.27× | none |
| Reopen 3 | 18.94 ms | 12.68 ms | 2.27× | none |
| Recovery | 16.58 ms | 11.96 ms | 2.45× | 10,643 ms |
| Incremental | 16.67 ms | 16.29 ms | 2.46× | 566 ms |

The maximum warm call was 29.26 ms; max encoded output remained 6,387 bytes. The controlled runner sampled a 162 MiB process-tree peak. This finite run fits the newly proposed workload-specific limits below, but not the original 10 ms, 2× or 4 KiB proposals. It is not automatic approval of revised thresholds.

Three **real bound note writers** were stopped at a deterministic barrier after staging several files and killed with SIGKILL. Each successor reclaimed its predecessor's staged generation before claiming a new one. The committed generation and its digest stayed unchanged throughout all three crashes; exactly the published and one staged generation existed. The successful recovery then left only one published generation, with no writer PID or staging pointer; corpus citations and source bytes remained unchanged. No cancellation-at-start shortcut was used for these crash probes.

During the observed interruption points, the whole database stayed at 11,821,056 bytes, note-owned pages grew from 9,953,280 to at most 10,133,504 bytes, and observed WAL grew from zero to 2,513,232 bytes. Free pages and WAL are reported separately. These are boundary snapshots, **not peak WAL/free-space measurements or proof of long-run bounded physical growth**. Atomic unpublished-generation retention is asserted; physical overhead is measured rather than hidden by vacuuming/checkpointing the test store.

The measurement assertions were then tightened after a bounded fixture review: the barrier is explicitly **before the 17th open** (16 completed source opens), incremental refresh must open exactly one source twice, its digest must change, and successful recovery/incremental publication must advance. First-query timing now stops before JSON parsing, matching warm-call timing. The tightened run (`/workspace/tmp/377-repeated-reviewed.log`) passed **6 tests / 134 assertions**. [Archived observations](../../runtime/test/fixtures/note-retrieval/release-results/repeated.json) include all 660 warm samples and crash boundary snapshots. Warm p95 across phases was **19.79–24.42 ms**; the first-phase values above are retained as history, not overwritten. Incremental source opens were exactly2; build/recovery exactly1032. Seven explicitly-unrecorded and two rejected-evidence quotes in secondary annotations were delivered in all phases; the remaining no-answer case has no such label. These secondary roles do not alter the original frozen relevance labels.

## Preserve failed/proposed gates

The original `runtime/test/fixtures/note-retrieval/budgets.json` file is not edited. Its thresholds were proposed for the earlier file-level search baseline, not accepted for this integrated tool.

- Proposed warm p95 **10 ms**: this query-call p95 exceeds it. Calls were not a five-repeat warm-only measurement, so do not replace the original assessor with this number; neither can it establish a pass.
- Proposed index/source ratio **2×**: note-owned pages exceed it at 2.27–2.44×.
- Proposed maximum query output **4 KiB**: observed max exceeds it. The implemented safety ceiling remains **16 KiB**, which every response respects.
- Existing safety: 20 chunk validation operations including parents, five query hits, 2-second cooperative query/get deadline, exact revision checks and fail-closed permissions remain unchanged. Runtime safety ceilings do not approve performance budgets.
- The old no-answer-hit and conflicting-path gates conflate retrieval exposure with wrong model answers. Do not silently relabel frozen runs; a useful note may say a fact was rejected/unrecorded. Future retrieval and answer-faithfulness gates need separate labels and explicit acceptance.

## Workload-specific budget disposition — accepted 29 September 2026

For the integrated query/get workload, Rui accepted **warm query p95 ≤50 ms**, **first query after process reopen ≤100 ms**, **note-owned allocated table/index pages ≤3× source bytes on the fixed 516-note fixture**, and **encoded query output ≤16 KiB**. The existing 30-second cooperative refresh ceiling and logical/source/access limits are unchanged. The historical 256 MiB RSS budget remains a proposal; the measured sampled peak was 166 MiB. The proposed 2-second small-initial-refresh target was not evaluated on this 516-note fixture and remains unapproved. The broader measurement task #1436 was triaged closed as not planned, subject to reopening for observed performance problems. Whole-database/WAL/free-page growth requires separate measurement. The accepted 3× ratio covers note-owned pages on this fixture only. The initial and repeated local samples fit the four accepted values, including three reopen processes and three controlled writer interruptions. Explicit budget acceptance was received on 29 September; the combined implementation had already passed final integrated validation on 28 September.

The accepted limits live in a separate versioned record; `budgets.json`, its thresholds and historical failures remain immutable history. Citation/admission checks require zero failures. Retrieval coverage and evidence-role relevance must be assessed separately from actual answer correctness; there is no proposed keyword-based abstention threshold.

## Final local validation receipt

The final combined `make ci-fast` run (`/workspace/tmp/377-integrated-final-ci.log`) completed **5,768 pass / 7 skip / 3 timeouts**. The failures were unchanged `operation-restart`, EF-S07 checkpoint and EF-S02 SQLite-adapter tests at their original 15s/5s/15s limits. All three complete test files were then rerun serially, with **no timeout overrides or file changes**: **69 pass / 0 fail / 1,276 assertions** (`/workspace/tmp/377-baseline-retries.log`). That supports a contention-sensitive failure classification but does not rewrite the first full-run result as green.

After the interruption, persisted logs showed the final holdout/source-safety/guidance tests had completed (**6 pass / 52 assertions**) and the remaining stages had not started. Typechecks, **25 feature tests / 204 assertions**, and **9 build-web tests / 26 assertions** were then run and passed. Typechecking retained 95 pre-existing frontend transitive diagnostics. The reviewed repeated-release test separately passed **6 / 134 assertions**. No live service, store or installation changed. Subsequent final combined-tree validation passed **5,793 runtime / 7 skip / 0 fail**, **25 feature** and **9 web-build** tests plus typechecks. Main `95498eaa0` was verified tree-identical to that tested integration (`2652a78a17119214f3383928dd0dbbc424a49e54`).

## Review findings and remaining closure work

A bounded independent review of note access/files found a same-inode growth race: `readNote` checked initial pathname size but allocated from the post-open descriptor size without reapplying the 512 KiB limit. Fixed before allocation and covered by a test requiring zero read calls and handle closure. A related post-opendir admission failure now closes its directory handle. Existing access identities/root bindings and source revisions were not relaxed.

A separate independent review of the admitted query found that parent rows were rechecked by ID but their adjacency selector was not repeated. A same-generation insertion of a second, non-FTS-matching parent could evade the candidate snapshot check after a later source read. The final validation now repeats every parent selector (including empty lookups) and rejects a changed row set. A deterministic two-source regression passes with the fix and fails when that final selector recheck is removed; read order is asserted so the insertion occurs after the original parent lookup.

The final contract audit also found the 20-candidate query could read 20 distinct files despite the accepted 16-file/8 MiB ceiling, and a 512-character query could exceed the accepted 1,024 UTF-8-byte input ceiling. Both limits are now explicitly enforced. A hooked file-open regression verifies exactly 16 source opens when more candidates exist; an oversized multibyte query returns `invalid_request`.

The [final role-aware holdout](local-note-final-holdout.md) records new-item retrieval coverage separately. First-release acceptance is recorded in the [closure receipt](../design/local-note-first-release-acceptance.md); effort/benefit triage closed speculative ranking/resource tasks #1434/#1436 as not planned and kept #1435 for label repair and a small answer/citation smoke test. Deterministic tests do not establish model-answer accuracy. No deployment/restart is authorised by this acceptance.
