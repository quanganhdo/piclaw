# Earendil 0.87.1 session-entry compatibility (#1379)

Piclaw's pinned 0.85.1 session manager does not recognise `usage` and `context_edit` entries. This change prepares its readers and deferred fork replay for the published 0.87.1 shapes without upgrading packages or enabling a production context-edit policy.

## Stored entries and forks

- Adoption validates the v3 entry tree, usage fields and costs, context-edit replacement content, editable target and target ancestry. It evaluates the resulting context before accepting a completed assistant boundary. The 0.85.1 `buildSessionContext` ignores context edits, so validation projects those edits itself; importing a context-edited snapshot fails closed until the runtime exposes `appendContextEdit`.
- Deferred stable-branch seeds map surviving context-edit targets to their new IDs. They reject unmappable targets or an unsupported manager before writing any entries. They omit `usage` records as the #1379 deferred-seed policy: usage is a billable observation, not model context. A disposable 0.87.1 test found that upstream `SessionManager.createBranchedSession()` *does* retain usage in a file-branch copy; that separate path does not use Piclaw's deferred seeding. The two paths must not be described as equivalent. Null `firstKeptEntryId` is preserved at the compaction append boundary.
- Text and snapshot tree views name `usage` and `context_edit` entries. Prompt-cache waste counts assistant requests once; standalone usage is ignored and a context edit resets the comparison baseline.

## Forward and rollback

The coordinated package upgrade belongs to #1381. Before that upgrade, make a verified snapshot of the session JSONL and Piclaw state. After 0.87.1 writes a `context_edit` entry, **do not reopen that JSONL under 0.85.1**: 0.85.1 ignores the edit and reconstructs a different model context. Restore the pre-upgrade snapshot as part of any rollback. The local regression compares the two projections and demonstrates the mismatch. No migration or automatic downgrade of a 0.87.1-written session is provided here.

The 0.87.0 candidate manifest records its own historical blocked result and is unchanged. The 0.87.1 declarations and persisted reopen/file-branch behaviour were checked in a disposable package install; Piclaw's local tests run against the pinned 0.85.1 package with synthetic 0.87.1 entries. No live provider, remote host or production session was used.
