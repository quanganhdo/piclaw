# Evidence register

## Selected Pi 1.0.3 integration

Released target: `d78dc83d633229d12f8b79631384c4c2717c399f`. Source retarget authorised after unified timeline/audit PR1557. Retain the shipped MCP wrapper; deployment/live accounts remain separately gated.

- [Integration and Azure migration](../../../development/pi-103-integration.md)
- [Current Pi 1.0.3 acceptance checkpoint](earendil-103-remaining-acceptance.md) — merged source and synthetic VM/rollback evidence; preserved failures and explicit public Delegate/live operational gates
- [Fresh-workspace add-on host peers](../../../development/pi-103-core-addon-peers.md) — offline seed import correction and preserved existing-workspace semantics; guarded seven-entry import and frozen-source evidence, no deployment or Delegate activation
- [Synthetic VM canary and private-config correction](../../../development/pi-103-vm-canary.md) — corrected 30-minute Classic window / 59 cycles, bounded both-skin/MCP/scheduler/family checks, preserved failure and quarantine-only rollback; live/production Delegate gates remain open
- [Deeper workload audit](../../../development/pi-103-deeper-performance.md) — scoped scheduler, family contention and natural reclamation observations; captured-authority async admission correction, exploratory comparison provenance and retained failures; whole-plan acceptance and deployment remain gated
- [Bounded retention and actual scheduler-agent](../../../development/pi-103-soak-agent.md) — corrected 60-second history shapes, real AgentPool/SDK prompting and live leaf restoration; deterministic provider and delivery sink, broader/live/Delegate gates remain separate
- Fresh [registry](receipts/earendil-103-registry.json), [package admission](receipts/earendil-103-package-admission.json), [provider inventory](receipts/earendil-103-provider-auth.json), [public MCP types](receipts/earendil-103-mcp-public.json), [CLI](receipts/earendil-103-packaged-cli-auth-bun.json), [browser](receipts/earendil-103-provider-browser-bun.json), [devices](receipts/earendil-103-provider-devices-bun.json), [Codex device](receipts/earendil-103-codex-device-bun.json) and [private UI](receipts/earendil-103-anthropic-private-ui.json)

## Historical Pi 1.0.2 integration

Exact released target: `cd32f7725fdbddbaecdff5b1e68491563394e0ca`. Rui authorised source retargeting with the standard shipped MCP wrapper retained. Native parity/removal and pi-durable are future scope; installation, restart and real-account tests need separate approval.

- [Integration and qualification](../../../development/pi-102-integration.md)
- [Current acceptance checkpoint](earendil-102-remaining-acceptance.md) — merged Settings, exact hosted/full/postmerge evidence, retained-wrapper/core checks, callback fixture correction and disposable rollback; production Delegate/live/rollout gates remain open
- Fresh [registry](receipts/earendil-102-registry.json), [package admission](receipts/earendil-102-package-admission.json), [provider inventory](receipts/earendil-102-provider-auth.json) and [public MCP types](receipts/earendil-102-mcp-public.json)
- Fresh synthetic [packaged CLI](receipts/earendil-102-packaged-cli-auth-bun.json), [browser/copy-code](receipts/earendil-102-provider-browser-bun.json), [provider devices](receipts/earendil-102-provider-devices-bun.json), [Codex device](receipts/earendil-102-codex-device-bun.json) and [private UI](receipts/earendil-102-anthropic-private-ui.json) receipts

## Historical Pi 1.0.1 integration

