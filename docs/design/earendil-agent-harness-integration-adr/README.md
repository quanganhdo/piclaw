# ADR: Earendil-aligned agent harness integration

Status: **Harness architecture proposed; released 0.85.1 current-loop migration in draft review**

This ADR proposes a future service-plane coordinator around Earendil Harness. The original assessment changed documentation only. The separately authorised 0.85.1 work updates Piclaw's existing coding-agent loop and inactive compatibility evidence; it does not activate this proposed replacement architecture. See the [A/B/C/D work sequence](evidence/earendil-0851-work-sequence.md).

## Decision record

| Field | Value |
|---|---|
| Decision owner | Rui Carmo |
| Assessment baseline | Piclaw `v2.13.2` |
| Baseline commit | `0afd3ae645c423bed82deef80c343bcaa6f31d4d` |
| Earendil runtime selection | Production remains exact `0.84.4`; draft PR B selects exact published `0.85.1` for the existing loop |
| Earendil released evidence | 0.85.1 at `d981de1229ef899957bbe968bc8dcda02a21f477`; supported root imports and selected public compatibility are validated, Harness activation is absent |
| Earendil planning tip | `main` at `e4c75a73222ae2c72abb5f5314fa35ee8effc508`; separate planning evidence only, no tip-only APIs admitted |
| Historical implementation capture | `dev` / draft #8963 at `d14d6b22327d545d6a253f932165b63e48d7f9c8`; spec blob `c7c18c74730d4971f8ca004924e44c7fbe236f25`, SHA-256 `1b200eb7b4255d5afd71e17bb4cf54f82e2c5d1d1e24ae87ba97363838251785` |
| Evidence timestamps | Original capture: 2026-09-01 18:30 UTC; release-pinned follow-up: 2026-09-17; observations apply only to their recorded revisions |
| Document state | A admission; B current-loop migration/basic evidence; C broader inactive HC completion; D later-release reassessment. Canary and architecture approvals remain explicit |
| Production changes | Current-loop dependencies select `0.84.4`; no Harness activation, execution-path or service change |
| Final decision | Proposed: select direct Earendil adoption with a selected-version test implementation first |

## Problem

Piclaw has an agentic loop spread across channel handlers, queues, the agent pool, SDK callbacks, compaction and recovery helpers, scheduler delivery, SQLite state and web status handling. Earendil's agent harness is the intended execution plane once Piclaw selects a version with an implemented public surface.

The integration needs a state-machine runner that:

- imports none of Piclaw's existing orchestration or state-machine implementation;
- reuses Piclaw code only through reviewed effector ports;
- records deterministic inputs, transitions, commands and results for replay;
- supports new states, events, effects and recovery behaviour without cross-cutting edits;
- adopts Earendil's public structure, terminology and lifecycle contracts as early as the available APIs permit.

The assessment must preserve existing behaviour deliberately and carry known defects into the design as regression requirements. It must not treat the existing loop as the target architecture.

## Scope

The assessment covers the complete lifecycle of agent work:

1. input acceptance and ordering;
2. operation and session ownership;
3. prompt, model and tool execution;
4. compaction and recovery;
5. cancellation and late results;
6. terminal persistence and queue advancement;
7. restart reconciliation;
8. scheduled agent work;
9. SSE and web status projection;
10. extension and add-on integration points.

The original assessment produced this ADR, evidence tables and a proposed semantic suite. Its 0.84.4 scaffold and earlier `dev` observations remain historical. Published 0.85.1 now supplies the public constructor, Context/tool and lane APIs used by the draft migration evidence. Session watch remains a concrete stub; raw Storage exports, broader HC completion and activation approvals remain separate gates. This ADR does not activate a production runner, migrate persistence or deploy a service.

## Published 0.85.1 admission follow-up

[Package admission and corrected catalogue evidence](evidence/earendil-0851-admission.md) supersedes the old requirement that pi-server become transitive. Fresh supported root imports pass in Bun and real Node, including the minimum declared Node version. Production pins remain 0.84.4; Harness activation is a separate approval. Historical negative evidence below is preserved.

