# Local note retrieval: lifecycle, limits and test map

Status: decisions accepted by Rui on 21 September 2026 for [#1345](https://github.com/rcarmo/piclaw/issues/1345).
Read with the [access and citation contract](local-note-retrieval-contract.md).
No row below means the future note-retrieval implementation already exists.

## Proposed resource ceilings

These are conservative first-release ceilings, not benchmark results. #1346 must measure representative small/large corpora and set release latency, relevance and context-efficiency targets. A change to a ceiling needs an explicit contract/test update before implementation approval.

| Resource | Proposed bound | Rejection/degradation rule |
| --- | --- | --- |
| Source file | 512 KiB of original UTF-8 bytes | Exclude file; remove existing derived rows on an authoritative observation, report partial coverage |
| Chunk | 16 KiB, complete source lines | Split prose at safe boundaries; if a single line/fenced block cannot fit, exclude the whole file with a bounded reason; no partial semantic coverage disguised as a complete file |
| Chunks per file | 128 | Exclude whole file if exceeded; deterministic diagnostic |
| Eligible files / accepted source bytes per complete scan | 2,000 files / 32 MiB | Stop staging, no deletion sweep; status partial/limited, prior verified rows remain usable subject to source validation |
| Directory entries / depth | 20,000 entries / 16 levels below `notes/` | Same scan-limit outcome; do not traverse rejected subtrees |
| Current-generation chunks | 16,384 per namespace | Reject over-budget generation/transaction; no arbitrary first-N publication |
| Derived note content bytes | 32 MiB per published generation and 32 MiB for its one allowed staged successor; maximum 64 MiB across both | Sum of stored chunk UTF-8 bytes; each generation also obeys the source/chunk ceilings. Metadata/FTS, WAL/journal and free-page overhead are measured separately by #1346 |
| Persisted unpublished generations | At most one for the coordinator-owned note store, including failed, cancelled, superseded and crash-left staging | Reclaim abandoned staging before allocating a successor; cleanup failure blocks new staging, preserving the published generation |
| Peak owned staging content | 64 MiB | Bound retained decoded bytes/buffers; no unbounded full-corpus copies in JS. Physical RSS is measured separately, not guaranteed by this logical bound |
| Refresh elapsed work | 30 seconds, cooperative checks between I/O/chunk batches | Cancel remaining work, preserve committed consistency and report incomplete scan; cannot pre-empt blocked kernel I/O |
| Reconciliation eligibility interval | 5 minutes while active | Existing coordinator schedules overdue work; not a wall-clock freshness guarantee |
| Query string | 1,024 UTF-8 bytes | `invalid_request`; syntax preparation must not expand work without limit |
| Query results | Default 5, maximum 20 | Enforce independently of caller settings |
| Candidate validation | At most 50 chunks from 16 distinct files; at most 8 MiB total file bytes read per request | Omit unvalidated candidates, report partial/validation budget; stable selection order |
| Query snippets | Up to 1 KiB of snippet text each; total encoded response maximum 32 KiB | Account for JSON escaping and metadata before returning a row; never cut UTF-8 or misstate line ranges |
| Get response | One chunk up to 16 KiB; total encoded response maximum 32 KiB | `limit_exceeded` if a valid full response cannot fit; no silent truncation |
| Query/get elapsed work | 2 seconds, cooperative deadline and cancellation | Safe `limit_exceeded`/`cancelled`, or bounded partial query where allowed; no assumption a synchronous SQLite/kernel call is forcibly pre-empted |
| Diagnostic entries | At most 20 per response; fixed reason codes and counters | No unbounded path lists, SQL errors, source text, credentials or absolute paths in logs/errors |

All file bytes needed to validate a chunk count against the request budget, even if the chunk is small. Group validation by source path to avoid re-reading the same file for each hit. Default result counts are not relevance confidence. No model, embedding runtime or network request is needed.

A complete scan that cannot fit the global chunk/content ceiling is not published as a complete new generation. #376 must use bounded SQL/disk staging or bounded batches without exposing an arbitrary prefix as the new complete index. Deletion/pruning requires a successfully enumerated scope; exceeding a walk/time limit never proves missing files were deleted.

## Proposed data ownership

Use [owned migrations](../../runtime/src/db/migrations.ts) with a distinct owner such as `note-retrieval`, a checksum-pinned migration sequence and dedicated tables. Final names belong to #376; logical records are:

- Namespace: opaque ID, format/chunker version, trusted root binding, current published generation and state.
- Source: namespace + normalised path, source revision, original byte length, current chunk generation, validation metadata and dirty generation.
- Chunk: stable content-bound ID, source link, exact byte/line range, heading path/kind and indexable text.
- FTS: text and searchable metadata keyed to live chunks; cannot independently authorise or return orphan records.
- Refresh state: monotonic scope dirty generation, per-file dirty generations, coverage state/version, last complete reconciliation, safe exclusions and bounded status/error codes. Every known admitted-path change advances the scope generation even when no current query candidate names that path.

Do not store credentials or conversation history in these tables. Do not import the legacy single-user file index into a family store, or read `family_workspace_*` as a fallback. A new namespace can rebuild from admitted Markdown without an in-place legacy content migration. Search ranking and note-kind heuristics cannot alter source authority.

## State machine

| State | Query/get behaviour | Transition |
| --- | --- | --- |
| `never_indexed` | `index_unavailable`; request initial refresh | Eligible coordinator work → `indexing` |
| `ready` | Search committed rows; validate source per returned file; completeness is scoped to the last complete scan | Known write or overdue reconciliation → `stale` before query response |
| `stale` | Query outcome `partial` even with zero hits; exclude known dirty files and validate other rows | Coalesced refresh → `indexing` |
| `indexing` | A compatible prior committed generation may serve verified rows, labelled refresh pending | Successful complete publish → `ready`; incomplete work → `stale` or `limited` |
| `limited` | Only verified prior/accepted rows with explicit partial coverage; no definitive empty-success | Operator/source reduction then successful refresh → `ready` |
| `failed` | Database/namespace/schema corruption → `index_unavailable`; no LIKE/global-index escape | Explicit owned-index rebuild after diagnosis |

Recoverable single-file I/O failures do not corrupt unrelated rows. Mark that file unavailable/dirty, withhold its hits, preserve the previously committed content only as unserved derived data, and report partial coverage. A permanently inadmissible observed file (invalid encoding, forbidden link, over-limit content) has its derived rows removed atomically; the source file is untouched. Its reason is recorded within diagnostic limits.

No process-local active flag may keep the index permanently stuck after an error. Persisted in-progress markers from a stopped process are recovery hints. At startup, take the note-store writer lock, identify abandoned staging and delete its owned source/chunk/FTS/status rows in a cleanup transaction before allocating another generation. Perform the same cleanup on cancellation, failure and supersession; failure to clean up leaves the phase failed/stale and prohibits new staging. A live writer cannot be classified as abandoned merely because it is slow. Preserve the published generation and unrelated owners' data throughout. There is no automatic destructive database repair.

Publication atomically switches the live pointer and removes the previous generation's owned rows in the same transaction. Readers already holding the old snapshot may finish only within the existing query deadline and authority checks, with final published-generation revalidation forcing partial status or a bounded retry; no previous generation is retained as a rollback archive. Across namespace rebuilds or format changes, the same single-staging slot applies, and abandoned namespaces cannot bypass it. A crash before commit leaves the old publication plus at most one recoverable staged successor; a crash after commit leaves the new publication.

The generation/content limits bound logically retained derived rows, not the size of the entire shared SQLite file. Deleted pages may be reused rather than returned to the filesystem. #1346 must measure peak database/WAL size during repeated interrupted rebuilds; #376 must ensure closed readers, reuse/checkpoint through the existing database owner, and bounded cleanup progress without deleting or vacuuming the shared message store as a repair shortcut. Repeated interruption cannot allocate additional staging generations while an abandoned one remains.

## Write/read ordering

1. Capture and validate access, trusted root/database binding, namespace, scope dirty generation, coverage-state version and last-complete timestamp; capture per-file dirty generations where applicable. Validate caller request before filesystem work.
2. Safely open and read a bounded regular source, hash original bytes, record identity, and derive complete-line chunks under the pinned chunker version. Check authority/cancellation between operations.
3. Before publishing, recheck named-source identity and open-handle stability. Re-read/hash if metadata is insufficient to establish that the staged bytes still match; abort on observed change. No filesystem lock spans arbitrary external editors, so fresh reads at query/get are still required.
4. Enter one immediate SQLite transaction for that file. Revalidate authority/database/namespace and compare the captured dirty/source generation. Another refresh/known write wins by causing this attempt to reject, not overwrite.
5. Replace the file's metadata, chunks and FTS rows, update current source generation and consume only the dirty generation satisfied by this read. Validate budgets before writes; any failure rolls back all writes for this file.
6. Complete-scan status and deletion sweep publish only after bounded enumeration completes and its start/end scope dirty generation reconciles. Missed/new writes keep the scope stale. Rebuild uses the sole owned staging slot and atomically switches its pointer while deleting obsolete owned rows; queries never mix old/new rows during switch. Enforce the cleanup/retention policy above before another rebuild is admitted.
7. On read, select from one committed generation, open admitted source files and validate their revisions, then recheck namespace/authority and relevant per-file generations. Before delivery, also compare the captured scope dirty generation, coverage-state version and published-generation pointer against current committed state outside the earlier query read snapshot, and recompute reconciliation age, including for zero candidates. A known write to a newly created or non-candidate path cannot escape this check. Scope/state/published-generation changes or becoming overdue yield query `partial` with `refresh_pending`; at most one bounded retry may select and validate anew. A per-file change discards affected text and adds query reason `source_stale`. Mixed valid/stale candidates return only valid hits as `partial`; all-stale candidates return empty `partial`. Get returns `source_stale` with no text for a stale reference. Namespace/authority loss or corruption discards all output. No awaited I/O follows final classification. Do not reread arbitrary replacement passages to salvage a stale reference.

Per-file atomicity permits different unchanged files to have different last-refresh times. A query generation describes a coherent database view, not proof that the whole filesystem existed in that state at one instant. A refresh cancellation observed before the transaction's commit aborts it; cancellation after commit cannot undo that committed generation. Suppress further work and response delivery when cancellation is observed, and settle/clean up resources. Report a cancellation/commit boundary without falsely asserting that no write occurred. A query/get cancellation is separate from an already enqueued shared background refresh: it suppresses that request's response but does not cancel coordinator work shared with other callers.

## Refresh triggers and recovery

| Trigger | Required handling |
| --- | --- |
| Runtime startup | Validate namespace binding; reclaim abandoned staging under the writer lock before any new staging; enqueue initial or overdue reconciliation using the existing index coordinator |
| Workspace editor/upload/move/delete | Existing mutation hook marks both affected old/new note paths dirty; coalesce work |
| Agent `write`/`edit` | Connect their actual completed-mutation path where available; never infer a successful write from tool intent or arguments alone |
| Shell or external editor | No reliable universal notification; eligibility interval and bounded full hash reconciliation discover changes |
| Dream completion | Existing post-Dream refresh also covers the new chunk phase; do not add another Dream model turn |
| Query/get detects changed source | Withhold mismatching text; mark affected file dirty and request background reconciliation; no inline full scan |
| Wake/resume | Overdue reconciliation becomes eligible; return honest age/partial status until complete |
| Authority/root change | Stop pending work and deny old handles; do not start a different profile through fallback |
| Schema version change / explicit rebuild | Apply owned migrations to derived tables only; create/publish a new namespace; old references return `not_found` |

Existing [startup](../../runtime/src/runtime/startup.ts) launches the current index worker. [The launcher](../../runtime/src/workspace-index-process.ts) suppresses launches while its status is ready and does not supply an interval-based reconciliation guarantee. #376 must integrate the eligibility check into this coordinator. Query admission evaluates last-complete age before response classification; it cannot leave an overdue query marked complete while merely queueing a refresh. No existing five-minute scheduler is claimed.

Mtime/size shortcuts remain valid for current file-search behaviour, but are insufficient for new freshness claims. A no-change reconciliation must detect same-size content edits even when mtime is restored. Query validation bounds how much source is re-read; it cannot discover a new matching file absent from the index.

Rollback disables registration of the new tools and leaves old file search/bootstrap unchanged. A later reader cannot load a newer incompatible note namespace. Rebuild removes only tables/generations owned by note retrieval, within the migration/rebuild contract; never delete `messages.db`, source notes, user records, family ledgers or another extension's data. Faults, interruption and existing backups must have explicit restore tests before #376 is merged.

## Required implementation tests

Every `NR-*` row below is **planned** for #376/#387/#377; none is certified by this docs-only change. All fixtures use isolated workspaces/databases and no live user notes, credentials or provider calls.

| ID | Scenario and exact invariant | Owner / existing starting point |
| --- | --- | --- |
| NR-A01 | Single-user admitted model/default-owner and registered legacy tool execute closures only; raw no-identity caller cannot read notes; only the coordinator operation with expected-mode and newly implemented parent-captured root/database validation may write, with no alternate raw writer/HTTP route; missing/stale/malformed family identity cannot select notes | #376/#387; `core/workspace-index-access.ts`, `extensions/user-memory-bootstrap.test.ts` |
| NR-A02 | Family model/browser/admin and isolated/invalid modes deny new APIs before inspecting argument proxies or opening SQL/files | #376/#387; `family-workspace-index.test.ts` |
| NR-A03 | Child rejects mismatched parent-captured workspace/store/data/database binding before opening the note store; mode/workspace/store/database/identity changes across awaits or immediately before commit/return deny, with sticky revocation and no failure-status write under replacement authority | #376/#387; family index/bootstrap tests |
| NR-A04 | Cross-namespace chunk ID, absolute/traversal/backslash path, links/hardlinks and root/ancestor swaps cannot expand the admitted corpus | #376/#387; family index filesystem tests |
| NR-C01 | Heading ancestry, repeated headings, LF/CRLF/BOM, Unicode and final newline map exact original byte/line ranges; fences remain intact | #376; new parser fixtures |
| NR-C02 | Unchanged file within namespace has stable IDs; any byte edit invalidates all old file references; path rename/move does not redirect; deletion/recreation rules match contract | #376/#387 |
| NR-C03 | Get of stale/missing/foreign/malformed references yields the specified safe outcome and no substituted note text; query mixed/all-stale candidates yield `partial` plus `source_stale`, never get-only top-level outcomes | #387 |
| NR-C04 | Mid-read edit, same-size preserved-mtime edit, replacement after open and edit after query before get are detected at defined read boundaries; stale query text is withheld while unrelated verified hits remain partial | #376/#387 |
| NR-C05 | New revision, rebuild/format namespace switch and backup restore do not resurrect mismatched citations; equal digest plus active chunker version preserves the indexed chunk-policy decision without query/get re-chunking; malformed stored ranges/IDs fail; old matching-byte IDs have the documented semantics | #376/#387 |
| NR-I01 | Fault after each SQL metadata/chunk/FTS mutation rolls back one source atomically; no orphan FTS result can return text | #376; owned migration + family generation tests |
| NR-I02 | Two refreshes/notifications race; stale generation cannot commit over newer change, including separate DB connections/processes | #376 |
| NR-I03 | Scan failure/limit/cancellation does not run incomplete deletion sweep or mark full ready; successful deletion prunes exact source | #376 |
| NR-I04 | UI/agent/Dream dirty triggers coalesce; shell/external changes appear through bounded hash reconciliation; ready status does not suppress overdue work; mutation after query candidate selection advances the scope generation even for a new/non-candidate path | #376; workspace/index process tests |
| NR-I05 | Repeated crashes/cancellation/failure/supersession retain at most one unpublished staging generation; startup reclaims it before a successor; injected cleanup failure blocks allocation; atomic pointer switch deletes old owned rows; namespace changes obey the same cap; compatible published data survives and notes/messages/family/other owners' tables are untouched | #376 |
| NR-L01 | Each resource ceiling at limit and one over, including combined published/staged content and one staging slot; repeated aborted rebuilds cannot accumulate derived rows, and peak DB/WAL/free-page behaviour is measured; zero unbounded metadata/JSON escaping; no split multibyte character or partial fenced-block masquerading as complete content | #376/#387 |
| NR-L02 | Cancellation before/after publication boundary; request abort suppresses its response without cancelling already enqueued shared coordinator refresh; cancelled worker settles without undoing prior commit, no leftover active guard/handles/child process | #376/#387 |
| NR-Q01 | Stable query order/candidate budget, multiple hits from one file, partial/empty/unavailable distinctions including a zero-hit query or new non-candidate file dirtied after selection, coverage-state/published-generation changes (including a separate-connection commit hidden from the earlier read snapshot) and becoming overdue during validation; backwards-clock ages stay partial; mixed/all-stale candidates follow the fixed reason taxonomy; retry at most once within original budgets; no corruption fallback to legacy or wider corpus | #387/#390 |
| NR-Q02 | Returned title/path/heading/snippet and score signals are source data; hostile content cannot select roots, tools or identities and never enters logs as instructions | #387/#377 |
| NR-R01 | Baseline/held-out retrieval and citation budgets frozen by #1346; same corpus, warm/cold latency, returned context and index cost reported separately | #390/#377 |
| NR-R02 | Existing file search, Dream refresh and startup maps preserve their current compatibility; no new family activation, automatic preflight or provider call | #377 |

## Historical validation of existing behaviour

At source baseline `0ea661493`, the following isolated command passed **48 tests / 0 failures / 284 assertions**:

```sh
bun run test:local --cwd runtime --env PICLAW_DB_IN_MEMORY=1 -- bun test \
  test/workspace-search.test.ts \
  test/extensions/extensions-workspace-search.test.ts \
  test/workspace-index-process.test.ts \
  test/family-workspace-index.test.ts \
  test/extensions/user-memory-bootstrap.test.ts
```

It checks existing file-search lifecycle, tool output, background refresh, family index separation and bootstrap authority. Separate `test/db/access-state.test.ts` and `test/db/storage-architecture.test.ts` runs passed 6/24 and 6/15 tests/assertions respectively. Total present-behaviour evidence: **60 tests, 323 assertions, no failures**. The access tests cover promotion/mode mismatch rejection; migration tests cover owner isolation, checksums and transaction rollback. None implements or proves the `NR-*` future retrieval cases. Documentation validation checks local links, the 20 decision/test IDs, code references and docs-only diff scope. No new test with hard-coded document hashes is needed.

Repository gate at the original documentation candidate `b9eaca418`: `make ci-fast` passed **5,413 runtime tests / 4 skips / 0 failures**, **25 feature tests**, and **9 web-build tests**. The builds produced no tracked runtime changes. The environment-surface check needed one generated inventory entry for this document's existing test-command variable; production readers are unchanged.

## Fixed-head review findings addressed

The four findings on `b9eaca418` are addressed in this docs-only revision:

| Finding | Revised rule | Required regression coverage |
| --- | --- | --- |
| Dirty non-candidate/new path or zero-hit query could escape completeness classification | Capture and compare scope dirty generation and coverage-state version at delivery; recompute age; downgrade to partial or retry once within the original budgets | NR-Q01, NR-I04 |
| Stale query candidates had no defined mixed/all-stale outcome | Get-only top-level `source_stale`; query `partial` plus reason `source_stale`, preserving only verified hits and allowing an empty partial result | NR-C03, NR-C04, NR-Q01 |
| Interrupted staging could accumulate persisted generations | One unpublished staging slot across namespace rebuilds; 64 MiB combined published/staged logical content; reclaim abandoned staging before new work and refuse allocation when cleanup fails | NR-I05, NR-L01 |
| Existing worker root checks were overstated | Existing code checks expected mode and a mode/workspace/identity snapshot; parent-captured store/data/root/database validation is new #376 work | NR-A01, NR-A03 |

Revision review is a local source/contract consistency check, not a claim that an
independent reviewer has approved the amendment or that the future tests pass.
The seven existing behaviour suites were rerun against merged `7a38db66a`:
**60 tests / 323 assertions / zero failures**. The source files supporting the
worker/access/search baseline did not change between the original and rechecked
baselines. Planned retrieval tests remain unimplemented.

The amended docs candidate on that baseline passed `make ci-fast`: **5,508 runtime
tests / 4 skips / zero failures**, **25 feature tests** and **9 web-build tests**.
All four configured typechecks and the environment-surface check passed. A local
document check resolved **59 links**, verified **20 unique planned NR IDs**, checked
table/fence structure and confirmed the four-file documentation scope. Builds
left no tracked application changes. These are compatibility/document checks,
not execution of the future retrieval contract.

## Issue #1345 acceptance coverage

| Required decision | Contract section / planned tests |
| --- | --- |
| Mode/actor/root matrix; no family model expansion | Access matrix; NR-A01–A03 |
| Trusted roots, containment, identity and revalidation | Roots/filesystem admission; NR-A01–A04 |
| Chunk identity, revisions, edit/duplicate/move/delete semantics | Byte/chunk identity; NR-C01–C05 |
| Stale/missing/moved lookup outcomes | Query/get outcome table; NR-C02–C05, NR-Q01 |
| Source/derived separation, transactions, corruption/upgrade recovery | Data ownership, state machine and write ordering; NR-I01–I05 |
| UI/agent/shell/external/Dream freshness without second worker | Refresh triggers; NR-I04, NR-R02 |
| Finite file/chunk/query/output limits | Resource ceilings; NR-L01–L02 |
| Untrusted reference text without authority | Access and result boundary; NR-Q02, NR-R02 |

## Accepted prerequisite decisions

Rui accepted the explained contract on 21 September 2026. The checkmarks below
record design acceptance, not execution of the planned implementation tests.

- [x] Mode/actor/root table and stricter single-user identity admission.
- [x] File-wide byte revision, exact source ranges and opaque namespace-bound IDs, including conservative invalidation after unrelated file edits.
- [x] Excluded direct path/range lookup, per-file stale/no-content behaviour and partial-query taxonomy.
- [x] Initial resource ceilings, with measured tuning reserved for #1346.
- [x] Owned schema/atomic publication, filesystem-race limits, rollback and no capability expansion.
- [x] Every #1345 criterion mapped to decision sections and planned tests. Contract acceptance does not close downstream implementation tickets.
