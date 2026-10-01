# Independent evaluation of strict and candidate note queries

**Decision: neither mode passes the predeclared diagnostic gate. Do not make candidate mode the default or deploy it as an answer-quality fix.** This evaluation ran unchanged registered `memory_query` and `memory_get` tools from stacked PR #1428 against a newly authored, separately frozen fictional corpus. It measured text delivered to the agent, not file rank or model answer accuracy.

## Consolidation and interpretation correction

PR #1429 is closed into evidence-only #1427; #1428 is rejected, and its API is not included in this branch. The frozen corpus and policy below are unchanged. [`historical-result.json`](../../runtime/test/fixtures/note-retrieval/independent-v3/historical-result.json) preserves the original per-query output with commit/log provenance. On main, `independent-evaluation.test.ts` reruns the **current default implementation** and checks the archived strict/candidate observations separately. Current runs may legitimately report `partial/validation_budget` under stricter parent-context work accounting; they are not relabelled as the historical strict baseline. Reproduce both original modes from evaluation commit `7dd541306` if needed.

The original gate conflated search results with answers. `field-negatives.md` says that the mesh trial was cancelled, the battery chemistry is unstated, and no mass was measured. Such passages can be useful negative evidence. Therefore 10/10 no-answer-hit exposure does **not** mean 10/10 wrong answers. Five conflicting-path hits do not prove five incorrectly resolved conflicts. No answering model was run. The original gate failure and counts remain recorded; neither mode is now relabelled as a pass. Reject #1428's extra API/OR-only design, not the general use of broader candidate generation. See the [next implementation decision](local-note-retrieval-next-step.md).

## Freeze and method

- The corpus, labels and scoring rule were committed at `923698539` **before either tool was invoked**. `runtime/test/fixtures/note-retrieval/independent-v3/manifest.json` fixes SHA-256 hashes for 16 Markdown notes, one evaluation file (12 answerable and 10 no-answer queries) and `policy.json`. The worker verifies every hash and labelled source quote before indexing.
- The rule requires ≥80% of answerable questions to return every labelled quote contiguously in a source-verified snippet at the right path, ≤20% of no-answer questions to return any hit, zero conflicting-path hits, 100% reference round-trips and responses ≤16 KiB. This is a **predeclared diagnostic rule**, not an approved #1346 production budget.
- An isolated writer publishes a note generation in a disposable SQLite store. A fresh SQLite reader verifies that publication. The registered `memory_query` executes with `limit: 5` in default strict and explicit candidate mode; every returned `{chunk_id, source_revision}` is passed to `memory_get` and checked against the same path and snippet. No provider calls, live notes or Smith store are involved.
- The test repeats the run in fresh stores with forward, forward again and reverse file-creation order. It compares the reported per-query measurements (coverage, hit counts, status/reasons and response byte count), excluding wall-clock elapsed time. These measurements were identical in all three runs. The worker does **not** retain full ordered hit payloads, so this is not proof of byte-identical hit text or ordering across builds. Nor does it test a same-store process restart, network filesystem, or a 512-file scale case.

## Results

| Measure | Strict default | Explicit candidate | Predeclared diagnostic rule |
|---|---:|---:|---:|
| Answerable questions with all labelled text in returned snippets | **2/12 (16.7%)** | **11/12 (91.7%)** | ≥80% |
| No-answer questions with any returned hit | **4/10 (40%)** | **10/10 (100%)** | ≤20% |
| Conflicting-path hits | **0** | **5** | 0 |
| Exact query→get reference round-trips | All returned hits | All returned hits | 100% |
| Maximum encoded response | 1,552 bytes | 3,528 bytes | ≤16,384 bytes |
| Largest observed per-query time, tiny local corpus | 20 ms | 32 ms | Recorded only; no approved latency cap |
| Stable per-query measurements on forward/repeat/reverse builds | Yes | Yes | Yes |
| Diagnostic gate | **Fail** (coverage, no-answer hits) | **Fail** (no-answer and conflicts) | All rows required |

All 44 query calls per build reported `status: ok` with no incomplete reasons because the indexed synthetic snapshot was clean; `ok` means source/index validation, not answer validity. The candidate mode found 11/12 labelled answer spans and returned hits for **every** no-answer query. Whether each hit was useful negative evidence or irrelevant requires separate evidence-role annotation. The failed repeated-heading quote includes a parent `##` heading outside the indexed leaf chunk, even though leaf text and heading metadata can contain the answer and entity. The pure context assembler preserves that chunk boundary; it cannot add the parent heading without a separately cited context change. Five hits came from paths labelled as conflicting with the question. These are exposures, not proven incorrect model answers.

The 16-note corpus is synthetic and small. Its facts and identifiers are new, but its question categories deliberately mirror earlier hard-v2 cases, and the same evaluator authored its labels and scoring rule. This is a fresh **item-level** test, not an independent task distribution or third-party blinded assessment. It does not estimate real-world answer accuracy, semantic abstention or a production p95. The earlier hard-v2 set was used to select the candidate mode and cannot serve as a fresh item-level check. The archived run used unchanged runtime code, thresholds, labels and queries. The consolidated test reruns the current default implementation using `bun run test:controlled -- runtime/test/note-retrieval/independent-evaluation.test.ts` and prints `INDEPENDENT_EVALUATION=`. The candidate observations are archived rather than reimplemented here.

## Recommendation

- Close #1428, retain the strict baseline until the replacement is tested, and keep existing citation safeguards. The standalone OR mode does not address entity scope, ranking before top-k or parent context.
- Under #1346, retain this failed historical rule but replace the proposed **future** answer-quality gate with separate retrieval-relevance and answer-faithfulness measures. Do not tune a keyword cutoff to suppress useful negative evidence.
- Under #390, implement bounded lexical/heading candidate union and cited parent context. Under #377, the existing answering agent must distinguish supported, contradicted and unrecorded facts. No new mandatory model call or automatic preflight is introduced.
