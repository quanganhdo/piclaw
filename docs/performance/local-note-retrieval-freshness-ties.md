# Content freshness and deterministic search ties

The index now detects file changes that preserve size and modification time. Equal-ranked search results sort by binary path, so rebuilding the index no longer changes tied-result pagination.

This is a bounded follow-up to the frozen baseline in #1367. The corpus, query inputs, relevance labels and proposed budgets are unchanged. False-positive thresholds and citation capabilities are outside this patch.

## Corrections

The single-user refresh formerly skipped a file whenever its rounded mtime and size matched `workspace_files`. It now reads the admitted file content and compares it with the existing FTS text before deciding to skip. Unchanged rows retain their FTS row ID and `indexed_at`; a missing FTS row is repaired even when its metadata row already exists.

Reads allocate at most the admitted file size plus one byte, within the existing configured file-size cap. The extra byte detects concurrent growth. File size, mtime, ctime, inode and device are checked across the read; a raced source is discarded. FTS and metadata replacement and deletion each run in one per-file transaction. An unreadable/racing source or failed database write rejects the refresh and marks its status failed, retaining the previous successful timestamp. A failed per-file transaction preserves the previous row; other files already committed in that refresh are not rolled back. This is not a snapshot of the entire workspace.

Directory-listing failures abort rather than presenting an empty subtree for deletion. Only an optional top-level root returning ENOENT is treated as absent; a nested directory disappearing during traversal fails. Cleanup considers both metadata and FTS paths, removes FTS-only orphans, and consolidates duplicate FTS rows even when one has current content.

Concurrent refreshes in the same process are rejected only when their resolved roots overlap or their scope keys are identical. Disjoint notes/skills/configured roots can refresh independently. No cross-process lock or generation-wide publication guarantee is added.

There is no schema migration or persistent hash backfill. FTS path is unindexed, so refresh resolves a path-to-rowid map once and reads existing content by rowid; it does not scan all FTS rows for every file.

Single-user and family BM25 queries now use `path COLLATE BINARY` as the secondary order. LIKE fallback uses the same path order. Operational FTS failures are reported instead of silently falling back; only FTS query-syntax errors may use LIKE. Query matching, ranking weights, limits and access scopes remain unchanged. Family indexing already reads a bounded content snapshot and needs no freshness change.

## Reproduction

Three new tests failed before the patch: same-size/same-mtime replacement, repairing metadata with no FTS row, and deterministic equal-score order. They pass after it. Additional tests cover atomic replacement, unchanged-write suppression, pagination in FTS/LIKE paths, racing growth/read limits, transaction rollback and family scope isolation. The existing mode-switch/revocation tests still pass.

The full frozen benchmark was replayed twice at each scale, including fresh-process reopen, before and after. Source hashes and the 24 query labels remain fixed. After correction:

- `sameMetadataEditDetected` is true on all four build runs; false on all four baseline runs.
- Equal-score ordering is `notes/tie-a.md`, `notes/tie-b.md` across independent rebuilds and repeated reads; baseline order varied.
- Held-out Recall@5 remains 1.00, precision remains 0.7333, and MRR remains 0.9333 at 12 files / 1.00 at 512 files.
- Held-out unanswerable false-positive rate remains 0.50. Citation correctness remains unsupported/null.

The runner now records the measured Git HEAD and whether tracked source was modified, alongside the historical production-baseline identifier. Each run uses unique temporary subdirectories, avoiding collisions when the harness runs twice in one isolated launcher. Existing baseline results/docs remain historical evidence; the active correctness assertion now requires freshness detection and stable ties.

## Measured cost

Same local isolated runner and synthetic corpus; two independent builds at each scale. Timings are observations, not production guarantees. No OS cache flush was performed.

- 512-file no-change refresh: **54–65ms before, 172–193ms after**. Content verification adds bounded reads; it does not reinsert unchanged text.
- 512-file initial refresh: **14.2–14.6s before, 7.6–8.1s after**. Per-file transactions reduce separate SQLite writes in this workload.
- 512-file one-file-edit refresh: **94–96ms before, 167–178ms after**.
- Warm query p95 stays below 1ms in every recorded run. Search does not read the filesystem unless refresh is requested.

An intermediate content check using `WHERE path = ?` for every unchanged FTS row took about 1.1s at 512 files. It was replaced by the rowid map before publication.

[Bounded before/after measurements](local-note-retrieval-freshness-ties-results.json) preserve quality, timings, storage and mutation results. No private notes, live database, provider calls or production refreshes were used.

## Validation and limits

The focused search/index/family/baseline suite passes **42 tests / 228 assertions**. It includes the real isolated baseline subprocesses and injected failures for reads, traversal, SQL updates/deletes, duplicates/orphans, overlap rejection and disjoint concurrent scopes. Four typechecks and scoped lint pass.

Final `make ci-fast` passes **5,541 runtime tests** (4 skipped), 25 feature tests and 9 build tests. Packaging hygiene, stale-bundle and environment-surface checks pass.

A delegated read-only judge review found silent refresh failure, non-atomic cleanup and duplicate-row retention. Its follow-up confirmed those corrections and identified an over-broad concurrency guard; the guard now compares actual roots, with a passing independent notes/skills regression.

This does not make lexical hits evidence that an answer exists. Reducing false positives needs a separately reviewed retrieval/ranking policy and held-out evaluation. Content can still change immediately after validation; the guarantee is detection during refresh, not live-file transactional locking or citable content versions. False positives, citation support and independent-process snapshot consistency are tracked in follow-up [#1370](https://github.com/rcarmo/piclaw/issues/1370), linked to the existing retrieval initiative.

No merge, installation or restart is included in this fix branch. The previously authorised reload was held while evaluating these corrections.
