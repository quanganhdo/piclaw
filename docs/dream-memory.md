# Dream and AutoDream

Dream and AutoDream keep the workspace memory layer coherent across sessions:

- **`Dream`** — triggered manually via `/dream [days]`
- **`AutoDream`** — the built-in nightly maintenance cycle (default cron `0 1 * * *`, i.e. 01:00 in the runtime timezone)

Both run as **out-of-band agent turns** on a dedicated temporary `dream:` channel
that is cleaned up after the run, so Dream work does not appear in normal chat history.

## Access-mode scope

This guide describes the existing single-user Dream pipeline. Gated family model execution selects `notes/users/<immutable-user-id>/MEMORY.md`, `preferences.md` and explicit `notes/family/MEMORY.md`; it does not substitute global personal memory. Dream/AutoDream collection, queue provenance and shared/personal writes still need owner-aware integration. Shared filesystem access is not restricted by prompt selection. See [Access modes](multi-user/README.md#model-identity-foundation).

## Flow

Dream follows a four-phase model-driven flow:

1. **Orient** — load startup memory index and inspect existing daily/memory state
2. **Signal** — gather only the narrow confirming evidence needed for suspected drift
3. **Consolidate** — merge, normalize, and correct contradictions at the source
4. **Prune and Index** — remove stale pointers, add references to newly important
   memories, and keep the compact memory index clean

## Memory files touched

| File | Role |
|---|---|
| `notes/daily/*.md` | Human-readable day narratives |
| `notes/memory/MEMORY.md` | Compact startup index |
| `notes/memory/current-state.md` | Recent Dream state snapshot |
| `notes/memory/recent-context.md` | Agent-ready digest |
| `notes/memory/user.md` | Durable user preferences |
| `notes/memory/feedback.md` | Corrections and steering cues |
| `notes/memory/project.md` | Ongoing work and outcomes |
| `notes/memory/reference.md` | Note index and external pointers |
| `notes/memory/days/*.md` | Sparse optional episodic memory |

Dream must not modify project code, tests, or unrelated config.

## Trigger modes

### Manual `/dream`

```text
/dream
/dream 7
/dream 30
```

Creates a pre-Dream zip backup, refreshes in-window daily note files from the
messages database, runs the Dream turn, and posts a summary back to chat.
Unfinished daily notes are seeded with hidden `DREAM_CUES` based on their
front-matter transcript slice. Small bounded days may expose the full slice;
larger or multi-session days use a per-session-tree cue index plus per-tree
snippets, and cue thresholds/snippet budgets are Dream env-configurable.
If consolidation is incomplete, the run reports unresolved backlog dates. Default window: last 7 days. Daily-note day boundaries follow the runtime timezone (`TZ` / runtime timing config), not UTC.

### AutoDream

Built-in scheduled task `builtin-dream-midnight` runs nightly at `0 1 * * *` by default.
That is 01:00 in the runtime timezone (for example, 01:00 Lisbon time when `TZ=Europe/Lisbon`).
Uses a 2-day window, and the day slices it refreshes use that same runtime timezone.
Runs silently unless you inspect task results.
Skips when no sessions have occurred since the last consolidation.

## Startup bootstrap and recovery

Runtime distinguishes a fresh workspace from an established workspace whose
derived memory files were lost. It uses non-`dream:%` message history, existing
`notes/daily/*.md` files, and `notes/memory/.dream-state` as durable evidence.

A fresh workspace with missing core memory files queues one silent, model-driven
Dream bootstrap. An established workspace never makes a startup provider request
for the same file loss. Runtime deterministically rebuilds `MEMORY.md`,
`current-state.md`, and `recent-context.md` from available Daily notes.

If Daily notes or summaries cannot support complete recovery, `.dream-state`
records `recovery: backfill_required`. Later restarts leave that state unchanged
and queue no recovery work. The next scheduled AutoDream or an explicit
`/dream` performs the usual bounded consolidation and records
`recovery: complete` when no backlog remains.

## Search indexing

Dream ends with a runtime-owned workspace FTS index refresh, so updated memory
files are immediately searchable via `search_workspace` without a manual refresh.

## Reference

For the full specification — including memory lifecycle, content model, file
ownership rules, and the out-of-band channel contract — see:

- [`runtime/docs/dream-memory.md`](../runtime/docs/dream-memory.md)
