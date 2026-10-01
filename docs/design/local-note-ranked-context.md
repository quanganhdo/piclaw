# Ranked local-note retrieval with separately cited parent context

`memory_query` combines bounded lexical and heading candidates before selecting results. It keeps the existing tool and exact `memory_get` references; there is no candidate-mode switch, confidence threshold, model reranker, new index schema or automatic prompt injection.

## Candidate selection

Ordinary queries become up to three FTS5 streams: all terms, any term, and heading-field terms. Explicit quoted phrases and structured identifiers constrain these streams and undergo a case-insensitive literal-boundary check; punctuation variants and ID suffixes cannot substitute for a literal anchor. Explicit FTS boolean, field and grouping expressions remain one unchanged stream. Invalid explicit syntax never falls back to broader search. Natural-language preparation accepts up to 32 distinct non-stopword terms within the existing 512-character input bound.

Each stream selects at most 71 rows (50 maximum offset + 20 validation slots + an overflow sentinel). The fixed pool does not change with offset. At most 213 row candidates are inspected, deduplicated by chunk ID and re-scored under the common lexical MATCH expression; BM25 scores from different expressions are never compared directly. FTS content weight is 1, heading weight 2, metadata columns 0. Rank ordinary queries by matched distinct terms, heading terms, common BM25 and stable binary path/byte/ID ties. These integer signals are explanatory lexical counts, not semantic confidence. Explicit FTS queries retain their BM25 ordering.

Source validation still permits at most 20 chunk validation operations, including parent chunks, and five delivered hits. Source reads remain grouped by path. A saturated stream/pool or validation budget reports `partial` with `validation_budget`; it never widens work silently. The 16 KiB entire encoded response and 2-second cooperative deadline are unchanged. The SQL row-selection cap is not a hard bound on SQLite MATCH work over its bounded index. No blanket recency preference or synonym dictionary is used; historical evidence is not silently dropped.

## Parent context and citations

After verifying the selected full-source digest, leaf byte range and stored bytes, the admitted closure may look up a chunk ending exactly at the leaf start. Only a heading-only, strict ancestry-prefix chunk qualifies. It verifies the original ID, source revision, complete-line bounds and bytes and emits that chunk's **own** reference in `context`. It can traverse up to three such contiguous ancestors, with 1 KiB combined parent text per hit and the same shared 20-validation budget. Parent prose, ambiguous duplicate rows, unrelated headings or separated headings are not silently joined.

The leaf `chunk_id`, range and snippet remain unchanged. Each parent supplies its own `chunk_id`, `source_revision`, path, full byte/line bounds, heading path, text and index generation; `memory_get` resolves each independently. This is source evidence, not invented heading text derived from metadata. All inspected parent rows are checked again before return, and the existing source, session, database, dirty-state and namespace checks apply to the combined output. A publication that prunes the old generation yields an empty `partial/refresh_pending`, not index corruption.

The pre-existing pure `assembleNoteContext` helper is unchanged. It remains scoped to supplied chunk bounds. This change performs parent lookup only through the private admitted tool closure, never by widening that pure helper's authority or exposing another reader.

## Regression evidence and limits

On the consulted synthetic `independent-v3` regression corpus, snippets alone contain all frozen labelled spans for 11/12 answerable questions; parent context plus snippet contains them for **12/12**. The earlier strict baseline delivered 2/12. Every emitted leaf and parent resolves byte-exactly through `memory_get`. Ordered source text, byte ranges, revisions and lexical signals match across forward/reverse rebuilds and after adding 500 neutral files (516 files total). Raw BM25 magnitudes and their serialized byte count can change with corpus size; the scale check excludes only elapsed time and envelope byte count and still enforces the 16 KiB ceiling.

All ten questions labelled with no affirmative answer still have hits, and five historical/conflicting-path hits remain visible. This is **not** an answer-accuracy or abstention improvement claim. Contradicted or unrecorded facts may be useful evidence; the answering agent still must inspect citations rather than assert an answer from hit existence. Both temporal conflict queries are partial when the validation budget is exhausted. The corpus is consulted regression data, not untouched evaluation; no labels or diagnostic rules have changed, and no new #1346 quality/resource threshold is approved here. The small neutral-file scale probe does not establish real-world latency/RSS/index-growth budgets.

Tests cover natural/explicit FTS preparation, exact ID and punctuation decoys, heading ranking, BOM/CRLF references, Setext blank-line/indent exclusions, leaf/parent get round-trip, corrupt/stale/mutated parent data, publication pruning, and all prior query/get admission and cancellation regressions. No production installation or restart is part of this work.
