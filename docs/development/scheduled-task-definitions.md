# Versioned scheduling definitions

A task definition is an immutable versioned body in `host_scheduled_task_definitions`, paired with an EF-S07 admission snapshot. EF-S07 owns the current revision, status and scheduling slot. SDK tasks record execution; recurrence, occurrence identity, leases and nonrepeatable policy stay in EF-S07.

## Definition and head writes

The version1 body captures task identity, chat, prompt, command, model, declared kind, shell options, notification choice, schedule and original creation stamp. New snapshot references include its canonical SHA256 hash. Reads validate the closed body, hash, revision, reference and derived S07 configuration hash. Editing creates a new body and snapshot; it never changes an earlier revision.

`db/scheduled-task-head.ts` contains the sole head INSERT/UPDATE implementation. Every update compares the previous revision, status and slot. Canonical CRUD, direct compatibility settlement and S07 completion use it. Their synchronous SQL transaction also writes the compatibility projection. No SQL transaction spans a provider request or asynchronous callback.

`scheduled_tasks` is the compatibility/UI cache. Execution, native scheduled-conversation allocation and task inspection read the canonical version/head. Changing cache prompt, model, revision, recipient, status or next-run cannot select a different execution payload. Selected UI payloads are validated, and list metadata/counts share a read transaction. The public task facade retains its historical runtime `null` result for a missing task.

Read-only developer reports can continue to inspect the physical compatibility cache; they cannot mutate scheduling authority. Legacy `last_run`/`last_result` remain auxiliary UI evidence. New completion summaries derive from retained history or the exact S07 terminal record; caller-provided text cannot replace an admitted result. Unlinked direct execution keeps its existing summary path and is revision-fenced. It cannot advance a definition edited during execution.

## Completion and pause

Occurrence completion commits its head/decision/log/result history and task projection together. A projection fault rolls back the whole frame. A lost acknowledgement can replay the same closed request to repair the cache without executing the task or advancing the head again. An old revision may settle as superseded; it cannot move the current head.

Paused heads retain their held occurrence slot. The exact paused next-decision for that slot supplies the visible successor. Resume selects that successor once; a one-shot with no successor becomes completed. A partial index supports this lookup. Terminal cleanup retains that decision while the current paused revision/slot references it, even if result bytes are lost. Resume, edit or deletion releases this reference hold. No scheduler policy moves into the UI cache.

## Upgrade and unavailable history

Owned migration `host.scheduled-definitions / versioned-payload-v1` creates the body table and paused-successor index. Its checksum is `0e14073a0e90dcd92be152464e52faf4604777f2e6f6b1d75e88d3f894cfeb31`. Schema, initial capture and receipt commit in one transaction. Unowned/partial shapes, changed receipts, temporary shadows or conflicting current metadata fail without adoption.

The old system retained only the mutable current prompt/command. Upgrade captures those bytes for the matching current revision with `origin=legacy_current` and an explicit capture time. That capture cannot prove what an earlier execution used. Older bodies remain `unavailable`, with their original snapshots/references/configuration hashes unchanged. Freshly authored versions use `origin=authored` and hash-bound references.

Reopen never recaptures from `scheduled_tasks`. Missing or corrupt canonical bodies fail closed. Rebuilding metadata cannot reconstruct a lost prompt from a current cache row or opaque reference. Generic isolated S07 compositions can omit this host component; partial host state fails.

## Moves, deletion and retention

Chat merge/rename creates a new definition revision with the new recipient. Old revisions and accepted sources retain their original chat/hash. Linked chat identity updates keep foreign-key enforcement enabled and defer validation to the atomic rename commit; an unmoved reference rolls the whole move back.

Explicit task deletion, archived-branch purge and the existing completed-task cleanup route through the definition owner. They retire executable body bytes, remove the task UI/history as before and preserve S07 heads/revisions/tombstones. No age-based pruning or new retention schedule is added. General retention belongs to #1702.

Archived-session downloads add `scheduled_definition_revisions`, including body availability/origin, retained bytes/hashes and exact S07 revision snapshots. No importer or automatic restore/replay is introduced. Result-history repair still follows the separate closed-completion evidence rules in [scheduled-result-history.md](scheduled-result-history.md).

## Backup and rollback

The body table, receipt, head, snapshots and result history live in the main SQLite database and follow its existing verified backup path. No sidecar payload store or profile migration is added.

Restore a validated, mutually consistent database/runtime checkpoint. An executable-only downgrade after new definition edits cannot maintain the body model and is unsupported. Do not remove the new table or migration receipt to force recapture. No deployment, live schema action, backup replacement or runtime rollback is performed by this source change.