Exact upstream target: `a7229ddc21810d6245105978033b7df645ecc2f7`. [Source migration #1537](https://github.com/rcarmo/piclaw/pull/1537) is merged; Smith's initial installation was verified separately. Native/Apply, production Delegate integration, combined qualification and live-canary criteria are incomplete. Adapter/Auto stays the default.

| Evidence | Scope / state |
|---|---|
| [Remaining acceptance](earendil-101-remaining-acceptance.md) | Current MCP-01–15 and AUTH-01–08 evidence/gaps, merged inactive request foundations and separate rollout permissions. |
| [Source migration](../../../development/pi-101-migration.md) | Exact core package pins and current-loop qualification; later source merges do not extend the initial installation receipt. |
| [Registry provenance](receipts/earendil-101-registry.json) and [package admission](receipts/earendil-101-package-admission.json) | Fresh exact-version archives, package closure and offline admission. |
| [Provider auth](receipts/earendil-101-provider-auth.json), [browser](receipts/earendil-101-provider-browser-bun.json) and [devices](receipts/earendil-101-provider-devices-bun.json) | Isolated synthetic public auth flows; real-account parity/canary is separate. |
| [Packaged CLI auth](receipts/earendil-101-packaged-cli-auth-bun.json) and [Codex device flow](receipts/earendil-101-codex-device-bun.json) | Exact published CLI and device-flow fixtures under Bun; no live accounts or provider inference. |
| [Public MCP contract](receipts/earendil-101-mcp-public.json) | Positive synthetic public factories and ten missing public contracts; Native parity/activation unqualified. Failed-teardown evidence is a separate gate. |
| [Private-auth UI](receipts/earendil-101-anthropic-private-ui.json) | Synthetic privacy/activation UI cases; no private production-defect disclosure or live account acceptance. |
| [Upgrade coherence](../../../development/pi-101-upgrade-coherence.md) and [public shutdown consumer](../../../development/mcp-public-shutdown-consumer.md) | Qualified source follow-ups; authoritative adapter acknowledgement does not certify Native teardown. |
| [Delegate synthetic qualification](https://github.com/rcarmo/piclaw-addons/blob/cc8a67c/scripts/qualification/DELEGATE-AUTH-101.md) | Fresh public provider/private-pipe fixture from add-on #172; production auth/environment, cancellation, engine and budget gates are separate. |

## Historical Pi 1.0.0 migration and approved durable design

| Evidence | Scope / state |
|---|---|
| [Durable architecture and HC/PC crosswalk](earendil-100-durable-crosswalk.md) | 25 HC and 20 PC intents; exact spec/archive references, prior paused Memory probe, explicit source-only gaps and retained host authority. Design approved 3 October 2026; durable work out of scope, no production activation or new semantic acceptance. |
| [Current-loop migration](earendil-100-current-loop-progress.md) | Independent #1497 migration and frozen 0.99.1 consumer; subsequent merge recorded in the ADR index. |

## Completed 0.99.1 assessments

| Evidence | Scope / state |
|---|---|
| [Inactive Harness](earendil-0991-harness-assessment.md) | Completed #1452; retained exact-version evidence, not pi-durable qualification. |
| [Pico3](earendil-0991-pico3-assessment.md) | Completed #1453; experimental evidence and unverified host boundaries retained. |

## Published 0.87.0 candidate

| Evidence | Scope / state |
|---|---|
| [Stable Harness candidate](earendil-0870-harness-candidate.md) | Packed 0.87.0 publication coordinates, public-export fingerprints, 28-test HC-001–HC-023 partial receipt, compile blockers and unchanged activation limits; candidate is not installed or selected |
| [Streaming-fork evidence](earendil-0870-streaming-fork.md) | Public 0.87.0 conformance: 15 Memory + 15 JSONL executions pass; HC-025 remains partial because SQLite and cross-process host ownership are unproved |
| [Experimental Pico3 assessment](earendil-0870-pico3-assessment.md) | Export/source/test inventory, authority mapping and HC/PC gaps; go for a disposable fake-provider spike, no-go for production adoption |

## Published 0.85.1 follow-up

| Evidence | Scope / state |
|---|---|
| [A/B/C/D work sequence](earendil-0851-work-sequence.md) | Current release-pinned boundaries; B migration, C broader inactive HC completion, D later-release reassessment |
| [Admission and catalogue](earendil-0851-admission.md) | Bun/real Node public closure, source-only exclusions, 15 total API moves with +107/-43 gross entries; no pi-server workaround |
| [Candidate readiness](earendil-0851-readiness.md) | Executed A/B migration gates and bounded partial HC evidence |
| [Broader inactive HC evidence](earendil-0851-hc-evidence.md) | Closed HC-001–HC-025 selected-release catalogue: 24 partial, HC-024 unsupported, no activation |
| [All-package import/path smoke](earendil-0851-addon-matrix.md) | 42 Linux/Bun package-root imports and four no-main path checks; no runtime/browser activation |
| [Canary procedure](earendil-0851-canary.md) and [executed receipt](earendil-0851-canary-result.md) | Authorised piclaw-test upgrade/rollback and targeted browser checks executed; baseline abort-endpoint defect #1334 reproduced; guest snapshot restored stopped; no merge/deploy approval |
| [0.84.4 negative receipt](earendil-0844-historical-negatives.json) | Preserves seven negative compiler checks and 25 unsupported outcomes; never promoted to selected-release success |

## Historical assessment register

Rows E-001–E-029 are dated observations from the original assessment and its 1 September refresh. Their terms “current”, `dev`, #8963 and d14d6b refer to that capture window, not today's selected candidate. The original source identities and outcomes are retained below.

| Evidence ID | Source | Baseline relevance | State |
|---|---|---|---|
| E-001 | `v2.13.2` / `0afd3ae645c423bed82deef80c343bcaa6f31d4d` | Stable Piclaw assessment baseline | Verified tag and commit; ADR scaffold is the only child commit on `main` |
| E-002 | `package.json`, `bun.lock`, `Makefile:193` | Earendil dependency history and current-loop selection | Historical baseline `0.84.1`; current coherent Earendil family `0.84.4`, with direct `openai@7.5.0` for Azure extension imports |
| E-003 | `docs/architecture.md` | Published component and current turn-flow description | Cross-checked against baseline source while building the 59-capability matrix; some prose is historical and the matrix records source-level ownership |
| E-004 | `docs/archive/turn-mechanism-audit.md` | Earlier full-stack turn audit | Reviewed as historical behaviour/risk evidence; superseded details are not treated as baseline authority |
| E-005 | `docs/design/agent-turn-state-machine-assessment.md` | Current-loop hazards and prior reducer proposal | Reviewed as evidence; recommendation not adopted |
| E-006 | `docs/earendil-0.84-upgrade-assessment.md` | Earendil 0.84 compatibility history | Reviewed as historical evidence; current-loop version selection is now `0.84.4` |
| E-007 | Post-release rollback campaign | Regressions and rollback context | Source note was transient and is no longer present; durable facts retained in E-008/E-009 and `regression-corpus.md` |
| E-008 | `archive/post-v2.13.2-fixes-20260810` | Candidate fixes and regression history | Preserved at `da47ca62f3c1e7e0d5e538cc250303eb8c9ca1f4`; inspect selectively |
| E-009 | `/workspace/backups/piclaw-post-v2.13.2-fixes-20260810.bundle` | Verified archive backup | `git bundle verify` passed; complete history at `da47ca62f3c1e7e0d5e538cc250303eb8c9ca1f4` |
| E-010 | Baseline pre-push `make ci-fast` on ADR-only commits | Release validation environment | Guard reached the baseline test suite but failed because the host injects `PICLAW_MCP_MEMENTO_TOKEN`; isolated `runtime/test/secure/mcp-keychain.test.ts` passes 8/8 with that variable unset and fails 1/8 with it inherited |
| E-011 | [`earendil-0.84.1-harness-surface.md`](earendil-0.84.1-harness-surface.md) | Historical Earendil harness declarations, implementation, reducer and session contracts at `0.84.1` | Surveyed; execution methods are structural stubs, while reducer/session contracts are implemented |
| E-012 | [`current-capability-matrix.md`](current-capability-matrix.md) | Piclaw v2.13.2 agent lifecycle inventory | Initial 59-capability ownership and evidence matrix complete; named coverage gaps retained |
| E-013 | [`regression-corpus.md`](regression-corpus.md) | Baseline tests, issues, audits and upstream concurrency evidence | 26 regressions mapped to 15 invariants and named contract scenarios |
| E-014 | [`effector-inventory.md`](effector-inventory.md) | Piclaw v2.13.2 I/O, storage, session, tool, scheduler and projection surfaces | 36 surfaces classified; Piclaw ports limited to service-plane responsibilities and execution uses direct Earendil contracts |
| E-015 | [`target-state-model.md`](target-state-model.md) | Proposed Piclaw service-plane and Earendil execution-plane integration | Identity hierarchy, accepted-source and operation models, terminal transaction, cancellation, restart reconciliation, replay and safety properties defined |
| E-016 | [`earendil-version-fixture-contract.md`](earendil-version-fixture-contract.md) | Selected-version Earendil contract implementation and semantic suite | Direct public constructor/types, deterministic gated driver, deterministic model/tools, fault plan, 25 harness cases, 20 Piclaw boundary cases and 10 assumptions specified |
| E-017 | [`alternatives-and-migration.md`](alternatives-and-migration.md) | Architecture comparison and cutover planning | Direct-adoption/selected-version-fixture alternative selected; nine reversible phases (`M0`–`M8`), shadow metrics, validation and installed-service gates defined |
| E-018 | [`traceability-matrix.md`](traceability-matrix.md) | Assessment completeness check | 59 capabilities, 26 regressions and 10 assumptions mapped to target owner, mechanism and planned tests |
| E-019 | [`quality-review.md`](quality-review.md) | Final assessment review against the agreed quality bar | Decision-ready; independent architecture approval and implementation evidence remain explicit gates |
| E-020 | [`earendil-native-effector-contracts.md`](earendil-native-effector-contracts.md) | Direct Earendil effect contracts, from 0.84.1 baseline to Harness v3 target | Direct harness/storage/model/tool/environment/resource/event/telemetry contracts defined; v2-only glue labelled; parallel Piclaw execution types prohibited |
| E-021 | [`tool-resource-migration.md`](tool-resource-migration.md) | Current Piclaw tools, environments, resources and extensions | Core tools mapped to public Earendil tools/ExecutionEnv; Piclaw tools and extension categories mapped to exact harness contracts |
| E-022 | [`earendil-0.84.1-constraints.md`](earendil-0.84.1-constraints.md) | Historical constraints in Earendil 0.84.1 for direct adoption | Eight production blockers/type mismatches and lower-confidence surfaces mapped to Piclaw version-selection responses |
| E-023 | [`earendil-version-selection.md`](earendil-version-selection.md) | Earendil adoption policy | Direct-type adoption, accepted Piclaw churn, upgrade workflow and non-negotiable service responsibilities recorded |
| E-024 | [`direct-type-audit.md`](direct-type-audit.md) | Full ADR review for duplicate execution abstractions | Earendil-owned and Piclaw-owned type families separated; parallel execution types removed/prohibited |
| E-025 | [`earendil-harness-v3-assessment.md`](earendil-harness-v3-assessment.md) | Released Harness evidence plus current `dev` implementation | released `v0.84.4` at `b79e4cc834970cca69daebffab7df1da7d1e52c4` has byte-identical 0.84.2 Harness files; `dev`/PR #8963 pinned at `d14d6b22327d545d6a253f932165b63e48d7f9c8`, candidate spec blob `c7c18c74730d4971f8ca004924e44c7fbe236f25`; public lane drive and WP07 host ownership implemented, WP08 in progress |
| E-026 | [`future-effector-specifications.md`](future-effector-specifications.md) | Future effector specifications and latent direct-boundary evidence | Nine Piclaw-owned interfaces and corrected WP-3C preparation contracts; WP-3B preserves historical `0.84.1` evidence and runs direct public assignments, 25 unsupported scaffold outcomes and 30-case Memory/JSONL conformance against current `0.84.4`. The release is selected for the existing loop but remains rejected/evidence-only for Harness v3; no Harness activation occurs |
| E-027 | Earendil draft PR [#8963](https://github.com/earendil-works/pi/pull/8963) and `dev` | Current Harness v3 implementation campaign | Observed 2026-09-01 18:30 UTC at `d14d6b22327d545d6a253f932165b63e48d7f9c8`; open draft, exact-head CI green, public lane drive complete, only session watch stubbed, WP08 storage/fork work in progress |
| E-028 | Earendil PR [#7784](https://github.com/earendil-works/pi/pull/7784) | Released-v2 bounded generic record-query direction | Pinned at `3fed85d9473dcbb47ec2444c61781fcc1200bc41`; closed/conflicting; not a Harness v3 recovery dependency |
| E-029 | Earendil PR [#7751](https://github.com/earendil-works/pi/pull/7751) | Current coding-agent concurrent rewrite regression evidence | Pinned at `f3e5cc82a44c0970d3e6935417b6fb4079dc3d2a`; open; race scenarios retained as v3/backend acceptance requirements |
