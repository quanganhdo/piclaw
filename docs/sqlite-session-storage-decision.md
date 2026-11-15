# Historical SQLite archive-layout decision

Native Harness execution uses the application database. The prototype described below is retained archive-layout evidence, with its original measurements and decision preserved. Its implementation now lives in `runtime/scripts/lib/sqlite-session-archive.ts`; it owns imported JSONL bytes/search/export, not native execution. The separate `sessions.db` rule applies to the explicit archive importer. See [current import and archive boundaries](development/legacy-import-and-archive-boundaries.md).

## Original prototype decision

Piclaw should use a dedicated `sessions.db` if session persistence moves from JSONL to SQLite. The session store can share Piclaw's SQLite connection, migration, backup and disposal mechanisms without sharing `messages.db`.

This decision selects a file boundary. It does not approve a production cutover. JSONL remains the session source of record in this change.

## Tested layouts

The prototype uses the same namespaced schema in both layouts:

- `piclaw_agent_sessions` records one immutable JSONL import, source path, SHA-256, byte count, trailing newline state, header and active leaf.
- `piclaw_agent_entries` stores entry order, IDs, parent links, raw JSON and a bounded text projection.
- `piclaw_agent_entries_fts` is an external-content trigram FTS5 index.
- `piclaw_schema_migrations` records owner `piclaw-agent-sessions`, order and checksum.

The unified layout adds these objects to a verified copy of `messages.db`. The separate layout puts them in `sessions.db`. Both use WAL, `synchronous=FULL`, `busy_timeout=5000`, immediate migration/import/append transactions and once-only close/drain behaviour.

## Production-copy evidence

The completed benchmark used the 40 largest valid session files. They represented 379,050,096 bytes, or 74% of the 510,866,217-byte valid corpus. The source `messages.db` snapshot was 554,676,224 bytes. Raw evidence is in [sqlite-session-layout-benchmark.json](evidence/sqlite-session-layout-benchmark.json).

| Operation | JSONL p50 | Unified p50 | Separate p50 |
|---|---:|---:|---:|
| Startup/header scan | 363.22 ms | 114.75 ms | 90.24 ms |
| Branch read | 33.93 ms | 30.68 ms | 30.40 ms |
| Compacted branch read | 33.94 ms | 22.28 ms | 20.85 ms |
| Search | 91.03 ms | 302.78 ms | 307.39 ms |
| Durable append | 11.11 ms | 11.32 ms | 11.30 ms |
| Shutdown drain | n/a | 0.28 ms | 0.84 ms |
| Import RSS delta | n/a | 47.8 MB | 15.9 MB |

The SQLite prototype stored 379.1 MB of source as an 830.8 MB separate session database. A unified database occupied 1,382.9 MB; `messages.db` plus `sessions.db` occupied 1,385.4 MB. The 2.5 MB difference does not justify coupling the domains.

Search results are not directly comparable as a product benchmark. SQLite searched the shared text projection across every imported session. The JSONL baseline parsed and scanned one selected file. The result establishes that the prototype has no search-performance basis for replacing JSONL.

## Fault evidence

The benchmark used disposable copies only.

- A held `BEGIN IMMEDIATE` lock produced `SQLITE_BUSY` after the configured timeout and left the append transaction unchanged.
- A child process killed with an uncommitted WAL transaction left no row after reopen.
- A failed migration transaction left no partial table.
- Truncating `sessions.db` caused integrity verification to fail while the source timeline snapshot remained `ok`.
- Truncating the unified database made both timeline and session data unavailable.
- A timeline writer blocked a unified session append. The same timeline writer did not block a separate `sessions.db` append.
- `VACUUM INTO` produced a verified session snapshot, and a copied restore passed `PRAGMA integrity_check`.

## Rejected unified database

A unified database provides one snapshot and one connection owner. Namespaces and the owner-scoped ledger prevent ordinary schema collisions.

The measured costs are larger:

- every timeline and session writer shares one WAL writer lock;
- corruption, restore and operator error affect chat history, media, tasks, credentials and session state together;
- session-only rollback requires restoring the application database;
- one process carries timeline and session page caches;
- it saves about 2.5 MB on the measured 1.38 GB combined footprint.

The separate layout keeps those failure and maintenance boundaries independent while reusing the same mechanisms.

## Corpus limits

Preflight inspected 1,350 `.jsonl` files. It found 482 legacy files containing NUL bytes, totalling 1,010,914,986 logical bytes, and one valid-JSON file with a legacy `session_header` record. The importer rejects these files and does not normalise or overwrite them. Aggregate evidence is in [sqlite-session-corpus-preflight.json](evidence/sqlite-session-corpus-preflight.json).

Three attempted all/stratified-corpus benchmark processes exceeded this container's 4 GB memory limit after producing both large database copies. Those attempts did not touch live data. The completed largest-file benchmark keeps the working set within the container and records operation/fault evidence. Production approval requires a dry run on the target host with one selected `sessions.db`, not simultaneous unified and separate copies in one process.

## Earendil compatibility probe

The non-shipping probe used Earendil main commit `583f153d502aa8e958eefdb9af0fbd3344e68f95`.

Shared mechanisms:

- WAL, `synchronous=FULL` and a 5,000 ms busy timeout;
- transactional append and active-leaf updates;
- parent-chain branch reconstruction;
- trigram FTS5;
- async store ownership and explicit disposal.

Deliberate incompatibilities:

- Earendil's unnamespaced `sessions`, `session_entries`, materialised state, branch cache and global `migrations` tables are not copied into `messages.db`.
- Piclaw import identity includes source path and permits repeated logical session IDs; Earendil requires one canonical session ID.
- Piclaw preserves raw JSON, missing timestamps and unknown legacy entry types; Earendil validates canonical typed entries.
- Piclaw's prototype indexes bounded user-visible text. Earendil indexes full payload JSON.
- Earendil supports `retainedTail`; Piclaw 0.83 JSONL compaction uses `firstKeptEntryId` in this prototype.

The mechanisms are compatible behind the session persistence port. The schemas are not interchangeable, and Piclaw does not add an Earendil-main dependency.

## Migration approval gates

A production migration needs separate approval and must meet every gate:

1. Keep `@earendil-works/pi-agent-core`, `pi-ai` and `pi-coding-agent` on the same exact reviewed version. The former `0.83.0` pin was superseded by the reviewed `0.84.0` upgrade; a storage migration must not change these dependencies independently.
2. Run importer `--dry-run` and retain the source inventory and malformed-file report.
3. Use a dedicated target such as `/workspace/.piclaw/store/sessions.db`; refuse unrelated tables.
4. Take and verify a `VACUUM INTO` backup before writing an existing target.
5. Import copy-only, one source file per immediate transaction. Preserve every JSONL byte and modification time.
6. Verify source SHA-256, byte-identical export, row counts, branch reads, FTS identity and `PRAGMA integrity_check`.
7. Keep JSONL authoritative and runtime reads on JSONL during a soak period.
8. Test restart, WAL recovery, busy timeout, backup and restore on the target host.
9. Roll back by disabling the opt-in SQLite reader and retaining or restoring `sessions.db`; do not alter JSONL.
10. Roll out to one non-critical instance, then an approved subset, then the full active fleet. Record excluded or decommissioned hosts.

No automatic destructive cutover is part of PR C.
