# Versioned local-note index

Issue [#376](https://github.com/rcarmo/piclaw/issues/376) implements the derived
storage and refresh phase specified by the accepted
[local-note retrieval contract](local-note-retrieval-contract.md). It does not
register `memory_query` or `memory_get`; those remain owned by #387.

## Storage and publication

Owned migration `note-retrieval:001-versioned-chunks` creates a separate
namespace, source, chunk, FTS, dirty-path and refresh-state store. Source notes,
the message database's other owners and the existing file search tables are not
migrated or repaired by this phase.

The coordinator keeps one published generation and at most one staged successor.
Per-file rows and FTS entries are written transactionally into staging. A full,
bounded reconciliation publishes only after complete enumeration; incremental
dirty refresh copies the compatible publication and replaces only named paths.
The final pointer switch and previous-generation deletion share one immediate
transaction. Cancellation, SQL failure and supersession remove staging while
preserving the publication. Startup reclaims one crash-left generation after
checking that its writer PID is no longer live; cleanup failure blocks a successor.

Content limits follow the contract: 512 KiB/file, 16 KiB/chunk, 128 chunks/file,
2,000 files, 32 MiB source and chunk content, 16,384 chunks, 20,000 directory
entries, depth 16 and 30 seconds of cooperative work. A limited walk does not run
a deletion sweep. One staged and one published generation bound logical content
to 64 MiB. SQLite WAL/page overhead is outside that logical bound and belongs to
#1346 measurement.

## Authority and filesystem checks

The runtime parent captures canonical workspace/store/data roots and the exact
open SQLite main-file path and inode. It passes the binding through inherited fd
3. The child consumes that pipe before opening SQLite, independently resolves the
same roots and file identities, and revalidates access around I/O and transactions.
There is no CLI/root/request field that grants writer authority. Legacy/manual
file-index calls without the fd marker skip the new phase.

Only regular, single-link UTF-8 `notes/**/*.md` files are admitted. Hidden trees,
`notes/users`, `notes/family`, links, hard links, invalid UTF-8/NULs and escaping
paths are excluded. Reads use `O_NOFOLLOW`, bounded buffers and before/after handle,
named-path and ancestor identity checks. The original bytes determine file SHA-256,
line ranges and chunk IDs; fences and source lines are never split.

## Freshness triggers

- Startup launches the existing worker and one unref'ed five-minute reconciliation
  timer, stopped through the shutdown registry.
- Workspace editor/upload/move/delete uses the existing stale hook.
- Successful agent `write`/`edit` completion records the actual completed path;
  failed or merely intended calls do not mark it.
- Dream completes its existing file-index refresh, marks the note phase dirty and
  waits for the same worker.
- Periodic full hash reconciliation discovers shell/external edits and additions;
  mtime/size equality is not trusted.

The new phase has independent `never_indexed`, `ready`, `stale`, `indexing`,
`limited` and failure metadata. Existing workspace search remains available if
note chunking fails. Rollback disables future note-query tool registration and
can rebuild or drop only the `note_retrieval_*` derived rows through their schema
owner; it never deletes `messages.db` or source notes.

## Tests

Isolated tests cover raw byte/line vectors, headings, repeated headings, LF/CRLF,
BOM/Unicode, fences, limits and deterministic IDs; fd/database/root substitution;
same-metadata edits; rename/delete/rebuild; dirty incremental and overdue full
refresh; exclusions; SQL rollback; writer contention; cancellation; crash cleanup
and cleanup failure. Existing Dream, file-search, access-state and migration tests
remain part of the required local gate.
