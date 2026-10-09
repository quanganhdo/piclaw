# Pi 1.0.1 remaining acceptance

> Historical checkpoint. Rui subsequently selected released Pi 1.0.2 and confirmed integration with the shipped MCP wrapper. Native parity and wrapper removal are future work, not current integration prerequisites. See the [1.0.2 integration record](../../../development/pi-102-integration.md). The observations below retain their original version and scope.

The initial Pi 1.0.1 upgrade is installed on Smith. The later source improvements listed below are merged but have not been deployed by this work. Native MCP replacement, production Delegate integration, combined acceptance and live canary criteria are unfinished. Adapter/Auto stays the default; Piclaw rejects unsupported Native selection before activation. Pi-durable qualification and implementation are outside this task.

Target: Pi 1.0.1, upstream `a7229ddc21810d6245105978033b7df645ecc2f7`. Source checkpoint: Piclaw `1534040a19b1841bb64cdc80797176531ba9efff`, after shared request foundation PR #1547. This document changes no runtime, dependency, credential, activation or deployment setting. Historical 0.99.1/1.0.0 fixtures and receipts retain their original status.

## New source evidence

| Slice | Verified source result | Acceptance boundary |
| --- | --- | --- |
| Idle input admission [PR1543](https://github.com/rcarmo/piclaw/pull/1543) | Merged at `c278927d6`; full gate: 6,219 passed, 8 skipped, 0 failed; authenticated WAL checks; post-merge: 63 tests / 376 assertions | Responsive admission under an owned writer; the full live 30-second delay cause is untraced |
| Delegate CLI [PR173](https://github.com/rcarmo/piclaw-addons/pull/173) | Published as 0.2.17; exact running-release resolution and artifact verification | No new production auth/environment broker |
| Request ledger [PR1544](https://github.com/rcarmo/piclaw/pull/1544) | Merged at `ec5b70a9d`; full gate: 6,243 passed, 8 skipped, 0 failed; post-merge: 69 tests / 276 assertions | Accounting foundation, no provider execution |
| Parent host [PR1546](https://github.com/rcarmo/piclaw/pull/1546) | Merged at `c08bef3f`; full gate: 6,295 passed, 8 skipped, 0 failed; post-merge: 119 tests / 476 assertions | Inactive injected host; no public runtime registration or live provider plan |
| Shared reservations [PR1547](https://github.com/rcarmo/piclaw/pull/1547) | Merged at `1534040a1`; full gate: 6,311 passed, 8 skipped, 0 failed; post-merge: 117 tests / 507 assertions | Synthetic integration exercising the public Agent/tool-loop and side-runner APIs; the installer remains inactive |
| Adapter effective preview [PR10](https://github.com/piclaw-bot/pi-mcp-adapter/pull/10) | Merged upstream at `dddfcf6305`; 1,436 tests and 73 post-merge tests passed | Core still pins `2400aec`; the new public preview API is not in its dependency. Server editor, controller and panes are unfinished |

The core PRs #1543, #1544, #1546 and #1547 full gates each include 25 feature tests and 9 web/build tests. Their exact-head hosted checks, source/tree parity and post-merge receipts are separate from installation. See [request reservations](../../../development/delegate-request-reservations.md), [provider host](../../../development/delegate-provider-host.md) and [shared request boundary](../../../development/shared-model-request-reservations.md).

## MCP requirements

Statuses below apply to this exact-target checkpoint. “Scoped” means the cited implementation or synthetic path passed; broader acceptance has the stated missing gate.

| Requirement | Evidence at Pi 1.0.1 | Remaining gate or disposition |
| --- | --- | --- |
| MCP-01 package admission | Eight exact packages admitted; current root imports and public-type probe pass | Complete source admission; new rollout remains separate |
| MCP-02 configuration and precedence | Adapter configuration projection and exact-target override fixtures pass; public virtual preview API merged | Server editor/controller/UI integration is unfinished |
| MCP-03 credential ownership | Piclaw adapter/keychain bridge and lease fencing qualified scoped | Native `McpOAuthCredentialStore` is incompatible with the approved generic keychain-backed contract |
| MCP-04 exposure/filtering | Exact public deferred/codemode/direct/hidden synthetic tool pipeline and adapter policy checks pass | Full Native include/exclude/resource/selected-engine parity is unqualified |
| MCP-05 execution/tool policy | Real public scripting, nested tool hooks and parent IDs tested; model execution inside codemode stays disabled | Provider/model execution and complete Native policy parity need separate gates |
| MCP-06 resource policy | Native client resource primitives exist | No public per-server resource filtering/list-result policy seam |
| MCP-07 deadlines | Piclaw adapter/controller applies bounded transition handling | Native progress-reset inactivity timeout does not enforce the host absolute deadline |
| MCP-08 lazy/socket lifecycle | Adapter supports retained configuration and lifecycle ownership | Native lacks host-owned lazy connection and Unix socket configuration seams |
| MCP-09 replacement and cleanup | On the Adapter path, public shutdown acknowledgement is consumed; failed or hung cleanup fences replacement and retains credentials | Native reload can suppress close failure and start replacement; Native closure is unqualified |
| MCP-10 headless OAuth | Exact-target callback/CIMD/state/path and low-level synthetic flows pass | Native extension has no public host auth-start/complete controller matching Piclaw ownership |
| MCP-11 prompts and Apps | Some low-level resource operations are public | No public prompt listing/retrieval or host App renderer; Apps are filtered by Native resource support |
| MCP-12 status/management | Piclaw reports fixed readiness/projection diagnostics without secret values | No public Native connection observer or complete host reconnect/login/logout controls; server Settings unfinished |
| MCP-13 Delegate MCP | Inactive host plan explicitly describes MCP-none and denies required MCP | Production child selected-engine/generation/capability propagation is unqualified; add-ons issue 160 stays open |
| MCP-14 live Memento | Offline lifecycle/tool fixtures exist | Requires separate real-account/server-call approval and applicable security gates; not executed here |
| MCP-15 removal/rollback | Adapter retention and unsupported-Native rejection are enforced | Adapter removal is conditional future work under issue 1454, not a prerequisite for the selectable-engine release; live rollback rehearsal is separate |

### Confirmed Native API gaps

The current `scripts/check-earendil-mcp-public-101.ts` probe still compiles its supported surface and produces exactly the ten expected missing-seam diagnostics:

| Public seam | Compiler diagnostic | Requirement |
| --- | --- | --- |
| `lazy` | TS2353 | MCP-08 |
| `statusObserver` | TS2353 | MCP-12 |
| `resourceFilter` | TS2353 | MCP-06 |
| `authStart` | TS2353 | MCP-10 |
| `appRenderer` | TS2353 | MCP-11 |
| `absoluteDeadlineMs` | TS2353 | MCP-07 |
| `McpOAuthCredentialStore` | TS2740 | MCP-03 |
| `socket` | TS2322 | MCP-08 |
| `listPrompts` | TS2339 | MCP-11 |
| `getPrompt` | TS2339 | MCP-11 |

This compile probe checks public types; it remeasures neither archive integrity nor live behaviour. The separate public-SDK Native close-failure test retains the teardown failure: old transport close rejects, reload resolves and starts a replacement, the old transport stays unclosed and no extension error surfaces. The test records a blocker; it is not safe Apply acceptance. At this source checkpoint, the tested readiness projection is `{adapter:true,native:false,codemode:true}`; this is not a fresh observation of the installed service. No private SDK casts/imports, parallel Native client, status scraping or automatic fallback is accepted.

## Provider authentication requirements

| Requirement | Existing exact-target evidence | Missing acceptance |
| --- | --- | --- |
| AUTH-01 methods/inventory | Public built-in inventory: 42 providers / nine OAuth owners, version/gitHead receipt; OpenAI/Codex identities distinct | Arbitrary external/custom compositions need their own supported plan and policy |
| AUTH-02 packaged flows | Ten packaged CLI OpenAI/Codex synthetic cases, disposable network namespaces and artifact checks | Real account login and subscription/provider behaviour are separate |
| AUTH-03 interactions | 22 device, 6 Codex device, 20 browser, 17 Anthropic copy-code and 10 private-UI synthetic cases | Live denial/expiry/retry/device/browser matrix for supported production accounts |
| AUTH-04 credential lifecycle | Exact-target lock/refresh/storage/logout/sanitised-error synthetic cases | Complete real rotation/logout/revocation and request-account generation semantics |
| AUTH-05 privacy/isolation | Private UI: 1,342 assertions; no secret input in stored cards/rows/logs/recording exports; the synthetic host IPC design carries no credentials | Production Delegate environment/credential boundary and supported account policy |
| AUTH-06 custom/external sources | Exact-target stored/env precedence and cloud/local public adapter probes | Complete composed-provider coverage; ambient/custom/virtual routes cannot inherit synthetic acceptance |
| AUTH-07 Delegate | CLI selection, failed-auth no-fallback, exact 1.0.1 synthetic fixture, inactive parent host and shared ledger merged | Actual provider/auth settlement, fresh account authority, production child wiring and MCP plan |
| AUTH-08 rollout/recovery | Initial authorised Smith upgrade preserved configuration/database and has a rollback snapshot | Later-source deployment, live soak and rotated-token rollback require separate approval/proof |

Public Pi 1.0.1 auth cancellation and stream/result completion can precede underlying task cleanup. The offline public ModelRuntime/synthetic Provider reproduction demonstrates both orders. Its test harness explicitly drains the held tasks; the SDK does not supply a public completion handle. No real credentials or network are used. [Upstream issue 10461](https://github.com/earendil-works/pi/issues/10461) requests a public completion handle. GitHub auto-closed it under the new-contributor policy; closure is not evidence of a fix. The parent host and shared reservation installer stay inactive until raw cleanup and account authority can be established through a qualified public contract or explicitly narrowed supported-provider plan.

## Combined gates and permissions

- Core issues 1451/1458/1495 and add-ons issue 160 have incomplete acceptance. Documented gaps are not waived by merged foundations or passing negative fixtures.
- Core issue 1455 requires combined supported-provider/engine/security/UX/resource qualification. Existing full source gates do not cover the blocked production Delegate or Native rows.
- CPU/event-loop/DB/parsing profiles cover owned synthetic workloads. Ledger/shared-request WAL/FULL measurements separate statement costs from durable transaction wall time; event-loop samples and CPU startup scope are reported. Large-history/GC/background and mixed live request coverage remain broader audit work. No full-system performance claim.
- Adapter server Settings is unfinished. The preview API is merged only upstream; core still pins `2400aec`. Secure writer/batch-ACK prerequisites are implemented in an isolated branch, but the backend controller, forms, both interface skins and final qualification are incomplete.
- Core issue 1456 requires separate permission for installation, restart, real-account canary, soak and rollback. The initial migration receipt grants no later rollout authority.
- Parent issue 1442 stays open until all applicable acceptance gates pass. Adapter removal remains a conditional decision and pi-durable stays out of scope.

## Evidence and checks

- [Migration qualification](../../../development/pi-101-migration.md) and [package coherence](../../../development/pi-101-upgrade-coherence.md)
- [Adapter ACK consumer](../../../development/mcp-public-shutdown-consumer.md) and [MCP Settings response/Apply contract](../../../development/mcp-settings-api.md)
- Fresh public-type probe at source checkpoint `1534040a1`: local `native-public-101-current.json` in `/workspace/tmp/pi-101-epic-audit/remaining-acceptance/`
- Retained exact-target [MCP receipt](receipts/earendil-101-mcp-public.json), [provider inventory](receipts/earendil-101-provider-auth.json) and other versioned receipts in this evidence directory
- Current fail-closed source: `runtime/src/agent-pool/mcp-codemode-runtime.ts`, `mcp-engine-plan.ts`; public gap validator: `scripts/check-earendil-mcp-public-101.ts`
- Executable regressions: `earendil-101-candidate.test.ts`, `earendil-101-admission.test.ts`, `mcp-public-shutdown-consumer.test.ts`, `mcp-engine-plan.test.ts`, `mcp-codemode-runtime.test.ts`, `provider-auth-stream-errors-101.test.ts` and shared-request tests
