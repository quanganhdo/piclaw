# Native operation binding

The SDK owns execution. EF-S01 owns host admission, accepted-source membership, cancellation and terminal delivery. S01 stores an immutable execution binding; it does not persist SDK lane, live state or watch generation.

## Authority inventory

| Field or observation | Authority and readers |
| --- | --- |
| `harness_session_id` | Immutable host runtime/session binding. Native source capture, intent recovery, cancellation, tool writes and terminal settlement check this identity against the captured host route. It does not open or select an SDK session. |
| `harness_operation_id` | Immutable primary execution handle; native callers bind the exact SDK primary submission ID. Source capture and intent/abort paths independently verify the SDK submission, `host.accepted` entry, conversation, request identity and host payload binding. |
| Former `harness_state` | Retired SDK-state mirror. Native observers use public SDK submission status, live documents, task state and committed outcomes. S01 never writes `running` or `finished` observations. |
| Former `harness_lane` | Retired scope mirror. The actual SDK conversation/run/input and exact host routing/binding establish scope. A caller-supplied lane label grants no authority. |
| Former `harness_watch_generation` | Retired observation counter. The current kernel/storage ownership lease and SDK task/generation IDs establish fencing; operation version and source membership fence host writes. The old persisted number was not a replacement owner's actual lease token. |
| Operation version, active operation and claimed sources | S01 authority. Every write and terminal transition retains its version, chat ownership, source identity/membership and cancellation checks. |
| Intent kind/payload and queued-input state | Host accepted command/materialisation protocol. These records retain request identity, membership and disposition; they cannot establish SDK execution status. |
| `queued_inputs.harness_entry_id` | Immutable external entry correlation for accepted queue materialisation. Retained as identity/provenance, not a lane, watcher or task-state mirror. |
| Admission and terminal phases | Host protocol authority. `executing` means an admitted host operation, including while SDK scheduling is paused; it does not assert that a provider is running. `settling` is the host publication boundary after committed SDK outcomes are verified. |
| SDK physical generations and tool ownership | SDK task/entry/document evidence. These records and checks remain intact, including exact model-tool, nested codemode and Delegate ownership. |
| Projection receipt epochs | Separate delivery/UI invariant. They cannot grant native execution and are not S01 harness mirrors. UI snapshot/projection retirement belongs to #1692. |

New binding requests require a nonempty primary handle and reject retired fields before SQL. The snapshot decoder retains nullable handles for historical pre-execution records; such a record cannot manufacture a valid native primary submission or authorise a write.

`starting_harness` and `suspended` remain recognised historical host phases so existing records are preserved. Native admission no longer derives a host phase from a copied SDK state enum.

## Native handoffs

`HostConversationRuntime.captureSource` reads actual SDK live run/tool records, accepted input submissions and immutable `host.accepted` entries. It verifies canonical host payload bindings and S01 source membership/version/cancellation before returning a capability. Nested and delegated calls retain their actual SDK ownership checks.

The synchronous host effect boundary checks the current kernel owner, active operation, exact binding, operation version and claimed sources before and after the write. It never consults a persisted SDK observation. An old captured capability cannot write after ownership replacement even when the immutable binding is unchanged.

Native completion first verifies committed outcomes for every claimed input without refreshing away the initial version fence. An unbound primary is bound to its actual SDK handle. `finishHarness` then performs a host-only CAS into `settling`; its binding is unchanged. The method does not finish an SDK task or copy its status. EF-S02 repeats owner, binding, version, cancellation, source and delivery checks inside the terminal SQL transaction.

Late attachments, cancellation, uncertain acknowledgement and materialisation failure retain their existing host protocol boundaries. There is no compatibility executor, second lifecycle engine or scheduling grant from migration/replay.

## Owned physical retirement

The immutable queue-membership migration remains `service_effect_s01/exact-queued-source-membership`, order 1, with its original checksum and receipts.

Order 2 selects one owned transition:

- `native-harness-binding-v1`: fresh minimal binding schema; creates no historical mirror columns or archive.
- `retire-harness-mirrors-v1`: copies original operation IDs/rowids and the three retired values into `service_effect_s01_legacy_harness_v1`, then drops only those columns from the original operations table.

The operations parent is never renamed. Existing incoming foreign keys, host rows, rowids, operation/source ownership, queue memberships, decisions and unrelated receipts remain intact. Foreign-key enforcement stays enabled. Archive creation, column retirement and the checksum receipt commit atomically; failures and an enclosing caller rollback undo the complete transition.

Preflight recognises exact old/current declarations and the matching receipt/archive variant. It refuses partial/unknown columns, unregistered dependent indexes/views/triggers, foreign keys into retired fields, temporary shadows, missing receipts and post-retirement drift. Main-only replay does not allocate a temporary database.

The read-only schema inventory declares exact new active/archive fingerprints while retaining the old active fingerprint for historical backup inspection. No wildcard ownership or relaxed verifier is introduced. Complete-unit recovery discovers native answer dependencies from host terminal-delivery records and canonical SDK input bindings; it no longer reads a copied SDK `finished` flag.

## Historical records and rollback

The archive stores original values without interpreting them as current status or permission. Historical decision JSON may retain the five-field correlation shape. Its decoder validates that exact historical form, returns only the immutable binding and preserves stored JSON, original hashes, methods and timestamps byte-for-byte. New mutations do not accept that old form.

The archive is forensic field evidence, not the complete recovery/backup unit. Preserve the existing complete-unit recovery obligations, SDK records, effect receipts and host payloads. Binary rollback, restoration, pruning and production DDL require separate operational authority. An older binary recreating retired fields causes later fail-closed schema drift; startup never silently overwrites the archive or re-adopts native state after receipt loss.

## Qualification

Focused cases cover fresh and populated file upgrades/reopen; original values, rowids, FKs and receipts; unknown dependencies and shadow names; receipt/caller rollback; preserved historical decision bytes; main-only replay; immutable binding and host phase CAS; cancellation/materialisation/terminal races; real SDK acknowledgement repair, duplicate wakes and paused-maintenance inputs; actual kernel/storage ownership replacement; and nested tool publication after binding revocation.

Legacy mirror fault cases now revoke actual binding identities. They keep the same no-effect assertions; genuine kernel-generation fencing is separately qualified against the real ownership mechanisms. No existing deadline or authority/import boundary is relaxed.
