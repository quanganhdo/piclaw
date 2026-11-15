# Code Review persistence ownership

The optional Code Review add-on owns 16 tables and 6 explicit indexes in the native shared database. Core supplies a borrowed connection and current-owner checks. No core initializer installs or retires this namespace.

## Exact source

The native approval in `runtime/durable-engine/src/host-extension-catalog.ts` selects package **0.1.11**, with the source pinned by `scripts/native-gate-contract.json` to add-ons commit `ad7ad0a4b63ee37090b6bee4309fa5c458ec6510`. Qualification copies those exact approved files; it never reads a live installation. The original #1706 acceptance qualified 0.1.8 at `e8aac2399148cbef638764ba2b5a1cd916cc5ecc`. Later writer-admission integration changed approved source/package versions while retaining shared schema version 1. Old package versions, including 0.1.9, do not gain current execution approval from sharing that schema.

Current `database.ts` SHA-256 is `b0b2c9fe4f547a6be5bdffca90a1f4e328701bd6a5fe6e96ea496d44edaa3a58`; local shared schema version is **1**. The add-on's [storage inventory](https://github.com/rcarmo/piclaw-addons/blob/ad7ad0a4b63ee37090b6bee4309fa5c458ec6510/addons/code-review/database.ts) defines all table/FK/index shapes. The add-on's [versioned storage contract](https://github.com/rcarmo/piclaw-addons/blob/b35639930a7eeb7113600a3a9e2e9df0377bd4d8/addons/code-review/README.md#storage) documents each table's feature, writer, payload and retention class. The complete core object inventory is the optional `addon:code-review` owner in `runtime/scripts/schema-ownership.json`.

All 16 tables support current contracts. Snapshots/blobs preserve saved bytes independently of working files, message revisions preserve edits, projections retain anchor mappings, and delivery attempts/receipts preserve uncertainty and idempotency. No unsupported or duplicate persistence has been established; no object, writer or setting is retired by this work. No storage reduction is claimed.

## Native bridge

1. `loadApplicationExtensionCatalog()` checks the installed source before evaluation. `qualifyInstalledCodeReview()` checks registration and public exports; absent packages contribute no review tool or schema initializer.
2. The default factory calls add-on `setReviewDatabaseSource({database: root, assertOwner, admitWrite})` before `reviewService()`. The writer port uses the existing acquisition-only `admitSqliteWrite`, with current root/source ownership checked around its synchronous SQL callback. Waiting does not replay an entered callback. Only add-on `ReviewDatabase.initializeBorrowed()` creates its namespace. Add-on schema versioning never changes host `user_version`, pragmas or connection ownership.
3. `createHostCodeReviewTool()` derives invocation authority from the exact SDK tool task and accepted local-dispatch source. The original message, content hash, branch incarnation and `addon_local_dispatch_authorities` proof are required. Ambient chat IDs, ordinary prompts, remote messages and tool arguments confer no review authority.
4. Core supplies the existing operation write fence. The add-on checks assignment epochs, versions and request receipts. SDK task state owns execution; add-on work state describes discussion progress and cannot prove that an agent is running.
5. Backend close releases the source grant, closes add-on services and clears their cleanup timers. A stale service or release cannot adopt/revoke a later incarnation. UI service reset retains the bound source; closing a pane leaves saved reviews intact.

## Inactive and reinstalled state

A fresh native startup without the package creates **zero** `addon_code_review_*` tables. Once installed, disabling participation or uninstalling preserves all 16 tables, payload rows, receipts and the schema marker. Reinstalling the same approved source reopens them without replaying a known or uncertain send. Interrupted delivery is reconciled to `unknown`; there is no automatic resend.

There is no separate native per-add-on disable switch here. Inactive means that the package contributes no registration after a process boundary. The lifecycle fixture parks its package outside discovery, retaining both files and database, then reinstalls it. A second phase removes only the disposable package and verifies the same retained database. Native source-cache provenance requires a real process boundary for source removal/change; hot replacement is deliberately refused. Persisted custom tools remain custom. Configurations that still require an unavailable tool fail explicitly; schema retention is not permission to run missing code.

Only the active add-on applies its configured retention policy. The default is unlimited retention. Explicit operator deletion/opt-in expiry uses `deleteReview()` transactionally; recent drafts and active/uncertain delivery prevent automatic expiry. Request receipts retain body-free deletion tombstones. Deactivation itself grants no deletion authority.

## Recovery and malformed stores

Saved source text, revisions, projections and review payloads are in SQLite; preview does not require the original source file. Keep all owned tables and receipts together in a consistent host snapshot, including committed WAL state. Core local-dispatch/source identities remain outside the add-on namespace and must also survive. A full native recovery unit includes external answer payloads, configuration/source versions and secure credential references; #1704 covers that unit. Add-on storage retention does not prove full application recoverability.

Unknown shared versions fail transactionally. The version-1 settings initializer is additive and add-on-owned. A marker alone does not validate every version-1 table; use the read-only schema-ownership inventory for shape/FK/index inspection. Missing or malformed records must not trigger a standalone fallback, schema-marker deletion or forced reset. Preserve the failed source and use an explicitly verified matching recovery unit. There is no supported per-review archive/export-and-import command and no new backup, restore or deletion schedule.

## Focused qualification

- Add-on `shared-database.test.ts`, `^SHAREDDB lifecycle`: all 16 tables populated, schema/rows/FKs/host pragmas preserved over grant deactivation/reinstall; service timer closed; exact request replay and conflicting payload; saved source, revisions, drafts and dispatch preserved; additive settings initializer scoped to the add-on.
- Core `default-application-runtime.test.ts`, case `native-code-review-lifecycle`: five actual cold processes share one disposable checkpoint through fresh-absent, present, excluded/disabled, reinstalled and uninstalled phases. Original source-cache rejection remains a recorded test-design failure; no guard is bypassed. Zero provider or legacy-session factory calls.
- Existing installed-catalog and native review tool/codemode cases cover source qualification, dispatch idempotency, revocation and exact accepted-source authority.

These checks do not authorise live deactivation, installation, schema changes, data removal, backup/restore or a service restart.
