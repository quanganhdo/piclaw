# ADR: Earendil-aligned agent harness integration

Status: **Released Pi 1.0.3 source retarget authorised after timeline/audit integration, with the shipped MCP wrapper retained. Prior Pi 1.0.1 installation is a separate operational receipt; no new deployment. Pi-durable stays out of scope.**

Rui approved this future service-plane design on 3 October 2026 and explicitly kept pi-durable work out of the current scope. The active track is integrating released Pi 1.0.3, upstream `d78dc83d633229d12f8b79631384c4c2717c399f`, with the standard MCP wrapper shipped by Piclaw. Native parity and wrapper removal are future scope, not prerequisites. The [1.0.0 architecture and 45-row HC/PC crosswalk](evidence/earendil-100-durable-crosswalk.md) defines the approved future durable design at its recorded target; it does not qualify pi-durable 1.0.1. It supersedes the old lane/Drive/Gate design for that separate, excluded work. Current-loop migration [#1497](https://github.com/rcarmo/piclaw/pull/1497) merged independently at `5cc738d7c`; neither that merge nor this assessment deploys or activates pi-durable. Original chapters and versioned evidence retain their historical API assumptions and results.

## Pi 1.0.3 target — 5 October 2026

The [1.0.3 integration record](../../development/pi-103-integration.md) contains fresh package/auth/SDK evidence and fail-closed Azure provider-rename guidance. The [current acceptance checkpoint](evidence/earendil-103-remaining-acceptance.md) records merged source fixes, approved synthetic VM canary/quarantine evidence and unfinished production Delegate/live-rollout decisions. Historical 1.0.2 receipts remain unchanged. Smith installation/restart and live account/server tests remain separate.

## Pi 1.0.2 target — historical, 5 October 2026

Rui authorised retargeting and source updates. The [integration record](../../development/pi-102-integration.md) contains fresh 1.0.2 package, SDK, wrapper, sampling and synthetic auth evidence. Historical 1.0.1 receipts remain unchanged. Source qualification does not authorise installation, restart or real-account testing. The unreleased OAuth cancellation fix after the 1.0.2 tag is excluded.

The [Pi 1.0.2 acceptance checkpoint](evidence/earendil-102-remaining-acceptance.md) records merged Settings, exact qualification, retained-wrapper checks, disposable rollback and unfinished production Delegate/live rollout gates.

## Pi 1.0.1 checkpoint — historical, 4 October 2026

[Source migration #1537](https://github.com/rcarmo/piclaw/pull/1537) merged at `98eb5ff4d8f1c833d42ce693c1bdce5530ad7d23`. The authorised Smith install/restart was verified on 4 October: Piclaw 3.2.5 / Pi 1.0.1, canonical Bun, HTTP 200 and preserved configuration/database identity. Later source changes are not installed by that operational receipt.

Subsequent qualified source tranches include CLI/package coherence [#1539](https://github.com/rcarmo/piclaw/pull/1539), adapter codemode controls [#1540](https://github.com/rcarmo/piclaw/pull/1540), public adapter shutdown acknowledgement consumption [#1541](https://github.com/rcarmo/piclaw/pull/1541) and pin/queued-input admission [#1542](https://github.com/rcarmo/piclaw/pull/1542). See the [migration](../../development/pi-101-migration.md), [coherence](../../development/pi-101-upgrade-coherence.md) and [shutdown consumer](../../development/mcp-public-shutdown-consumer.md) qualification records.

[Delegate #172](https://github.com/rcarmo/piclaw-addons/pull/172) adds fresh synthetic Pi 1.0.1 provider/private-pipe evidence. Subsequent [request ledger #1544](https://github.com/rcarmo/piclaw/pull/1544), [inactive parent host #1546](https://github.com/rcarmo/piclaw/pull/1546) and [shared request boundary #1547](https://github.com/rcarmo/piclaw/pull/1547) are merged and qualified as source foundations. They do not activate a production provider host. The [remaining acceptance matrix](evidence/earendil-101-remaining-acceptance.md) records current MCP/auth gaps, including the public settlement contract request [Pi #10461](https://github.com/earendil-works/pi/issues/10461). Production credential/environment, selected-engine, budget and cancellation acceptance are incomplete. Native MCP replacement/Apply has ten public capability/auth gaps plus a separate failed-teardown blocker. Adapter/Auto remains the default; unsupported Native configurations fail closed. Combined qualification and a separately authorised live canary are still required for parent #1442 acceptance. Pi-durable work is excluded.

Versioned 0.99.1/1.0.0 receipts and the approved 1.0.0 durable crosswalk remain unchanged. The [evidence register](evidence/README.md) separates current exact-target receipts from historical assessments.

## Decision record

| Field | Value |
|---|---|
| Decision owner | Rui Carmo |
| Assessment baseline | Piclaw `v2.13.2` |
| Baseline commit | `0afd3ae645c423bed82deef80c343bcaa6f31d4d` |
| Earendil runtime selection | Exact released Pi `1.0.3`, gitHead `d78dc83d633229d12f8b79631384c4c2717c399f`, for integration with the retained MCP wrapper. Previous #1537/1.0.1 installation and #1497/1.0.0 migration remain historical receipts. |
| Earendil released evidence | Versioned 0.84–1.0.0 receipts remain historical. #1452/#1453 are completed 0.99.1 assessments; no historical result is relabelled as 1.0.1. Current-loop and durable qualification are separate. |
| Earendil planning tip | `main` at `e4c75a73222ae2c72abb5f5314fa35ee8effc508`; historical planning evidence only, superseded for release-candidate assessment by published 0.87.0 |
| Historical implementation capture | `dev` / draft #8963 at `d14d6b22327d545d6a253f932165b63e48d7f9c8`; spec blob `c7c18c74730d4971f8ca004924e44c7fbe236f25`, SHA-256 `1b200eb7b4255d5afd71e17bb4cf54f82e2c5d1d1e24ae87ba97363838251785` |
| Evidence timestamps | Original capture: 2026-09-01 18:30 UTC; 0.85.1 follow-up: 2026-09-17–18; 0.87.0 candidate assessment: 2026-09-21; observations apply only to their recorded revisions |
| Document state | #1493 maps 25 HC and 20 PC intents to pi-durable 1.0.0. Source contracts and the prior paused Memory probe are distinct; #1494 owns fresh semantics/storage qualification. |
| Production changes | Source dependencies select 1.0.3. Approved synthetic VM rollout/canary/quarantine is separately recorded; Smith's prior installed-runtime receipt is 1.0.1. New Smith installation/restart and live calls need separate approval. No Native replacement or durable activation is introduced. |
| Final decision | Design approved by Rui on 3 October 2026. Pi-durable qualification, implementation and activation are out of scope; resuming that work requires a separate scope decision. |

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

The original assessment produced this ADR, evidence tables and a proposed semantic suite. Its 0.84.4 scaffold, earlier `dev` observations and 0.85–0.99.1 lane APIs remain historical. Pi-durable 1.0.0 exports stores and functioning bounded watches; these do not establish backend parity, host ownership or crash recovery. It has no public lane Drive or `Gate.admit()`. No production persistence is migrated here.

## Published 0.85.1 admission follow-up

[Package admission and corrected catalogue evidence](evidence/earendil-0851-admission.md) supersedes the old requirement that pi-server become transitive. Fresh supported root imports pass in Bun and real Node, including the minimum declared Node version. The 0.85.1 loop migration was subsequently superseded; Harness activation remains a separate approval. Historical negative evidence below is preserved.

## Chapters and evidence

- [Pi 1.0.1 source migration](../../development/pi-101-migration.md) — current-loop target and separate acceptance gates
- [Pi 1.0.1 receipts](evidence/README.md#selected-pi-101) — fresh package/provider/MCP qualification, with scope limits

- [Pi 1.0.0 durable architecture, authority and complete HC/PC crosswalk](evidence/earendil-100-durable-crosswalk.md) — approved future design; work out of scope, no activation
- [Pi 1.0.0 current-loop migration](evidence/earendil-100-current-loop-progress.md) — independent merged migration

- [Assessment method and quality bar](01-assessment-method.md)
- [Bug and regression corpus](02-regression-corpus.md)
- [Target architecture and replay model](03-target-architecture.md)
- [Direct Earendil adoption and selected-version fixture](04-earendil-adoption.md)
- [Alternatives and migration](05-alternatives-and-migration.md)
- [Acceptance plan and open questions](06-acceptance-plan.md)
- [Published 0.85.1 A/B/C/D work sequence](evidence/earendil-0851-work-sequence.md)
- [Current-loop migration readiness and receipts](evidence/earendil-0851-readiness.md)
- [Broader inactive HC evidence](evidence/earendil-0851-hc-evidence.md)
- [Published 0.87.0 stable Harness candidate evidence](evidence/earendil-0870-harness-candidate.md)
- [Published 0.87.0 experimental Pico3 assessment](evidence/earendil-0870-pico3-assessment.md)
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

## Approved design, deferred work

The [pi-durable 1.0.0 design](evidence/earendil-100-durable-crosswalk.md) is approved for reference; no durable work enters the active mainline-adoption track:

- Piclaw retains EF-S01/02/05/07/08 acceptance, source order, exact cancellation, atomic terminal settlement, frontier, delivery and projection fences.
- Durable tasks, submissions, entries and documents own execution after host authorisation. No lane/Drive/Gate or immutable usage-row equivalence is assumed.
- Paused recovery remains effect-denied until every resumable subtree is authorised. Progress calls can start recovered work; bounded watches supply observations only.
- Current production orchestration is not imported into the replacement path. Execution uses public package contracts; Piclaw ports retain service-plane responsibilities.
- #1494 records future Bun-only storage/semantics qualification. It is deferred outside the active scope and does not block mainline adoption. Historical 0.99.1 receipts remain separate. No durable implementation, activation or deployment is authorised.

Design approval does not authorise starting M1 or #1494. Rui must separately bring pi-durable work back into scope before it resumes. The original [effector specifications](evidence/future-effector-specifications.md) retain service invariants, but their legacy execution correlations need the versioned migration identified in the crosswalk.
