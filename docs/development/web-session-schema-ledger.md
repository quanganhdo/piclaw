# Web-session schema ledger

Startup uses the existing column verifier and owned migration ledger for the stable web-session identity index. It deletes two bespoke ensure helpers and the redundant standalone ledger-creation call. No migration framework, schema table or wrapper is added.

## Selected schema and baseline

Implementation base: `93ce455ced4e0a4f43f98c6e9f5f99293d6cc3d3`. The login identity/index first appeared in `19c2377b7` (`feat: resolve request principals and expose account identity`). The index is an existing additive core step; no product feature is invented for #1274.

The compatibility bridge accepts the known nullable `TEXT` columns `auth_method` and `session_id`. Representative historical states have neither column, only one column, both without the index, or the canonical index already applied. Fully upgraded fixtures also preserve the independent auth-label schema and populated login identifiers. Existing bearer bytes, user IDs, expiry/creation values and login IDs do not change; absent columns receive nullable values.

The stable index uses existing `applyOwnedMigrations` records:

| Field | Value |
| --- | --- |
| Owner | `host.web-sessions` |
| ID | `session-identity-index-v1` |
| Order | `1` |
| SQL | `CREATE UNIQUE INDEX IF NOT EXISTS idx_web_sessions_session_id ON web_sessions(session_id) WHERE session_id IS NOT NULL` |
| SHA-256 | `a897363051c4d0ba030a53e4300de051bc82d67dca917fb5d8a4791a913c2ad8` |

An absent index is created transactionally. A recognised already-applied index acquires its first receipt without changing rows. Replay preserves checksum, order and original timestamp and skips the indexed DDL. SQL text is immutable once recorded; a future change needs a new migration identity.

The actual index must match the canonical historical declaration, ignoring SQL case and repeated token whitespace. Unknown non-unique, wrong-column or wrong-predicate definitions fail without a new receipt. An index removed after its receipt is applied fails validation; startup does not silently repair out-of-band schema changes. Alternative manually authored index definitions are not automatically adopted or repaired.

## Removed paths and retained checks

Before: `initializeSchema → ensureWebSessionColumns` and `initializeSchema → ensureWebSessionIdentity`, each inspecting the same selected columns independently. After: `initializeSchema → ensureLegacyColumns` for both columns and the existing owned applier for the index, followed by its actual-schema postcondition. **Two bespoke helpers→0; two selected column probes→1 on already-upgraded startup; index DDL replay1→0.** No new forwarding function replaces them.

The independent `initializeAuthLabelsSchema` probe remains: it owns human labels for sessions and passkeys. The selected-probe count excludes that distinct existing schema purpose. Older schemas may need additional post-ALTER reads to prove column shapes; no total-query or startup-speedup claim follows.

`ensureLegacyColumns` retains its existing bounded type/nullability/default/PK/hidden checks and failed-ALTER verification, now for the selected web-session table too. A missing/wrong column stops initialization instead of continuing after an unverifiable failure. This fail-closed change and the index postcondition are explicit correctness work within the net-negative slice.

The outer `initDatabase` IMMEDIATE transaction still owns the ordered schema batch. Nested migration calls remain savepoints. A later column/index/receipt failure rolls back prior DDL and new receipts; the caller's FK policy is restored on success and failure. Root/SDK/scheduler connection roles, pragmas, checkpoint lifetime, FTS/media markers, legacy/SDK ledgers, maintenance and VACUUM stay unchanged. `retireAttachmentRowidIndex → applyOwnedMigrations` already creates the ledger on successful startup, so the earlier standalone ensure is redundant; its existing identity/shape guards remain.

New stable core schema steps use the existing ledger. The selected column bridge remains for pre-ledger databases; retiring it requires ending or explicitly importing those historical schemas. It is not a generic repair/fallback mechanism. Unselected family, scheduler and legacy migration owners are untouched.

## Evidence and measure

Production: **146,065→146,054 physical**, **135,578→135,569 nonblank**, **716files unchanged**: **−11physical/−9nonblank**, 17 additions/28 deletions across two production files. No relocated/replacement implementation or production additions outside the roots. Supporting type/comment changes have zero metric delta; tests/docs supply no production credit. [Machine receipt](receipts/web-session-schema-ledger-1274.json).

The original defining13cases fail before the source change. Final17cases cover all five historical column/index states, populated identity/bearer preservation, FK-enabled replay, selected probe/DDL replay, incompatible columns, ALTER rollback, three unknown index definitions, missing applied index, checksum/order mismatch and an actual verified owned backup/restored ledger replay. The full-row fixture initially omitted the independent `label` column; that failed receipt is retained. The corrected fully-upgraded fixture includes it and strengthens duplicate-ID failure to the exact unique-constraint error; assertions/timeouts/guards are not relaxed.

Automatic CI40779132244 exposed one stale auth-cache fixture after 7,145 host passes: it dropped/rebuilt the session table but omitted the already-owned index, so startup correctly refused the inconsistent schema. The same explicit file reproduces the failure locally. Its replacement-table setup now rebuilds the canonical index too; all cache/revocation/expiry/reopen assertions and timeouts are unchanged. Cache plus all17migration cases pass18/75. The negative missing-owned-index case still rejects; no production guard or repair path changes.

Existing connection, legacy-column, ledger and principal cases cover live-database refusal, stale handles, compatible races, nested/competing transactions and account isolation. Selected disk startup fixtures preserve fresh/empty/existing state, late rollback, WAL/FULL/secure-delete/FK settings, FTS rows and VACUUM separation. Verified-backup/storage cases preserve committed WAL and migration metadata. Tests use only owned synthetic databases through the filesystem-isolated priority launcher, with explicit files/cases.

All three source type projects, strict new-test compilation, actual default-factory `native-events`, circular dependencies, environment observations and scoped package checks pass. General import checks still report25 unchanged pre-existing findings, not green; no rule, exemption or safety assertion is changed.

## Rollback and operational boundary

The ledger already exists; this adds only an owned receipt for the existing index. Old software can still read the same columns/index and ignores the new owner row. Do not delete the receipt or alter its historical SQL to roll back code. Supported tokens/data and SDK history require no rewrite. Unknown schema/receipt states need separate operator review.

This source-only change performs no live migration, backup/restore promotion, data deletion, dependency upgrade, installation or restart. Required repository CI, author review, authorised merge and final exact-head acceptance remain integration steps. Prior #1699/#1700/#1701 correctness work receives no duplicate deletion credit.
