# Pi 1.0.3 acceptance checkpoint

The released Pi 1.0.3 source integration, retained MCP wrapper and approved synthetic VM canary are qualified within their recorded scopes. Overall production acceptance is incomplete: production Delegate contracts and live account/server/rollout decisions are unresolved. The fresh-workspace add-on peer correction is merged but has not been deployed to Smith or VM900.

Selected release: `d78dc83d633229d12f8b79631384c4c2717c399f`. Current source checkpoint base: `ad2b298f10c10d81cb6d277620aa464da4c53dd4` (PR1565). Adapter runtime remains `dddfcf630508f42c169889c11dee94e69b746e7c`; Adapter/Auto has one owner and unsupported Native rejects without fallback. Native replacement/parity and pi-durable are excluded. Historical [Pi 1.0.2 acceptance](earendil-102-remaining-acceptance.md) retains its evidence and limitations; its passes are not new 1.0.3 executions.

## Completed source and synthetic slices

| Slice | Verified evidence | Limits |
| --- | --- | --- |
| [Released integration](../../../development/pi-103-integration.md), PR1558 | Eight exact archives; fresh provider/CLI/device/browser/private-UI receipts; full 6,516 pass / eight skips / zero fail; exact hosted37316648682 success | Synthetic auth/accounts. Both-skin MCP Settings14/590 terminal summary has no captured launcher exit; retained as limited evidence |
| [Deeper workloads](../../../development/pi-103-deeper-performance.md), PR1560/1561 | Async captured-authority family admission; 16 workload runs; full6,527/8skip0fail | Exploratory comparison lacked execution-time source binding; contention batch is not isolated ACK. Hosted stale-catalog failure retained and generated-only correction verified locally |
| [Retention and actual scheduler-agent](../../../development/pi-103-soak-agent.md), PR1562 | Six corrected60ssoaks across history shapes, three actual AgentPool/SDK scheduler runs; full6,531/8skip0fail | Nondeterministic reclamation, synthetic provider/delivery. Reopen checks prompt/count, not full topology. PR hosted compact-tail test failure retained; merge-head hosted37336081201 success is separate |
| [Private configuration and VM canary](../../../development/pi-103-vm-canary.md), PR1563/1564 | Mode0600 atomic-write fix; full6,533/8skip0fail; exact hosted37346512175 success; corrected continuous Classic1,800,019ms /59cycles; both skins, cancellation/SSE, actual synthetic MCP/scheduler, family gates; stopped/quarantined | Original21cyclecanary failed and is not a pass. Visual restarted and has no second30minclaim. No live provider/server credentials |
| [Fresh add-on host peers](../../../development/pi-103-core-addon-peers.md), PR1565 | Real seeded-import red/green, sevenregressions32assertions, guarded sevenpinnedentry imports0network/process; full6,537/8skip0fail +25feature/nineweb; postmerge7/32 | No deployment or existing-workspace repair. Absolute peer links require separate migration if creating runtime relocates. Native Windows branch unexecuted. Hosted result pending at checkpoint capture |

The [checkpoint receipt](../../../development/receipts/pi-103-acceptance-checkpoint.json) hashes the linked current receipts and records source/hosted observations. It consolidates evidence; it does not rerun completed gates or aggregate test totals across different heads as one suite.

## Retained-wrapper MCP criteria