## Chapters and evidence

- [Assessment method and quality bar](01-assessment-method.md)
- [Bug and regression corpus](02-regression-corpus.md)
- [Target architecture and replay model](03-target-architecture.md)
- [Direct Earendil adoption and selected-version fixture](04-earendil-adoption.md)
- [Alternatives and migration](05-alternatives-and-migration.md)
- [Acceptance plan and open questions](06-acceptance-plan.md)
- [Published 0.85.1 A/B/C/D work sequence](evidence/earendil-0851-work-sequence.md)
- [Current candidate readiness](evidence/earendil-0851-readiness.md)
- [Canary procedure](evidence/earendil-0851-canary.md) and [executed piclaw-test receipt](evidence/earendil-0851-canary-result.md)
- [Evidence register](evidence/README.md)
  - [Piclaw v2.13.2 capability matrix](evidence/current-capability-matrix.md)
  - [Agent lifecycle regression corpus](evidence/regression-corpus.md)
  - [Piclaw effector inventory](evidence/effector-inventory.md)
  - [Future effector specifications](evidence/future-effector-specifications.md)
  - [Earendil-native effector contracts](evidence/earendil-native-effector-contracts.md)
  - [Tool, environment and resource migration](evidence/tool-resource-migration.md)
  - [Earendil 0.84.1 adoption constraints](evidence/earendil-0.84.1-constraints.md)
  - [Earendil Harness v3 assessment](evidence/earendil-harness-v3-assessment.md)
  - [Earendil version-selection policy](evidence/earendil-version-selection.md)
  - [Direct Earendil type audit](evidence/direct-type-audit.md)
  - [Target state, event and settlement model](evidence/target-state-model.md)
  - [Selected-version fixture and semantic contract suite](evidence/earendil-version-fixture-contract.md)
  - [Alternatives, migration and rollback](evidence/alternatives-and-migration.md)
  - [Capability and regression traceability](evidence/traceability-matrix.md)
  - [Assessment quality review](evidence/quality-review.md)
  - [Earendil 0.84.1 harness surface](evidence/earendil-0.84.1-harness-surface.md)

The index is the ADR decision record. Chapters hold the assessment and design analysis. The evidence directory holds registers, captures and replayable scenario descriptions. All files remain part of one ADR.

## Proposed decision

Select the direct-adoption architecture in [`evidence/alternatives-and-migration.md`](evidence/alternatives-and-migration.md), starting with a selected-version test implementation:

- Piclaw retains authenticated acceptance, canonical source order, operation identity, exact cancellation, timeline/media persistence, scheduler/delivery policy, terminal disposition, frontier and restart reconciliation.
- Earendil owns transcript execution, model/tool lifecycle, execution compaction and execution recovery. Harness v3's entries, typed values/lists, immutable operation results and usage ledger are the proposed execution model; 0.84 captures remain historical, and 0.85.1 supplies the selected inactive compatibility surface. The old `dev`/PR #8963 capture is not the current candidate.
- Piclaw imports no current agent orchestration into the replacement path. Piclaw service actions use reviewed service-plane ports; execution uses Earendil's exported lower-level harness/session/model/tool/environment contracts directly, never private coding-agent factories.
- One semantic suite runs against deterministic gated fixtures and a selected real constructor. It covers explicit Context propagation, one lane-owned Drive, `Gate.admit()` ordering, unknown effect outcomes, tool invocation identity, selected storage migration, host ownership and backend conformance. Piclaw updates its latent boundaries when Earendil types change; backward source compatibility is not a goal.
- Production remains on the current Piclaw loop with Earendil `0.84.4` until the separate 0.85.1 candidate passes merge/deployment gates. PR C's broader inactive HC work is release-pinned; PR D reassesses later releases. No exact-`dev` adoption is part of B.

Rui's architecture approval is required before M1 or production Harness implementation. Existing current-loop migration authorisation does not grant that approval. [`evidence/future-effector-specifications.md`](evidence/future-effector-specifications.md) is a documentation-only specification of contracts, fakes and later implementation slices; its TypeScript blocks are illustrative.
