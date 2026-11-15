# Native cursor storage

`chat_cursors` stores polling acknowledgements and queued payloads. EF-S01 owns accepted-source membership/frontiers; SDK tasks own execution. A polling timestamp grants no execution, cancellation or continuation authority.

## Field ownership

Inventory against `fc16a0c51d76b7200e263997619d434609afa043` for #1691:

| Fields | Authority and current treatment |
| --- | --- |
| `chat_jid`, `cursor_ts` | Host polling/delivery position. Retained. Native terminal settlement precedes acknowledgement; a lost acknowledgement must not repeat SDK execution. |
| `queued_followups_json` | Host queued payloads and provenance, including immutable source identity and acceptance metadata. Retained byte-for-byte by migration. It is separate from EF-S01 accepted-source membership. |
| `preflight_prev_ts`, `preflight_message_id`, `preflight_started_at` | Retired Core pre-prompt owner. No native reader/writer. Historical message-ID presence can refuse an explicit legacy capture. |
| `inflight_prev_ts`, `inflight_message_id`, `inflight_started_at` | Retired Core prompt/crash-retry owner. No native execution reader/writer. Historical message-ID presence can refuse an explicit legacy capture. |
| `failed_prev_ts`, `failed_ts`, `failed_message_id`, `failed_thread_root`, `failed_created_at` | Retired Core retry/model-switch owner. No native reader/writer. Preserved as historical evidence. |
| `compaction_active_started_at`, `compaction_active_reason` | Retired Core compaction phase owner. No native reader/writer. Preserved as historical evidence. |
| `auto_compaction_window_ordinal`, `auto_compaction_baseline_tokens`, `auto_compaction_prefill_tokens`, `auto_compaction_success_count`, `auto_compaction_warned_count`, `auto_compaction_updated_at` | Retired Core compaction-window owner. No native reader/writer. Preserved as historical evidence. |
| `compaction_failure_count`, `compaction_last_failed_at`, `compaction_backoff_until`, `compaction_last_error` | Retired Core compaction-backoff owner. No native reader/writer. Preserved as historical evidence. SDK compaction/retry policy is independent. |

The removed cursor APIs previously produced/read these exclusive legacy records. Their active callers were retired by #1670–#1675. Native input, status, model selection, queue handling and settings no longer import these APIs. Historical decoders are not execution owners.

[Native operation binding](native-operation-binding.md) documents EF-S01 mirror retirement and the retained admission, cancellation, terminal-delivery and ownership authority. Cursor position remains independent of those invariants.

## Owned schema transition

`runtime/src/db/chat-cursor-storage.ts` installs owner `host.chat-cursors`, order 1, through the existing checksum ledger:

- `polling-frontier-v1`: fresh three-column storage; creates no obsolete fields or archive.
- `native-frontier-v1`: recognised historical storage with queued payloads.
- `native-frontier-prequeue-v1`: recognised historical storage without queued payloads; the new queued field is SQL NULL.

Historical upgrades rename the original table to `host_legacy_chat_cursor_state_v1`, create minimal active storage and copy rowids, chat identities, polling positions and queued bytes in the same writer transaction as the receipt. Every original historical column/value remains in the archive. The archive has no application writer after this transition.

Recognition covers finite physical generations from `c8c502cd4`, `79f2a7b52`, `44d036256` and `35e443fc6`, the additive backoff columns introduced by `3fbe834cc`, and their pre-queue variants. Partial field groups, unknown constraints/columns/indexes, dependent views/triggers/foreign keys, temporary shadows and unreceipted archives refuse the transition. Recognition preserves quoted tokens and string literals, matching the schema inventory. Case-insensitive SQLite identifiers are checked before DDL.

The complete S01 owner generation includes eight `operation_*` fields and two exact legacy ownership guards. Its separate `native-frontier-s01-owner-v1` transition removes those two guards atomically with archival and the receipt. Every operation field remains in the historical table. Missing or modified guards, partial operation groups and other dependencies refuse migration; archived operation values grant no native execution authority.

A receipt replay validates the selected transition, exact checksum/order and current/archive shapes. It preserves receipt timestamps, unrelated owners' receipts and subsequent polling/queue updates. Copy, receipt and caller-transaction failures roll back together.

The schema inventory declares the minimal active shape and finite archive variants. Its previous active fingerprint remains available for read-only inspection of historical backups. No inventory rule is relaxed.

## History, malformed data and rollback

Migration does not parse queue JSON or reinterpret marker timestamps/errors. Malformed queued bytes, NULLs and original field types remain evidence. Existing queue-reader validation remains unchanged; migration never converts malformed data into accepted input or a scheduling grant.

Only explicit legacy-capture quiescence checks may inspect archived preflight/inflight message-ID presence. They can refuse capture; they cannot clear markers, rewind a cursor, resume a prompt or certify native execution. Normal native startup/dispatch does not consume this evidence.

The archive and migration receipts are not a complete rollback/backup unit. Preserve the existing complete-unit backup/recovery obligations. An older binary may recreate retired columns; subsequent startup refuses that drift rather than overwriting evidence or silently reapplying retirement. Binary rollback, archive restoration, pruning, live DDL, installation and restart require separate operational authority. This source change performs none of those actions on production storage.

## Qualification

Focused tests cover fresh/owned upgrades, original rowids and every retired field, malformed queues, pre-queue roots, receipt replay/drift, nested/receipt-failure rollback, unknown dependencies and case-folded shadows/foreign keys.

The populated file-based schema fixture verifies core ownership, original historical cursor/session records, CLI read-only inventory and exact receipt/data preservation across close/reopen. Native startup ownership is qualified with approved add-ons absent and present.

Real SDK qualification covers settlement before polling acknowledgement, lost wait/intent acknowledgements, close/reopen, repeated startup wakeups, no repeated effects, accepted queued work and a sibling blocked by paused maintenance. Host tests retain admission, queue-order, status, model-switch, settings-history and lazy-import fences. They assert the three-column schema and unchanged historical records instead of recreating legacy execution APIs.