| Requirement | Evidence state | Remaining gate / disposition |
| --- | --- | --- |
| MCP-01 package admission | Current1.0.3 exact archive/export/family qualification | Source complete; installation separate |
| MCP-02 configuration and precedence | Released Settings source inherited from mergedPR1550; current1.0.3 scoped Settings evidence and canary persistence | No new full wrapper regression run in this checkpoint |
| MCP-03 credential ownership | Prior generation-scoped keychain/env/auth policy tests retained | Real keychain/server OAuth not authorised; Native store replacement excluded |
| MCP-04 exposure/filtering | Prior wrapper policy tests plus current supported-owner/refused-Native checks | Full Native parity excluded |
| MCP-05 execution/tool policy | Current synthetic SDK MCP/codemode pipeline, real VM synthetic proxy call | Paid codemode model execution and production Delegate boundary unavailable |
| MCP-06 resource policy | Prior wrapper capability/resource tests retained | Live-server resources and Native filters separate |
| MCP-07 deadlines | Prior host transition/body/failed-cleanup fences retained | Native progress-reset deadline semantics excluded |
| MCP-08 lazy/socket lifecycle | Retained adapter lifecycle fixtures and current loopback canary stop | No broad real-server socket acceptance |
| MCP-09 replacement/cleanup | Prior public shutdown ACK consumer and current stopped/quarantined canary | Auth/provider raw tails are separate unresolved contracts |
| MCP-10 headless OAuth | Prior wrapper auth fixtures with explicit corrected callback overlay retained | Real server/account OAuth not run; no new wrapper auth qualification here |
| MCP-11 prompts and Apps | Prior wrapper capability/App tests and current SDK pipeline retained | Live Memento prompts/Apps not authorised |
| MCP-12 status/management | Current1.0.3 scoped Settings and VM private persistence; connection status remains unknown where unobserved | Complete Native observer/management contracts unavailable |
| MCP-13 Delegate MCP | Inactive host rejects required MCP and describes none;1.0.3 consumer22/160 | Production child capability/generation/transport acceptance incomplete; add-ons160 open |
| MCP-14 live Memento | Not run; synthetic loopback only | Requires named server/allowed read-only call approval |
| MCP-15 removal/rollback | Adapter retention is approved; disposable historical rollback and current quarantine-only canary stop | Adapter removal excluded; production/core/add-on/token rollback unapproved |

## Provider authentication criteria

| Requirement | Evidence state | Remaining gate |
| --- | --- | --- |
| AUTH-01 inventory | Current exact42providers/nineOAuth inventory, Azure built-in rename/custom distinctions | Arbitrary composed/custom production routes need their own execution plan |
| AUTH-02 packaged flows | Current exact published CLI OpenAI/Codex10cases and payload fingerprints | Required real-account login and production middleware separate |
| AUTH-03 interactions | Current device22/Codex6/browser20/copy-code17/privateUI10/1342 synthetic cases | Live supported-account interaction matrix incomplete |
| AUTH-04 lifecycle | Current released refresh-rotation/cancelled-delivery persistence regression; prior scoped auth fixtures retained | Public raw auth-task/account-generation ACK absent; no live refresh/revocation approval; opt-in crash skip has no new pass |
| AUTH-05 isolation | Current privateUI and prior keychain/env/IPC privacy fixtures | Production Delegate credential delivery and broader historical trace coverage unfinished |
| AUTH-06 external/custom | Current1.0.3 source external-auth and Azure identity/payload checks | Real cloud/bootstrap/custom authority not established by model label; protected migration unapproved |
| AUTH-07 availability/Delegate | Source auth/model gates and inactive1.0.3 consumer22/160 pass | Parent/child realcredential-source agreement, fresh account authority, raw settlement and final immutableartifacts/policy/soleowner/orphan gates unfinished |
| AUTH-08 recovery/release | Historical disposable snapshot restore plus approved current synthetic VM canary/quarantine pass | Production install/restart, real-account/server canary and rotated-token rollback require explicit scope; authentication is not billable-inference approval |

## Unresolved public contracts and operational choices

Exact Pi1.0.3 terminal events and `result()` do not acknowledge the raw executing provider/authentication task or its cleanup. No opaque account-generation lease binds preparation and dispatch. Upstream [10461](https://github.com/earendil-works/pi/issues/10461) is closed by automated new-contributor policy; no implementation or acceptance response was recorded in the latest observation. The parent host, shared paid-request installer and production Delegate remain inactive. Synthetic injected settlement handles, private SDK access, provider substitution or copied credentials do not satisfy these gates.

Two separate decisions are needed:

1. Keep production Delegate and paid codemode model execution excluded/deferred from this source integration, or pursue the public contract dependency and final production qualification as mandatory acceptance. This is a scope decision, not a passing test or automatic issue closure.
2. Define whether to proceed with live validation/Smith rollout. It needs the named immutable artifact, exact account/server methods/calls, expenditure limit (zero unless separately approved), snapshot/credential protection, Azure rename-conflict handling, soak/stop conditions and token-aware rollback. No new live calls, production installation or restart are approved by this checkpoint.

The completed canary's rollback unit quarantines candidate writes and never replays them automatically. All65originaldatabase/sidecarhashes are preserved. New unrelated VM fixture services started after the canary stopped; future VM work must recheck ownership/current use instead of stopping those services under the expired cleanup scope.
