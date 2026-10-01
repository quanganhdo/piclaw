# Workspace indexing settings

Workspace settings include an explicit indexing policy for full-text workspace search. The default roots are `notes` and `.pi/skills`. Saving an empty root list indexes nothing; the server does not replace it with defaults.

## Policy

The policy contains two arrays:

```json
{
  "roots": ["notes", ".pi/skills"],
  "ignorePatterns": ["**/node_modules/**", "*.tmp"]
}
```

Roots are explicit, workspace-relative directories. Enter one root or pattern per line in **Settings → Workspace → Indexing**. A path must be selected by a root and not match an exclusion: exclusions always win, including for a root itself.

Ignore patterns support:

- `*` for zero or more characters within a path segment;
- `**` for zero or more path segments;
- `?` for one character within a segment;
- lines beginning with `#` as comments.

Negation rules and imported or nested rule files are rejected. `**` must be a complete path segment; `*` and `?` stay within one segment. Blank lines and `#` comment lines have no matching effect. **Preview** validates the draft without saving it. **Save** is the only policy write action; editing either textarea does not autosave. A save applies exclusions to subsequent reads immediately, marks the index stale and queues a background refresh. References returned under the previous policy are rechecked when read, so removing a root or adding an exclusion revokes those old references immediately. **Refresh now** queues the same coordinator without changing the policy.

The saved policy applies to generic search and narrows verified note recall. `memory_query`/`memory_get` still admit only Markdown under `notes/`; selecting project documentation does not widen note access. Ignore rules are workspace-relative and case-sensitive (`*.tmp` matches the workspace root; use `**/*.tmp` at any depth). Protected runtime/private roots and symlink paths cannot be enabled. Index exclusions do not revoke independent filesystem-tool access.

## HTTP API

The direct API is available only in single-user mode to the authenticated instance owner. Family-shared and isolated-container routing deny these paths. The API derives the principal from the authenticated request and accepts no account, user or chat identity parameters. Mutating requests use the normal Origin check and workspace UI rate limit.

| Method | Path | Purpose |
|---|---|---|
| `GET` | `/agent/settings/workspace/indexing` | Return the saved `policy` and current all-workspace index `status`. |
| `POST` | `/agent/settings/workspace/indexing/preview` | Validate and inspect a draft policy. The request body is the policy. |
| `POST` | `/agent/settings/workspace/indexing/save` | Validate and persist a policy, mark status stale and queue refresh. |
| `POST` | `/agent/settings/workspace/indexing/refresh` | Queue refresh. The body must be empty or `{}`. |

Request bodies are limited to 32 KiB and five seconds. Owner-session admission is refreshed after asynchronous work. The status includes `state`, `indexed_file_count`, `last_indexed_at` and `last_error`. Validation failures return HTTP 400. Unauthenticated requests follow the common web auth guard; authenticated non-owner requests return HTTP 403.

## Preview limits and filesystem access

Preview reads directory entries and metadata only. It does not read file contents, follow symbolic links, change permissions or leave the workspace root. Existing workspace safety exclusions also apply, including private `.piclaw` state.

Each preview stops at 2,000 filesystem entries or a cooperative 250-millisecond deadline, retaining at most 100 sample decisions. Pruned directory descendants are not counted: counts describe inspected entries, not an exhaustive excluded-file total.

Only supported text extensions (the built-in set plus configured extra extensions) and files no larger than 512 KiB count as included. The response reports `truncated`, counts and sampled include or exclude reasons. Counts are estimates when `truncated` is true. Missing and unreadable roots appear as excluded samples instead of widening filesystem access. A blank saved roots list remains empty. On first adoption, legacy roots are accepted only when they resolve inside the current workspace; legacy external roots are not migrated or granted access.

## Focused tests

From the repository root, run the owned tests through the isolated launcher:

```sh
bun run test:controlled -- runtime/test/workspace-index-policy.test.ts runtime/test/channels/web/workspace-indexing-settings.test.ts runtime/test/web/workspace-indexing-ui.test.ts
PICLAW_RUN_OPTIONAL_BROWSER_TESTS=1 bun run test:controlled -- runtime/test/web/workspace-indexing.browser.optional.test.ts
```

The HTTP test covers single-user owner admission, family and isolated denial, strict request shapes, refresh queuing and bounded no-symlink preview. The UI test checks the two textareas, Preview, explicit Save, Refresh now, status/error output and preservation of an empty root list.
