# Acceptance plan and open questions

Full capability/regression/assumption coverage is recorded in [`evidence/traceability-matrix.md`](evidence/traceability-matrix.md): 59 capabilities, 26 regressions and 10 Earendil assumptions all map to owners, mechanisms and planned tests.

## Current PR boundaries

The [published 0.85.1 work sequence](evidence/earendil-0851-work-sequence.md) separates A admission, B atomic current-loop migration/basic positive compatibility, C broader inactive deterministic HC completion, and D later-release reassessment. B retains already-tested partial HC evidence; C owns the remaining broad completion effort. No physical split or branch-history rewrite is required.

An authorised disposable microVM upgrade/restart/rollback receipt is a prerequisite for B merge. No target, access, restart or provider authority is granted by this chapter. Whole-change rollback returns the exact baseline 0.84.4 runtime/dependency set; no production schema migration or session rewrite is intended.

The following full-architecture criteria remain separate from B's limited current-loop scope. None is marked complete by package import success or by scheduling PR C.

## ADR acceptance criteria

This ADR is complete only when it contains:

1. pinned Piclaw/released-Earendil baselines plus the selected published Harness target and separately labelled historical or unreleased planning evidence;
2. current architecture and responsibility map;
3. completed capability traceability matrix;
4. completed bug and regression corpus;
5. approved invariants;
6. Piclaw service state/event/command model aligned with Harness v3 execution/storage semantics;
7. Piclaw–Earendil ownership boundary;
8. reviewed effector inventory;
9. complete future-effector specifications with interfaces, current-internal adapter maps, independent fake oracles, fault cases, relative effort, dependency order and documentation work packages;
10. released Earendil API/source survey and Harness v3 design/type/runtime/backend status survey;
11. fixture design and assumption ledger, if needed;
12. Piclaw service replay plus Harness v3 deterministic gated-drive/instrumented-storage design;
13. operation `Gate.admit()`, one lane-owned Drive and effect-start uncertainty semantics;
14. bounded recovery queries, transaction/conformance, selected migration, host ownership and fork semantics;
15. failure, cancellation and restart semantics;
16. alternatives with evidence;
17. incremental migration sequence;
18. compatibility and rollback strategy;
19. contract and acceptance-test plan;
20. unresolved questions and Earendil dependencies;
21. traceability from every preserved capability and known bug to a target mechanism and test.

## Definition of done for the assessment

The assessment passes when:

- every agentic public entry point is accounted for;
- every durable lifecycle mutation has one target owner;
- every known bug maps to an invariant and regression scenario;
- every target responsibility has one owner;
- every Piclaw-owned future effector has a complete illustrative interface, bounded errors, idempotency rule, current-internal adapter source, independent fake and fault cases;
- every Earendil-owned boundary names direct selected-version contracts and prohibits duplicate Piclaw wrappers;
- the proposed machine runs without importing Piclaw orchestration;
- golden scenarios replay deterministically;
- effect-gate race tests prove both admission orders without claiming that a process-local gate closes the crash window;
- recovery uses selected public bounded reads and does not depend on private or v2-specific recovery queries;
- every selected backend passes upstream conformance plus open-operation migration and concurrent rewrite tests;
- the semantic suite runs against both the selected-version test implementation and real Earendil harness; source compatibility across Earendil upgrades is not required;
- every unsupported claim is marked as an assumption or unresolved question;
- implementation can be divided into reviewed, reversible increments;
- Rui approves the architecture before production implementation starts.

## Assessment work plan

### Phase 1: Pin evidence

- verify baseline package and installer pins;
- record repository, archive and bundle identities;
- identify available Earendil harness source or proposals;
- define evidence IDs and commands.

### Phase 2: Capture current behaviour

- enumerate all ingress paths and lifecycle owners;
- complete the capability matrix;
- map durable and volatile state;
- trace effect and terminal boundaries;
- rerun representative baseline tests without changing code.

### Phase 3: Build the regression corpus

- inspect issues, PRs, regression tests and archive history;
- reduce incidents to ordered scenarios;
- map each incident to an invariant;
- identify gaps requiring future contract fixtures.

### Phase 4: Survey Earendil

