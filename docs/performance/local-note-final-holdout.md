# Final role-aware note-retrieval holdout

The frozen final fixture delivered exact labelled evidence for **11/12 supported questions in query text and 12/12 after `memory_get`**, plus **4/4 contradicted and 4/4 explicitly unrecorded cases** in both. Every one of 137 returned leaf/parent references round-tripped. This measures retrieval evidence, not generated-answer correctness.

## Provenance and freeze

A delegate context with no implementation, previous-corpus or result files was asked to author fictional software configuration, household, dietary, finance, backup and decision notes. The delegate timed out after writing a complete JSON file, so it supplied fixture authorship but **no review approval**. Parent validation corrected three spaces to exact existing source newlines in Q13/Q19/Q20 and corrected the provenance date before any tool query. No note content or expected role was changed. The resulting 13 notes and 24 queries (12 supported, 4 contradicted, 4 unrecorded, 4 absent) were committed at `96be3e301` before the first retrieval run.

Corpus SHA-256: `d4509978fced1ff363738d62439f62ceeb2e56517f2d8227314eadcccd5ee185`. `runtime/test/fixtures/note-retrieval/final-holdout/freeze.json` pins the hash, source head `a9750151a`, five-hit and 16 KiB bounds. One note is 8,988 bytes of normal short lines and multiple topics. All evidence quotes are exact contiguous source substrings. All data are fictional; no live notes, network or provider calls are used in evaluation.

The unchanged registered tools ran in a disposable indexed workspace. Every query result and fetched chunk is archived in [`result.json`](../../runtime/test/fixtures/note-retrieval/final-holdout/result.json), with its original log hash. This first run was not used to retune the implementation.

## Results

| Expected role | Questions | Exact evidence in query + cited context | Exact evidence after get | Nonempty queries |
|---|---:|---:|---:|---:|
| Supported | 12 | 11 | 12 | 12 |
| Contradicted | 4 | 4 | 4 | 4 |
| Explicitly unrecorded | 4 | 4 | 4 | 4 |
| Absent | 4 | not labelled | not labelled | 4 |

Maximum query response was 5,579 encoded bytes; every returned reference resolved to the same path, revision and original line range, with each snippet contained in the fetched source and each parent text identical. Some queries reported `partial/validation_budget`; those are retained as incomplete retrieval, not counted as successful no-answer decisions.

The one query-text miss was `Q04-prune-after-copy`: “Skylark step required before pruning old snapshots.” The full selected chunk contained the labelled instruction but the 320-character snippet did not contain the complete quote. The query→get workflow recovered it without another search or guessed reference. This is why guidance requires exact get before answering.

All four absent questions returned lexical hits. A returned note is not a supported affirmative answer. `forbiddenClaims` in the fixture are retained for later answer assessment but **were not scored**, because no answer model ran. No hallucination rate, semantic abstention pass, or guarantee of user answer quality is claimed.

## Independent label-review findings

A bounded read-only review after evaluation found two role-label defects. Q23 (`household freezer make and model`) is labelled `absent`, but the source explicitly says “The appliance make and model are not documented here.” It belongs to explicitly unrecorded evidence. Q24 (`backup encryption passphrase value`) is not a clean absent case: the backup instructions say never to record secrets or recovery phrases, and the house manual states it contains no password. That case is ambiguous between intentional omission and absence. Neither is evidence that a passphrase should be exposed.

The original labels, hash and first-run results are **not changed** after observing these defects. The table reports original labels only. The four-case absent group is therefore **not suitable for an absent-query acceptance gate**; it needs separately reviewed replacement items before an absence-quality claim. This does not change the 12 supported questions, the original four contradicted/four unrecorded labelled quotes, or byte-exact reference verification. Runtime quote checks can validate source containment and schema consistency, not the correctness of a human-authored role.

## Reproduce and completion boundary

```sh
bun run test:controlled -- runtime/test/note-retrieval/final-holdout.test.ts
```

The test validates the frozen hash, allowed role/schema shape, evidence quote containment, admitted paths, bounded source/query output and all citation round-trips. It cannot prove that a role label is semantically correct. It reports role coverage without modifying the original labels or thresholds. This corpus is now consumed; future tuning must not call it untouched.

This supplied the fresh retrieval-evidence measurement. Rui accepted the bounded first release on 29 September 2026; see the [acceptance receipt](../design/local-note-first-release-acceptance.md). Q23/Q24 label repairs and actual answer-quality evaluation are explicit follow-up #1435, not retroactively passed gates. The first full local integrated run with these fixtures reported 5,768 pass, 7 skip and three unchanged database/operation timeouts; retain that failure. The subsequent exact combined tree passed 5,793 runtime tests, 25 feature tests and 9 web-build tests before merging. Acceptance authorises no deployment or restart.
