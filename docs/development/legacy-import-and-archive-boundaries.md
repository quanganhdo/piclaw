# Imported-history schemas and archive tooling

Harness owns native execution storage. Imported-history documents supply active provenance for native history projection; the JSONL archive store supplies explicit import, search and export tooling.

## Persisted import documents

`runtime/durable-engine/src/legacy-import-schema.ts` defines the copied linear/tree manifests and shared binding types, limits and importer version. It imports only the public document factory at runtime. Document kinds, version 1, conversation scope, latest-history retention, initial-on-fork policy and `{ binding: null }` initial state are unchanged. Importer version 2 and source-hash inputs are unchanged.

Live readers `host-runtime.ts` and `session-tree.ts` depend on this schema module. Their compiled application import graph excludes `legacy-import.ts`, copied-upgrade/installation preparation and the archive store. No startup saving is measured.

`legacy-import.ts` retains explicit preparation/import functions and compatibility re-exports of the same document objects. The engine `index.ts` remains the existing combined offline migration/qualification API, used by `db-tree.test.ts`, `copied-upgrade.test.ts` and other explicit fixtures. Production source has no consumer of that compatibility barrel; history readers import the schema submodule directly. No new lazy-import layer or duplicate document definition is introduced.

## JSONL archive store

The implementation moved from `runtime/src/agent-pool/sqlite-session-store.ts` to `runtime/scripts/lib/sqlite-session-archive.ts`. Its class name, schema owner `piclaw-agent-sessions`, table namespaces, migration ID/order/SQL checksum, import identity, raw bytes and export behaviour are unchanged. No archive data or historical evidence is removed.

The identified consumers are the explicit importer, layout benchmark and archive tests; all use the new tooling path. The old private deep import is retired without a compatibility shim. No package export or documented external consumer requires that runtime-looking path. Package checks require the tooling files and reject the retired AgentPool path.

Supported commands keep their filenames:

```sh
bun runtime/scripts/import-jsonl-sessions.ts --source <copied-jsonl> --target <archive.db> --layout separate --dry-run
bun runtime/scripts/benchmark-sqlite-session-layouts.ts --sessions <copied-jsonl-directory> --messages <disposable-timeline.db> --out <disposable-output-directory> --limit 1 --iterations 1
```

The importer still rejects unified and unrelated targets. The retained benchmark compares archive layouts and fault behaviour; its report labels the scope `archive-layout-only`. Historical measurements and report versions are preserved. The benchmark deliberately replaces its output directory and uses disposable copies only. These tools do not migrate native Harness execution state.

A verifier lock regression exposed by the benchmark is covered separately: `verifySqliteBackup` explicitly ends its owned read snapshot before closing, so an immediate writer can reopen the verified file. Snapshot fields/publication logic are unchanged; the regression test verifies the source remains unchanged.

## Qualification

Archive tests cover byte/hash round trips, idempotence, FTS/branch/export behaviour and the exact historical migration checksum. CLI and benchmark smoke tests use disposable files. Native import/projection tests cover preserved mappings, forks, counts, context edits and private-baseline redaction; a build-graph guard prevents the history readers from acquiring migration execution dependencies.

No deployment, live import, restore, configuration, restart or schema action is implied by this boundary change.
