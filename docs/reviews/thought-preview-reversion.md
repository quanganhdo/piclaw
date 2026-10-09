# Delayed thoughts restoration

Classic thoughts can revert when an HTTP status or expansion response arrives after newer live content or a turn/panel change. The fix rejects these stale responses before restoring content or clearing an idle panel. Draft restoration shares the same protections.

Status requests capture turn ID, status identity and thought/draft buffers. A changed chat, turn, status or buffer invalidates the response. Expansion requests use per-panel generations plus turn, expanded state and buffer checks, preserving later expand/collapse decisions. Existing unchanged restoration tests still pass. Visual SSE streaming is unchanged; this qualification covers the reproduced Classic HTTP races.

## Qualification

Frozen head `86be609357426a76e158f3d8f12ad80117ab29cb`, tree `78c679149327032fbce968e5c02b65f3b4ec2936`, runtime tree `9dbc6283fe1d0fd9b0ac7cf822a0e4fcc34169ab`.

| Check | Result |
| --- | --- |
| Fresh complete runtime suite | 6,583 passed / 71 skipped / 0 failed; 42,834 assertions; 951 files; 723.74s |
| Preview/stream focused tests | 37 passed / 111 assertions |
| Browser controller race | 2 passed / 4 assertions, Chromium/WebKit |
| Previously failing complete files | 82 passed / 1,681 assertions |
| Settings / web build | 25/246 and 9/26 |
| Types, scoped lint, build | Passed; 94 unchanged transitive frontend diagnostics |
| Explicit 6.1 scoped source review | CLEAR; no reviewer tests |

Complete gate ran 6 October 2026 20:26:26–20:38:40 UTC with clean unchanged head/tree. Log `/workspace/exports/thought-preview-resume/full-v2/ci-fast.log`, SHA-256 `ed4d0568493df6367e923ce25334dc5d3325ba0d314d00a9f68727803bc11d62`.

## Retained failure and recovery

The earlier complete run failed five files and reported one error: DB migration subprocess timeout, passkey timeout followed by a closed-database asynchronous error, production-root discovery timeout, receipt-window timeout and a note-retrieval worker limit. Its log checksum is `ce89defe77b68809aac764955e2c45c75e7f629052de5276f99a0c45f5de95af`. After the separately authorised runtime reload/workspace cleanup, the frozen branch was recovered into a fresh worktree and the failed log extracted from the private evidence archive. No deleted temp scripts were rerun.

The five files passed unchanged in isolation, then the unchanged complete snapshot passed. This supports load sensitivity but does not prove the cause of each earlier failure. No deadlines or assertions were relaxed; the failed receipt remains preserved. An initial review timeout supplied no approval. A pre-existing unknown turn-ID type diagnostic was fixed by narrowing to a nonempty string; its resolved baseline entry was removed.

Publication changes after the frozen snapshot are docs/receipts only, with runtime parity verified. No main merge, deployment, installation or restart is authorised for this change. A different session owns the current main integration batch.

## Current-main integration

Merged current main `296187fd6` without rebase. Fresh complete qualification at `cfab718a8cf24330697bc3e756b99dc7d3426dba`: 6,633 passed / 71 skipped / 0 failed, 43,169 assertions across 952 files; settings25/246 and build9/26. Focus123/450, browser2/4, types/build pass. Initial WebKit timeout retained; unchanged rerun passed. Log SHA-256 `49a07a09a77de94e51bdf3fad605a2b4dd0b7a940326a982341df2d59c924d9f`. Runtime tree `b12973e4510ab84565c83a93a5d31a027b949fb1`; final publication delta docs only. Rui authorised merge; main hold released for1588 only.
