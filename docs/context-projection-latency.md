# Bound provider-context projection work

The `context` hook in `runtime/extensions/integrations/context-mode.ts` can stall the local event loop while traversing a long history, even when it returns no transformed messages.

## Cause and change

The previous traversal repeatedly called `canUseToolOutput()` and tool-compaction policy getters for historical messages and nested blocks. Access checks synchronously read configuration; policy resolution also performs configuration work. Awaiting helpers that immediately resolve only advances the microtask queue, so pending HTTP requests and timers can remain delayed.

The hook now:

- Reads enabled-tool and per-tool-threshold policy once per request.
- Projects legacy and nested tool results synchronously within each batch.
- Uses `setImmediate` between 64-message batches and once after the final batch to let other event-loop work run, including for short histories.
- Rechecks access and cancellation after each yield and immediately before publishing the result.
- Keeps policy snapshots local to the invocation; later requests read fresh policy.

The `tool_result` storage/semantic-summary path is unchanged. Context projection remains deterministic, does not call a model or store outputs, and does not mutate the input history. Policy changes made during a yield take effect on the next request; access revocation and turn cancellation discard the current partial projection.

The batch bound is measured in top-level messages, not text bytes or nesting depth. A single unusually large or deeply nested message can still monopolise a batch; this change does not claim a hard wall-clock latency bound.

## Reported measurements

Observed on Windows x64 with Bun 1.4.1 and PiClaw 3.2.4. The same affected hook was present at the upstream base used for this patch.

A 60-second status probe recorded 109 sequential requests, spaced 200 ms apart. Median latency was 2 ms; maximum latency was 10,530 ms. Five requests exceeded one second. Their measured application-handler time was approximately 0.4–1.2 ms, indicating delay before request handling.

Read-only replay of the same 1,050-message history produced:

| Replay | Previous hook | Batched hook |
|---|---:|---:|
| 1 | 3,676 ms | 76 ms |
| 2 | 3,691 ms | 54 ms |
| 3 | 3,474 ms | 57 ms |

Median hook time fell from 3,676 ms to 57 ms (98.4% lower). Outputs were deeply equal and input-history hashes unchanged. Additional oversized and nested synthetic cases also matched. Only aggregate measurements are included here; the replay history and deployment-specific scripts are not published.

These are hook-replay measurements, not an end-to-end model-speed claim. Provider latency, total context length, CPU contention and other startup work remain separate factors. Live improvement after activating the fix has not been established by this report.

## Regression tests

`runtime/test/extensions/context-projection-performance.test.ts` launches synthetic scenarios in separate child processes so module mocks cannot leak into neighbouring suites. Tests cover:

- One policy read per request and 17 access checks for 1,024 messages.
- Event-loop yielding without timing-sensitive speed assertions.
- Deterministic output and input immutability, including nested results.
- Images, binary blocks, excluded tools and small output preservation.
- Per-tool thresholds, request-scoped policy and fresh subsequent requests.
- Denied, disabled, missing-message and pre-aborted requests.
- Access revocation or cancellation during a yield and access recheck before publication.
- Immediate, microtask and previously queued macrotask revocation/abort for 1, 64 and 65 messages, covering legacy and nested-only results with a positive compaction control and input immutability checks.
- No model calls or tool-output persistence during context projection.

Run through the repository's isolated launcher:

```sh
bun run test:local --cwd runtime -- bun test test/extensions/context-projection-performance.test.ts
```

The standard filesystem preloads remain enabled. Fixtures contain synthetic data only.

## Publication-fence correction

Review reproduced a short-history access-revocation regression in the initial batching candidate: histories of 64 or fewer messages returned without yielding. The existing family-mode boundary test passed on the base but failed on that candidate. The new 36-case publication matrix reproduced 24 failures on the uncorrected implementation; its 65-message cases already crossed the batch boundary.

The final `setImmediate` restores an asynchronous publication boundary for every eligible invocation while retaining one policy snapshot and batch-sized access checks. Permission changes and cancellation observable at that boundary discard the replacement; it is not a guarantee against revocation after the hook has completed. The earlier Windows replay measurements precede this correction and have not been remeasured for the corrected candidate.

## Corrected candidate validation

On 2 October 2026, Bun 1.4.2 in the Smith LXC passed all 99 focused projection/output/family/owner tests with 322 assertions. Independent read-only review found no blocking issue in the correction or regression matrix.

After merging the #1516 base, frozen tree `1281eba21436023843778f3e6719938a33de887f` passed `make ci-fast`: 5,985 runtime tests, eight existing skips, zero failures; 25 feature tests and nine web checks. The separate frozen 0.99.1 consumer passed 468 tests and 8,720 assertions across 45 files. All five typechecks passed with the unchanged 95-diagnostic compose baseline. Pack hygiene checked 24,747 files; stale-dist and changed-file lint passed.

Repository-wide `make lint` failed with 59 diagnostics, all reproduced identically on the base lint inputs. The corrected files introduced no diagnostic; unrelated source and test assertions were unchanged. The full-gate log is `/workspace/tmp/review-1517/ci-fast.log`, SHA-256 `f5ccbcc48e628dc8a8c3c11c2a87b896bcb7270cc9f41ef62b79e3e2ce5037b0`. Only validation prose changed after that frozen gate. No live replay, production install or restart was performed.
