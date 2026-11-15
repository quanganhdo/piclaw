# Pool and provider-listener owner fencing

AgentPool releases its selected global model/SSH registrations only after confirmed session-resource shutdown. Web broadcast owners release their selected provider listener. Older owners cannot clear replacements. This is #1279 safety work with **net production growth and zero reduction credit**.

## Selected registrations

Implementation base: `e96285de1f83f2cd5921c1ef6453c9209a14e671`, the separately measured web-observation hook repair.

- Pool-capturing `getModelRegistry`, `streamSimple`, `getSessionId` and `getScopedModels` callbacks retain their supported standalone add-on behavior while the owner lives. Their release checks each exact installed function before deleting that key from the captured bridge object. It never deletes the whole interop object or another pool's replacements.
- Common chat/channel/log/KV/keychain functions remain. `hasKnownModelCost` is a filesystem provenance helper built from an agent directory, not a Pool closure or open resource; it remains available and a newer pool can replace it. The uncertainty/invalid-pricing guards in that helper are unchanged.
- SSH setter registration returns an idempotent handle with a local generation fence, including reused handler objects. No SSH policy, credentials, connection execution or status-hint payload changes.
- Provider-usage setter/AgentPool forwarding returns a generation-fenced handle, including reused callbacks. The current broadcast service keeps that handle and disables only its notification callback on disposal. An already-captured old notification cannot publish or record an event after disposal. The gateway still owns transport/UI cleanup.

A held or failed Pool resource join retains its selected model/SSH registrations. Only successful completion releases them; older-pool shutdown after replacement leaves the current pool intact. No native effect is retried or cancelled by unregistering a callback. Already-owned work retains its existing resource references and uncertainty boundary.

The constructor passes the exact broadcast owner to the existing gateway. The gateway joins startup/entered requests, then releases this notification registration in its existing independent cleanup sequence before closing transports. New-owner same-pool listeners, SSE/UI delivery, `model_changed` wire shape, async refresh caching/credential provenance and input/execution/accounting authority remain.

## Measure

Stable #1270 source: **144,442→144,474 physical**, **134,052→134,083 nonblank**, **711files unchanged**: **+32physical/+31nonblank**,42added/10deleted production lines across six files. Charge this necessary safety growth in the child/epic totals. **Zero reduction credit**; no relocation or outside-root production implementation. Earlier log/mirror/context/hook work is not counted again. [Machine receipt](receipts/pool-listener-owner-fencing-1279.json).

The implementation adds no generic registry/lifecycle adapter. Existing setters gain owner-local release handles; the bridge keeps explicit selected keys. All retained functions have real current callers or an explicit shared, non-Pool resource purpose.

## Evidence

All five defining cases fail before code. Afterward real Pool/Facade/SSH/broadcast scenarios verify overlapping old/new pools, double shutdown/release, current registry/stream behavior, selective key teardown with common capabilities retained, held and failed joins retaining ownership, confirmed release, reused handler/callback fencing, and ignored captured old provider notifications. Constructor identity and gateway drain-before-release assertions cover the actual owner wiring.

Focused evidence:17cases/144assertions across owner/SSH/broadcast/constructor/hook fixtures; corrected strict fixture types and a later focused subset12/132 pass. Existing standalone add-on access1/10, cold provider refresh1/2 and public broadcast routing/surface2/7 pass. The first strict fixture run rejected a partial SSH mock and optional fixture-service types; the fixture now uses a full typed SSH record and explicit known non-null fixture services, without suppressing production diagnostics. All original assertions remain.

Three source type projects pass. Actual native events1/182 and close/reopen recovery1/22 pass. Graph545/0cycles, env observations and package checks pass. General import checks remain25byte-identical pre-existing findings, not green; no rule, exemption, timeout, failure or safety assertion is relaxed.

Initial CI40795204793 correctly rejected an empty promise catch in the new test cleanup. The same static check reproduces it locally. Cleanup now joins every Pool shutdown with `Promise.allSettled` and propagates any failure as an AggregateError after resetting the SSH fixture; it cannot conceal a failed join. The unchanged silent-swallow guard reports0/0 and all five cases/30 assertions plus strict fixture types pass. No production code, rules or assertions change for this correction; failed receipts remain.

## Rollback and scope

Reverting restores missing unregister behavior; no schema/data rollback is needed. Owned raw cleanup failures still cannot certify release or trigger replay. No auth, budget, source/grant IDs, SDK history, terminal-publication or resource-uncertainty policy changes.

This source-only repair performs no installation/restart, dependency upgrade, live state/configuration/credential operation, retention/backup/restore action or branch/worktree cleanup. CI, author review, authorised merge and final combined-head acceptance remain required before #1279 completion. This safety patch cannot close #1270 by itself.
