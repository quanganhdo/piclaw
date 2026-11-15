# Inactive child-request proxy retirement

The unregistered child-request proxy and public-StreamFn installer are removed from executable Core. Shipping native Delegate and captured host accounting keep their existing implementations. This is one bounded #1575 slice; the historical Harness compatibility manifest and other child issues remain separate work.

## Usage decision

Implementation base: `fc587de57babb118b5f0fd2ace406548bd04bbfa`.

| Surface | Decision and evidence |
| --- | --- |
| Ten `runtime/src/addons/child-request-*` modules | Remove. Their only outside production caller was the inactive shared StreamFn adapter, included in the same closure. No runtime host registration, dynamic/package entry point or approved add-on consumer exists. |
| `budget/shared-model-request-boundary.ts` | Remove. Its only production importer was the unused installer; its own contract explicitly described an inactive public StreamFn adapter. |
| `budget/install-shared-request-boundary.ts` | Remove. No production installer caller; bootstrap/AgentPool/model services never installed this wrapper. Its global WeakSet/session mutation lifecycle is eliminated. |
| Prototype-only tests/profiles | Retire only the removed scope/HTTP/executor/provider/proxy/installer contracts and their synthetic profile programs. Preserve measurements, original sources and failed/excluded delivery context in immutable history and clearly historical documentation. No test deletion supplies backend credit. |
| `model-request-accounting.ts` | Keep. `runtime/durable-engine/src/host-request-accounting.ts` calls it for current parent/Delegate/side/maintenance accounting. Two direct accounting tests formerly beside the inactive adapter are preserved at this actual primitive; captured-charge, unresolved-zero, definitely-unsent and host-calendar assertions remain covered. |
| Reservation ledger/admission, pricing/valuation, evaluator and usage recorder | Keep. Active SDK request/effect budgets, ancestry, unknown holds, exact settlement and recorder replay retain their current owners. |
| Native Delegate | Keep. `default-application-runtime.ts` installs `createHostDelegateTool`; model approvals/thinking, tools, files/progress, budgets, deadlines, cancellation and owned native cleanup are supported functionality. |

Tracked source inventory includes ignored tracked paths, module/type references, startup/public registry/entry-point searches, package scripts/files and explicit literal static/dynamic import graphs. The three graphs contain none of this closure: root `index.ts` (546 reachable files), `agent-pool.ts` (324) and native default factory (635). Computed/external imports also require the manual source/package audit; absence of one static import was not treated as sufficient evidence.

Approved add-on source `ad7ad0a4b63ee37090b6bee4309fa5c458ec6510` contains no child-request API/installer/closure consumer. Core PR #1568 and add-ons PRs #175/#177/#178 are closed **unmerged**; no never-merged implementation is claimed deleted, and their branches/worktree evidence are untouched. Arbitrary unsupported external deep imports were not observable and are not given a new compatibility stub.

## Removed owners and preserved invariants

The closure contained an independent child delivery/scope state machine, executor/raw-tail lifecycle, HTTP body/send/finish lifecycle and mutable global/session stream installer. These unregistered owners and their private request protocol now have no executable implementation. No replacement callback wrapper, error facade, registry or subprocess proxy is added.

The native SDK and current host request boundary continue to own real model/tool execution, raw cleanup and request identity. Existing reservation/settlement/uncertain-cost/auth/ownership checks remain in active code. No provider/authentication/MCP/budget/source-ID or database implementation is removed or relaxed to obtain a line-count reduction.

## Measure and evidence

Stable #1270 handwritten source rules yield **146,885 → 146,076 physical lines**, **136,386 → 135,588 nonblank**, **728 → 716 files**: **−809 physical / −798 nonblank / −12 files**. No production implementation is relocated or added outside the roots. Supporting test/profile deletion and documentation changes receive zero production credit. The [machine receipt](receipts/inactive-child-request-retirement-1575.json) records source hashes and exact scope.

`inactive-child-request-retirement.test.ts` fails against the old source, then asserts the closure absent while the native Delegate/accounting/pricing/admission owners remain. `model-request-accounting.test.ts` preserves the two original direct-primitive contracts and tests captured attribution/exact-once charge, host accounting time, unresolved-zero and unsent release directly against isolated storage.

Selected existing reservation tests preserve uncertain holds, payload conflict/atomic settlement, parent-recorder deduplication and storage rollback. Actual native factory scenarios cover Delegate, files, timeout/cancellation and parent-budget refusal. All three type projects, circular runtime graph and environment observation checks remain required. Run only these defining/directly affected files/cases through the isolated priority launcher; no broad local suite, discovery sweep, dependency install or manual workflow dispatch is part of this source work.

Historical design/measurement records remain in [provider-host foundations](delegate-provider-host.md) and [shared reservations](shared-model-request-reservations.md), explicitly marked as retired prototypes. Original code/profile bytes remain at immutable fc587de57 Git paths. There is no production speedup, memory-leak or reclaimed-file-size claim.

## Compatibility and rollback

The removed proposal was never registered as a production API, so there is no replacement fallback or supported native execution migration. Backing storage, accepted sources, event/charge IDs, credentials, SDK histories and saved review/media data are unchanged. Reverting the source commit restores inactive source only; it needs no schema/data rollback.

This source-only change requires no deployment, restart, dependency upgrade or live-state operation. The rest of #1575 and the other #1270 children need separate acceptance.
