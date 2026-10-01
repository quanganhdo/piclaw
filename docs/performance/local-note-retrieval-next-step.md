# Note retrieval: decision and next implementation

Keep the exact-reference query/get safety work already on main. Close the experimental PR stack and improve the existing query path; do not ship another search-mode switch or a lexical answerability threshold.

## PR disposition

| PR | Decision | Reason |
|---|---|---|
| #1422 | Close; preserve branch/results | Small-corpus lexical rejection did not generalise. |
| #1423 | Close; preserve branch/results | Context expansion was useful; proximity/anchor aggregate gains were not established. Do not merge the research index or rejection policy. |
| #1427 | Keep as the sole evidence-only PR against main | Retain hard-v2 and independent-v3 fixtures, baseline runner, original observations and corrected interpretation. No runtime change. |
| #1428 | Close; preserve branch/results | An opt-in OR mode plus warning is not the needed ranking/context improvement. |
| #1429 | Close as consolidated into #1427 | Preserve original results without making rejected runtime code a merge dependency. |

The numbers remain: strict delivered full labelled spans for 2/12 new-item queries; candidate for 11/12. Hits on questions labelled no-answer were 4/10 and 10/10; candidate exposed five conflicting-path hits. These are retrieval observations. The evaluator produced no answers and cannot measure hallucination or correct abstention. See [original evaluation and correction](local-note-independent-evaluation.md). Corpus labels and original failed decision rule remain immutable history, not silently relaxed acceptance criteria.

## Implement next: heading-aware retrieval and cited context (#390)

1. Keep `memory_get`, all admission/freshness checks, deterministic ordering, the 20-source-candidate validation cap, five delivered results, 16 KiB output and cooperative deadline. No schema or chunk-ID change just to inflate an evaluation score.
2. Use a bounded union of lexical BM25 candidates and heading/exact-entity candidates. Treat explicitly quoted phrases and identifiers as constraints; do not AND every incidental word of a natural-language question. Preserve explicit FTS boolean semantics. Rank the union before top-five packing, with deterministic ties and observable lexical/heading signals, not a semantic confidence score. Any increased SQL candidate work needs a finite documented bound and measurement.
3. Include the relevant ancestor heading and adjoining paragraph only from the verified source revision. Obtain the actual adjacent chunk references and validate them through the same private admitted path; return parent/context citations separately. Never extend bytes while pretending they belong to the original leaf `chunk_id`. If the extra evidence cannot fit existing caps, omit it with the existing partial/limit semantics.
4. Keep historical and current evidence distinguishable. Honour explicit temporal intent; do not apply a blanket recency bias or suppress contradictory evidence just because it hurts a hit-count metric.

First regressions: repeated headings across entities; parent/leaf boundaries; exact IDs with punctuation decoys; current versus historical questions; changed parent source revisions; candidate saturation and deterministic top-k. Reuse all query/get access, dirty-generation, cancellation and corrupt-row tests. Measure corpus-level recall@5, relevant evidence rank, delivered fact plus entity context, irrelevant-hit rate, bytes and latency separately from contiguous full-quote delivery.

## Answer verification belongs to the existing agent (#377)

The normal query → get → answer turn must distinguish **supported**, **contradicted/rejected**, **explicitly unrecorded**, and **not found in retrieved material**. Every asserted fact needs supporting cited bytes. A note saying a trial was cancelled supports rejection of a presumed deployment; it should not be hidden to make search appear to abstain. A missing search hit does not prove a missing fact.

Add separate evidence-role annotations without rewriting frozen labels. Judge actual agent responses for unsupported assertions, contradiction handling and correct uncertainty, rather than penalising every nonempty negative-query result. Deterministic CI checks citation/state contracts; real answer-quality assessment requires recorded or separately authorised model outputs. There is no extra per-query model, automatic preflight, or model reranker in #390.

## Other techniques

- **Use now:** fielded BM25, exact entity constraints, rank-before-top-k and separately cited parent context. These target observed failure modes without a new service.
- **Not now:** another OR-mode API, arbitrary term-coverage cutoff, or hand-written synonym/negation list. None establishes answerability.
- **Only if measured residual failures justify it:** local dense retrieval alongside BM25, fused with reciprocal-rank fusion. Embeddings can recover paraphrases but cannot establish whether a fact is missing, negated or about the wrong entity. Adding a model/runtime dependency needs separate scope and resource review.
- **Defer cross-encoder/entailment reranking:** it adds latency and model dependencies and conflicts with #390's current no-model-reranker scope. First measure what the existing answering agent gets wrong with adequate cited evidence.

The consulted sets are now regression sets, not untouched held-out evidence. Freeze implementation choices before any later final evaluation on independently authored new items. Numerical deployment thresholds remain unapproved; this cleanup neither widens access nor deploys code.
