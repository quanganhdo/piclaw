# Retired steering timestamp mirror

The unconsumed per-chat steering timestamp map and its private forwarding APIs are deleted under #1279. Native accepted-source/intent stores still own steering. No timestamp queue, adapter, status banner or fallback replaces the mirror.

## Caller and ownership decision

Implementation base: `c637741fba10cb92f3d38d01b8be6d18f1c6ed43`.

`PendingSteeringStore` retained only timestamps in an unbounded process-local map. Its real reader retired with legacy prompt/finalisation sequencing under #1673/#1674. Current tracked Core/private-engine/script/package/dynamic-registration and approved ad7 add-on inventories find **no production reader** beyond definitions forwarding to that same map.

One current writer remained in `handleAgentQueueSteer` after host acceptance/materialisation. Its only effect was appending an unused timestamp; it did not own accepted input, provider placement, recovery, cancellation or display state. The writer callback, prototype/type declarations and forwarding methods now disappear with the map.

Before private append path:

`control-plane callback → WebChannel prototype → runtime public surface → follow-up facade → runtime state → PendingSteeringStore.queue`.

After: no timestamp append path (**6private stages→0**). The unused consume path is also absent. One map/owner1→0, one production module removed, ten queue/consume-family methods/descriptors removed. The surrounding services remain for their actual other callers; no class-level retirement is claimed for them.

The native path stays: captured `getAcceptedQueuedSteering` port → existing accepted-source/intent coordinator → existing publication/deferred delivery. `agent_followup_removed`, `new_post`, `agent_steer_queued` ordering and 201/pending response remain. Trusted host/source selection, immutable IDs/digests, foreign/sibling queues, frontier, fencing, lost ACK/publication handling and no-replay/cancellation boundaries stay. The removal performs no database/schema/cursor mutation.

The internal WebChannel queue/consume timestamp names are deliberately retired. They are not HTTP endpoints or an installed add-on API. Approved add-ons have no consumer; arbitrary unsupported external deep imports were not observable and receive no compatibility shim.

## Measure and checks

Stable #1270 metric: **144,517→144,440 physical**, **134,115→134,048 nonblank**, **712→711files**: **−77physical/−67nonblank**,0added/77deleted production lines across seven files. No relocated/replacement implementation or outside-root production addition. Tests/docs/type-only cleanup and prior #1673/#1674 deletion supply no independent credit. [Machine receipt](receipts/retired-steering-timestamp-mirror-1279.json).

Defining guard fails against the old module/prototypes. A real accepted-steering regression also fails when the old writer callback throws; afterward a forbidden property getter stays untouched while all source/intent/wire assertions pass. No successful request depends on a timestamp append.

Only map-only tests and exclusive delegation/call-trace expectations retire. Other queue/status/buffer/resume assertions remain unchanged. Public steering tests replace old empty-mirror reads with API-absence checks; input/cursor/source/row/publication assertions remain. The old timestamp-injection test now verifies persisted input ordering without that irrelevant injection. Negative starting-turn/queue side-effect oracles stay; no production stub is retained for them.

Focused evidence:40cases/323assertions across six defining/directly affected files; public WebChannel steering/order18/274; starting-turn/race10/87; malformed payload6/44. Actual native factory `native-routing-queued-race`1/29 and `native-events`1/182 pass. Three source type projects and strict new regression types pass. Circular runtime graph546→545 reachable/0cycles, env observations and scoped package checks pass; retired file absent and real steering/source/controller owners remain packaged. General import checker still reports25byte-identical pre-existing findings, not green; no rule, exemption or safety assertion is relaxed.

## Remaining lifetime work and rollback

Runtime-state status-expiry timers, provider-usage listeners and AgentPool interop/SSH callbacks still need explicit owner disposal/fencing. Their current real consumers remain; necessary net-positive safety repairs must be recorded and charged separately. This deletion is one bounded #1279 slice and does not finish that child or #1270.

Reverting restores only an unused in-memory mirror. Accepted inputs, source IDs, intent receipts, SDK history, queues, grants, accounting and recovery data require no rollback. Source-only: no installation/restart, dependency upgrade, live state/configuration/credential operation, retention/backup/restore action or branch/worktree cleanup. Automatic CI, author review, authorised merge and final exact-head acceptance remain integration requirements.
