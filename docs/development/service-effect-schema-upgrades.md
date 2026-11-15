# Service-work and outbox schema upgrades

The EF-S01 and EF-S05 installers apply separate checksummed steps through the existing `piclaw_schema_migrations` ledger. Each installer owns an atomic transaction or nested savepoint; a caller catching setup failure can commit unrelated work without retaining partial DDL or receipts.

| Owner / step | Schema invariant |
| --- | --- |
| `service_effect_s01` / `exact-queued-source-membership` | Queue membership references the complete `(chat_jid,operation_id,source_seq)` tuple. |
| `service_effect_s05` / `certainty-state-nullability` | Certainty is NULL only for started delivery, and non-NULL for every other delivery state. |

Both steps have order 1. SQL/checksum changes require a new migration identity. Accepted source IDs, sequencing, idempotency keys, payload bytes, outcomes, decisions and historical receipts retain their existing owners.

## Queue membership

`service-work-schema.ts` adds a unique tuple index to `operation_sources`, retaining its existing keys and scheduler dependants. It rebuilds only `queued_inputs`, preserves its six fields and implicit rowids, and adds the complete FK alongside the existing constraints. A separate nonunique `(chat_jid,source_seq)` index serves the real ownership lookup.

The setup preflight accepts only the recognised historical/final queue and parent definitions. Cross-operation historical memberships, invalid rows, scratch-name collisions, custom queue indexes/triggers and incoming queue FKs fail before mutation. Parent objects and rows are retained; the parent table is not rebuilt. Metadata comparisons follow SQLite's case-insensitive identifier rules, including mixed-case FK target names.

The existing API source/admission guards remain required. The tuple constraint adds database defence against direct-SQL misassignment; it grants no execution authority.

## Delivery certainty

`service-outbox-schema.ts` retains the original allowed-value and state-shape checks and adds an explicit certainty-presence CHECK. It never derives or invents whether an external effect happened. Historical invalid certainty fails the bounded preflight and leaves the original table and receipts unchanged.

The rebuild copies all 28 columns and implicit rowids, retains the same table name, and recreates the six owned outbox indexes. Leases, outcomes, resolutions, decisions and incoming links remain unchanged. Unknown table shapes, custom dropped objects, scratch collisions and unsafe incoming FK actions fail closed. Mixed-case CASCADE/SET NULL references are rejected before their implicit delete could change children. NO ACTION references are preserved, including scheduler and terminal-settlement links.

Foreign-key enforcement stays ON. A pending step requires valid FKs in every attached database, including main and temp. The installer temporarily defers checks while replacing the same-name parent. After the copied table, indexes and receipt exist, it checks all those databases again. Only then does it clear SQLite's deferred-DROP bookkeeping before completing the savepoint/transaction. It restores the caller's deferral flag after success or rollback. An unrelated pre-existing deferred violation rejects setup without clearing that violation; a caller catching the error still cannot commit invalid data.

SQLite's ALTER TABLE can allocate its empty internal temp namespace during a rebuild. Native qualification still requires the same sole persistent main file, forbids other attachments and verifies that any temp namespace is empty. Validation of an already-migrated, reopened main-only connection does not allocate temp merely to inspect it.

Already-applied steps keep their receipts and validate the recognised shape. Unsupported historical variants require an explicit reviewed migration; setup has no best-effort rewrite or data-discard path.

## Regression checks

`service-work-schema-upgrade.test.ts` and `service-outbox-schema-upgrade.test.ts` use disposable databases and frozen historical definitions. They cover direct-SQL constraints, actual ownership-query plans, fresh/upgrade parity, byte/rowid/history preservation, reopen/idempotence, malformed rows and unexpected objects. Faults after create/copy/drop/rename/index/receipt work verify complete rollback, including caught failures in outer transactions. Mixed-case destructive FK tests reproduce the preflight bypass before the corrected identifier comparisons.

Existing service-work, outbox, scheduling, terminal-settlement and native steering/recovery contracts remain required. No table or historical write path is retired. These source changes authorise no live database, restore, deployment, configuration or restart action.