- inventory public and proposed harness structure;
- map Piclaw capabilities to Earendil concepts;
- record gaps and assumptions;
- decide whether a selected-version test implementation is required.

### Phase 5: Design and compare

- define state, events, commands and effector ports;
- assign ownership;
- specify replay, fault and restart semantics;
- compare alternatives;
- propose the migration and rollback sequence.

### Phase 6: Review the ADR

- check full capability and bug traceability;
- run an independent design review against the quality bar;
- resolve or label every open assumption;
- request Rui's architecture decision.

## Open questions

The assessment resolves ownership and design questions that can be answered from the current baseline. Remaining questions are implementation gates tied to selecting an Earendil source/version and deployment policy.

| Question | Current assessment position | Resolution gate |
|---|---|---|
| Which source/version is selected? | Production uses 0.84.4; draft B targets published 0.85.1 (`d981de1229ef899957bbe968bc8dcda02a21f477`) for the existing loop. Historical dev/#8963 is not the active candidate; pinned tip is planning-only. | Keep Harness disabled. B needs migration/public compatibility and authorised canary evidence; production Harness selection requires a separate ADR after broader C evidence. |
| How much Earendil type stability is required? | None across selected upgrades. Piclaw accepts source breakage and removes obsolete glue. | B compiles migrated direct contracts and runs bounded migration checks. C/full Harness promotion requires the applicable complete HC catalogue for the selected version; record migration differences without treating B's partial evidence as completion. |
| Does the release expose recoverable run state? | Published 0.85.1 exposes public operation state, lane watches and drive; B has bounded JSONL process-loss and restoration tests. Session watch remains a concrete stub. Historical v2 `findRecords()` proposals are not prerequisites. | Broader crash/retry/deferred/structural coverage belongs to C; preserve partial/unverified labels until executed. |
| Who owns tool process groups? | Harness v3 owns effect signals/tool invocation; Piclaw's `ExecutionEnv` implementation may retain host process tracking. | TP process-group and real-harness abort/close tests before M6. |
| Who owns transcript persistence? | Harness v3 owns entries, typed values/lists, immutable operation results and usage ledger; Piclaw owns accepted sources, timeline and service dispositions. | Selected backend/fork conformance and two-domain reconciliation tests. |
| Can the real Harness use deterministic fake models/tools? | Published 0.85.1 supports contextual tools, direct Models, invocation identity/memos and public drive; B uses the real constructor with public faux-provider fixtures. Built-in raw Storage fixture access is not exported. | C completes the broader deterministic HC suite through supported public APIs; no private Storage access. |
| Which Piclaw writes share one transaction? | EF-S01 atomically accepts/claims service work. EF-S02 separately performs one terminal transaction across disposition, terminal timeline/media binding, source disposal, frontier, owner release and outbox. Both use `messages.db`; Earendil sessions stay separate. | Future logical-schema review and EF-S01/EF-S02 contract fault suites. |
| Which modules qualify as effectors? | Classified in `evidence/effector-inventory.md`; nine implementable interfaces and their current-internal adapter sources are specified in `evidence/future-effector-specifications.md`; orchestration modules are rejected. | G-SHAPE, G-OWNER, G-CURRENT and per-interface contract review. |
| Which baseline behaviours are removed? | Cursor authority, deferred JSON queue, chat-scoped abort/provenance, Piclaw recovery/compaction loop and direct scheduler agent delivery are migration targets. User-visible capabilities remain unless separately approved. | M0 ADR decision and per-capability implementation issues. |
| What closes the effect-start crash window? | Nothing process-local can close it. `Gate.admit()` orders durable abort versus admission; durable intent and settlement bound an unknown-outcome interval. | HC-021/022 plus provider/tool/structural recovery tests before M4. |
| How is writable Session ownership fenced? | B validates public Memory/JSONL ownership and fork cases for the selected release. Earlier SQLite host-ownership captures remain historical; tip-only streaming-fork tests and incomplete SQLite parity are not release evidence. | C verifies broader host replacement/deletion/fork semantics. D reassesses later-release changes before any adoption. |
| What shadow/soak and resource budgets apply? | Metrics and gates are defined; numeric budgets need measured real-harness evidence. | Set numbers after M4 canary measurements and before M6/M7 approval. |
