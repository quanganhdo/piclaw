# Web observation owner disposal

Pre-shutdown registrations now return idempotent release handles. The selected runtime-state service unregisters its own hook and clears its actual status-expiry timers when its web owner stops. This is #1279 safety work with **net production growth, not reduction credit**.

## Selected owners

Original implementation: `6486b230d16f85ce0efa88dd11e00ee33f647ada`. Final integration base: `bb0a5012ad53317ad79df750c87f6eec14863555`, after the separately reviewed timestamp mirror and database snapshot merged. Their deletions are not counted again.

The existing pre-shutdown set stores one small registration entry per call. Releasing an entry cannot delete another owner's registration even when both use the same callback. The existing once-per-process gate and concurrent start-before-await ordering remain. Unregistering cannot cancel an already-started cleanup or cause replay; no new registry framework, shutdown adapter or deadline is added.

`WebChannelRuntimeStateService.dispose` is idempotent. It clears the selected store's real process-local timers before unregistering and marking the instance disposed. Failed local cleanup retains its hook and does not certify disposal; the owning cleanup path can try that local cleanup again. It does not retry native effects. Late status writes and resume requests on a disposed owner cannot create another timer/wakeup or query disposed native observations.

The constructor factory passes its exact runtime-state instance to the existing server gateway. The gateway still seals admission and joins entered work/startup before cleanup. Its existing independent cleanup sequence disposes that instance while preserving transport/terminal/VNC/watcher/socket failure aggregation and uncertain-close behavior. Standalone gateways without a runtime-state resource keep their supported form.

The two policy-free resume-context factory methods disappear. Their actual helpers, injected callbacks, live assistant identity, receiver binding, null-thread handling, recovery delay and queue keys remain. The unused cursor callback/dependency registration also disappears; the state service never called it. Accepted stores and SDK tasks retain input/execution authority.

## Measure

Stable #1270 source: **144,438→144,442 physical**, **134,047→134,052 nonblank**, **711files unchanged**: **+4physical/+5nonblank**,41added/37deleted production lines across four files. The context/dependency cleanup is included in that measured total. This PR earns **zero reduction credit** and its growth must be charged in the final child/epic totals. No implementation is relocated outside the roots. [Machine receipt](receipts/web-observation-owner-disposal-1279.json).

AgentPool interop/SSH and provider-usage listener ownership remain separate #1279 work. The old log timer was already removed under #1673; it is not recreated. The earlier #1279 control/mirror deletions supply their own independent reduction evidence.

## Tests and retained guarantees

Four original cases fail before code. Five isolated subprocess scenarios cover same-callback overlapping registrations/old-owner release/double release; started cleanup with independent later hooks/no replay; real status timer disposal and same-chat new-owner preservation; gateway drain-before-dispose/double stop; and failed local cleanup retaining ownership until success. Disposed owners reject late observations/wakes. No live Piclaw exit or runtime state is used.

Focused owner/state/constructor/gateway/native-projection tests pass47cases/320assertions; shutdown admission/join/deadline3/13; auth maintenance2/9. The callback receiver/null-thread regression and actual constructor ownership-pointer assertion preserve the removed context/dependency seams. Three source type projects and strict new fixture types pass. Actual native events1/182 and close/reopen recovery1/22 pass. Graph545reachable/0cycles, env observations and package checks pass. General import checks remain25byte-identical pre-existing findings, not green; no rule, timeout, failure or safety assertion is relaxed.

The process-wide deadline still arms before extensible hooks. Failed admission/uncertain joins do not certify release or dispose potentially live native resources. No auth, budget, accepted-source, accounting, grant, SDK history or terminal-publication contract changes.

## Rollback and scope

Reverting restores missing unregister/disposal behavior; no schema/data rollback is needed. This source-only work authorises no installation/restart, dependency upgrade, live state/configuration/credential operation, retention/backup/restore action or branch/worktree cleanup. CI, author review, authorised merge and final exact-head acceptance remain required. This partial safety slice does not complete #1279 or #1270.
