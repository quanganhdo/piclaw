# First-release acceptance: bounded local-note retrieval

Rui accepted the first release on **29 September 2026 at 08:30 UTC**, following the recommendation to accept the workload-specific limits, finish the child-issue audit and explicitly defer remaining temporal/ablation work. This accepts the merged implementation at `95498eaa0b4168c6888389f9955f00aec6e9d010`. It does not authorise installation, restart, a public tagged release or a real-workspace smoke test.

## Accepted scope and limits

Single-user, embedding-free `memory_query` → exact `memory_get` → cited evidence; bounded heading-aware ranking; separately referenced parent context; checked source revisions, access and cancellation; background-index recovery; opt-in guidance without automatic preflight. Family capability expansion and mandatory model calls remain excluded.

The [machine-readable acceptance record](../../runtime/test/fixtures/note-retrieval/accepted-release-budgets.json) defines these workload-specific limits:

| Metric | Accepted limit | Recorded evidence |
|---|---:|---:|
| Warm query p95 | 50 ms | 19.79–24.42 ms per phase |
| First query after process reopen | 100 ms | 11.32–13.75 ms across three reopens |
| Note-owned allocated index/source ratio | 3× on fixed 516-note workload | 2.27–2.46× |
| Entire encoded query response | 16 KiB | at most 6,387 bytes |

The 30-second cooperative refresh ceiling and zero tolerated citation/admission failures remain the existing safety contract. They are not new performance approvals. The sampled 166 MiB process-tree peak is below the historical **proposed**, not newly approved, 256 MiB RSS budget. The old proposed 2-second small-initial-refresh target is not evaluated by this 516-note fixture and remains an unapproved proposal. The resource research task #1436 was subsequently closed as not planned; the 30-second ceiling does not replace the small-fixture target.

The fixture contains 516 normal Markdown files totalling about 4.39 MB, six same-store phases, 660 warm query calls, three process reopens, three real writer SIGKILL/recovery cycles and incremental refresh. Index size excludes unrelated messages tables, free pages and WAL/SHM. The 3× limit is not a long-run physical-storage guarantee. Process-cold measurements do not flush the OS cache. These are bounded local-workload acceptance limits, not universal SLAs.

Original `budgets.json` and frozen policies/labels/results are unchanged. Their 10 ms / 2× / 4 KiB failures remain historical facts. First-release approval supersedes those unapproved proposals for this integrated workload; it does not convert earlier failed runs into passes.

## Child-issue disposition

| Issue | First-release acceptance |
|---|---|
| #1345 | Access/freshness/citation contract previously accepted and closed; no authority relaxation. |
| #376 | Versioned chunk index previously merged and closed; recovery and same-store behaviour rechecked. |
| #387 | Exact query/get delivery audited and closed after #1431/#1432 fixes. |
| #1346 | Corpus provenance, immutable old measurements, fresh holdout, resource measurements and this explicit budget decision accepted. Retrieval exposure is not model-answer accuracy. |
| #390 | Bounded lexical/heading streams, literal identifiers, common-expression BM25, rank-before-top-five and separately cited parent context accepted. No blanket recency policy or fusion dependency. Additional temporal rules, priors and feature ablations explicitly deferred to #1434. |
| #377 | Guidance, untrusted-reference handling, stale/no-match outcomes, recovery/rollback docs and integrated safety/lifecycle tests accepted. Deployment remains a separate operation. |
| #1347 | First-release scope accepted once this receipt is merged and issue/project states are updated. The follow-ups below do not block this accepted release. |

The merged tree equality is independently reproducible with `git rev-parse 95498eaa0^{tree} b29d9f4ac^{tree}`: both are `2652a78a17119214f3383928dd0dbbc424a49e54`. That integrated implementation recorded **5,793 runtime pass / 7 skip / 0 fail**, plus **25 feature** and **9 web-build** passes and all typechecks. The typecheck retained 95 pre-existing frontend transitive diagnostics. Earlier timeout runs are retained, not described as green. The acceptance-record change is documentation, data and regression checks only; it does not modify runtime source.

## Quality evidence and explicit limitations

The [archived repeated measurements](../../runtime/test/fixtures/note-retrieval/release-results/repeated.json) and [holdout result](../../runtime/test/fixtures/note-retrieval/final-holdout/result.json) contain log SHA-256 provenance and the detailed observations tested by `accepted-release-budgets.test.ts`. The fresh final role-aware fixture was frozen before retrieval. It delivered supporting quotes for **11/12** questions in query/context and **12/12** via get; contradicted and explicitly-unrecorded evidence each scored **4/4**. All **137** emitted leaf/parent references round-tripped exactly. This is retrieval evidence coverage, not generated-answer correctness or semantic abstention.

Independent review identified absent-label defects in Q23/Q24. Those labels/results remain frozen and are not counted as passed absence tests. Retrieving a rejection or a statement that information is unrecorded can support correct uncertainty; any-hit rates do not measure hallucination. The existing answering agent must check citations, distinguish temporal/conflicting evidence and not assert unsupported facts.

## Follow-up triage — 29 September 2026

Rui requested an effort/benefit decision for each follow-up after accepting v1.

| Issue | Decision | Effort and expected benefit |
|---|---|---|
| #1434 — temporal ranking and ablations | Closed as not planned | Substantial experimentation without a demonstrated user-facing defect. Reopen for a reproducible ranking or current/historical failure; v1 does not implement temporal reasoning. |
| #1435 — labels and answer/citation smoke test | Keep open, narrowed | Small label repair plus a focused smoke test address known gaps. Preserve Q23/Q24 history, add separate corrections and inspect a few answer/citation examples after separately authorised deployment. No benchmark framework or extra runtime model calls. |
| #1436 — broader resource measurements | Closed as not planned | A long-running benchmark has limited immediate benefit over the accepted fixture and recovery checks. Reopen for observed storage growth, latency regression or a materially larger workload. No long-run storage guarantee is added. |

No follow-up edits historical evidence or retroactively improves its scores. Existing access, source-byte, query-validation and output safety ceilings remain unchanged. Installation and a real-workspace smoke test require a separate deployment instruction.
