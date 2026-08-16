# Bug and regression corpus

The populated corpus is in [`evidence/regression-corpus.md`](evidence/regression-corpus.md). It currently maps 26 baseline, post-release and upstream-concurrency incidents to 15 invariants and named contract scenarios. The archives and upstream PRs remain evidence; their patches are not the target architecture.

Bugs form part of the behavioural specification. Each known incident must map to a target invariant and a regression scenario.

Each corpus entry records:

| Field | Required content |
|---|---|
| Bug ID | Stable ADR identifier and linked issue/PR where available |
| Triggering sequence | Ordered input, event and fault sequence |
| Incorrect behaviour | User-visible or persisted result |
| Violated invariant | Exact safety or liveness rule |
| Root cause | Established cause or `unknown` |
| Baseline status | Present, fixed, regressed, intermittent or not reproduced |
| Evidence | Test, trace, issue, PR, log or archive reference |
| Target prevention | Mechanism that makes the defect impossible or detectable |
| Contract scenario | Fixture/real-harness test that retains the lesson |

Sources to inspect include:

- existing regression tests;
- open and recently closed GitHub issues;
- relevant fix commits and PR descriptions;
- [`docs/archive/turn-mechanism-audit.md`](../../archive/turn-mechanism-audit.md);
- [`docs/design/agent-turn-state-machine-assessment.md`](../agent-turn-state-machine-assessment.md);
- the archive branch `archive/post-v2.13.2-fixes-20260810` at `da47ca62f3c1e7e0d5e538cc250303eb8c9ca1f4`;
- `/workspace/backups/piclaw-post-v2.13.2-fixes-20260810.bundle`;
- operational logs and reproducible runtime failures.

The earlier state-machine assessment is evidence about the current loop and its hazards. Its proposed incremental reuse does not satisfy this ADR's no-orchestration-reuse constraint and is not an accepted target design.

### Initial regression themes to verify

These are starting hypotheses, not yet completed corpus entries:

- accepted work fails to wake or becomes stranded;
- cursor/frontier advancement consumes work without a terminal response;
- a steer is lost, duplicated, reordered or attached to a successor;
- stale operation or generation context affects a replacement run;
- cancellation acts on the wrong operation or loses to a late result;
- terminal output and maintenance settle in the wrong order;
- checkpoint or continuation ownership is claimed twice;
- protected tool or scheduling evidence leaks to events or timelines;
- tool containment releases before accepted terminal settlement;
- SSE reconnection applies events from an old generation;
- mobile Abort lacks exact operation authority;
- scheduled agent output is delivered twice;
- restart reconciliation misstates pending, partial or terminal work.
