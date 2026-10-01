# Local-note epic acceptance audit

**Accepted for the first release on 29 September 2026.** Rui approved the recommended workload limits and scoped closure disposition. The [first-release acceptance receipt](local-note-first-release-acceptance.md) supersedes the pending decisions below without rewriting historical results; the receipt also records follow-up triage: #1434/#1436 closed as not planned, #1435 retained with narrower scope. Installation/restart remains separate.

This audit originally recorded implemented behaviour and pending gates for #1347. Passing tests alone did not approve a budget or establish model-answer accuracy. It covers the combined #1431/#1432 work; #1427 preserves historical evidence.

## #387 query/get delivery

| Requirement | Implementation evidence |
|---|---|
| Explicit availability and single-user admission | `memory-search.ts` registered closures capture session/chat binding, validate active grants and note-index access before selectors; `memory-query.test.ts` / `memory-get.test.ts` admission and mid-read revocation scenarios |
| Bounded references, heading, lines, revision and snippet | Query returns verified leaf and separately verified parent references; `rank-context` resolves every reference with `memory_get`; BOM/CRLF and byte-boundary helpers tested in `ranking.test.ts` |
| Exact revision; no stale redirection | Same-metadata edits, deletion, links, corruption, replacement database, mode changes and cancellation regressions; source bytes rehashed on each file read |
| No arbitrary path selector or raw no-identity reader | Only query/limit/offset and chunk-ID/revision schemas; private admitted read path; early-denial parameter-proxy tests |
| Limits and current publication checks | Five hits, encoded output cap, 20 chunk validations including parents, 16 file attempts/8 MiB, 1,024 UTF-8 input bytes; publication-pruning and parent-selector snapshot regressions |
| Preserve generic search and startup maps | Guidance tests assert independent bootstrap/search entrypoints; no preflight hook, new provider call or tool-default expansion |

Final source review found and fixed the post-open size race, post-opendir cleanup, parent selector race and missing file/UTF-8 input bounds. The fixes reached main at `95498eaa0` with a full passing integrated validation; #387 was closed on 28 September 2026. It should not remain open solely because #390 ranking work or production deployment is incomplete.

## #377 workflow and release checks

- Tool-local guidance specifies query → exact get → cited answer, supported/contradicted/unrecorded/not-found distinctions, and untrusted note handling. Registration tests verify guidance remains opt-in with no retrieval bootstrap hook.
- `docs/local-note-recall.md` documents stale/error semantics, source/index ownership, refresh coordination, trusted recovery, operator enablement and non-destructive rollback.
- `release-workflow.test.ts` measures 516 admitted normal files in the same store across build, three reopens, three real writer interruptions/recovery and incremental refresh. It verifies corpus reference stability, get round trips, warm-response stability, publication advance and dirty-file-only read counts.
- `files-limits.test.ts` and the query worker cover independent-review findings. Frozen evidence-role annotations are added separately from original relevance labels; no deterministic test is called model-answer accuracy.
- Final combined CI passed 5,793 runtime tests, 25 feature tests and 9 web-build tests. Rui's 29 September acceptance dispositions the resource/quality gates for v1, with deferred items explicitly tracked. Installation/restart is not part of that source-level gate and has not been authorised here.

## #390 ranking and #1346 evaluation

Implemented: bounded lexical/heading streams, common-query BM25, exact phrase/structured-ID constraints, deterministic rank-before-top-five, and separately cited contiguous parent headings. No rejected candidate-mode API, arbitrary answerability threshold, embedding dependency or compulsory model call. No blanket recency preference. Consulted regression data show 12/12 labelled spans delivered with cited parent context; this is not a fresh held-out result.

Historical pending items, dispositioned by the first-release acceptance:

1. Workload-specific limits are now explicitly accepted in `accepted-release-budgets.json`. Original proposals remain unchanged and their overruns remain recorded. The accepted limits apply only to the documented fixture/workload.
2. Keep retrieval relevance and evidence-role usefulness distinct from response faithfulness. A note that records rejection/absence is potentially useful; nonempty hits do not measure hallucination. The new role annotations are consulted regression labels, not retrospective changes to frozen ground truth.
3. Additional ranking ablations and temporal-intent work was recorded in #1434, then triaged closed as not planned unless a reproducible user-facing failure justifies it. No automatic date preference or claim of chronology understanding is implemented. Current lexical/heading retrieval preserves conflicts for caller assessment.
4. Final role-aware fixture frozen at `96be3e301` before queries: 13 new notes/24 questions, drafted in a delegate context without implementation or prior corpus access. [First-run evidence](../performance/local-note-final-holdout.md): 11/12 supported quotes delivered in query+context and12/12 after get,4/4 contradicted and4/4 unrecorded quotes,137 exact reference round-trips. All4 originally absent-labelled questions still have lexical hits; independent review found Q23 explicitly unrecorded and Q24 ambiguous/intentional omission, so that group is not a valid absence-quality gate. Frozen labels/results remain unchanged with the defect documented. No answer model was run. Keep this evidence separate from consulted regression sets; do not retune on it.
5. Report representative resource measurements separately from logical ceilings; three interrupted-refresh snapshots are not a long-run physical DB/WAL growth bound. The repeated-run release report lists exactly what was measured.

Code/evidence PRs #1427/#1431/#1432 are merged; the final receipt records acceptance and the remaining scope disposition. Close first-release children and epic after that receipt merges. #1435 remains a small non-blocking follow-up; #1434/#1436 record work declined on effort/benefit grounds. No tables, notes, live sessions or runtime installation need to be reset.
