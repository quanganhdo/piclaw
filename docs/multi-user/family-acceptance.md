# Family acceptance evidence

Family chat parity passed on merge commit `87361162f787f143be2d3efc8d94b7799171f3db` from [PR #1286](https://github.com/rcarmo/piclaw/pull/1286). No live workspace was migrated or activated during acceptance.

## Functional gates

| Gate | Result |
|---|---:|
| Family browser suite | 123 passed; 1,079 assertions |
| Non-browser family contract | 682 passed across 96 files; 6,632 assertions |
| Standard single-user regressions affected by shared components | 122 passed; 396 assertions |
| Hosted CI on adjusted head `6c9b014ebf77821f9d9aa95cdfaaf7b337f7b774` | Passed in 4m46s |
| Repository `ci-fast`, typecheck, changed-file lint, stale-dist and diff checks | Passed |

The machine-readable coverage list is [`runtime/test/fixtures/family-chat-parity-matrix.json`](../../runtime/test/fixtures/family-chat-parity-matrix.json). It covers shared component/CSS imports, rich rendering, compose behavior, curated model and session controls, status/thinking/tool state, queue/steer/abort, realtime reconnection, uploads, media viewing, annotations, Adaptive Cards, widgets and account replacement.

## Small-machine soak

A three-cycle isolated soak ran on 8 September 2026 in the Smith LXC container. The host exposed 4 vCPUs, 4.0 GiB RAM and no swap. Each cycle ran all 96 family contract files, the full family Playwright suite and the budget accounting/policy tests against temporary in-memory stores and synthetic browser data.

| Measurement | Result |
|---|---:|
| Cycles | 3 |
| Total tests | 2,472 passed; 0 failed |
| Elapsed time | 459.57s |
| Peak sampled process-tree RSS | 1,387.6 MiB |
| Family contract per cycle | 682 passed |
| Browser per cycle | 123 passed |
| Budget per cycle | 19 passed |

The process-tree figure includes Bun test runners, Chromium and child processes. Peak use was 33.9% of the 4.0 GiB host memory. The test did not measure steady-state production RSS, provider latency or real household file-edit contention. Shared-file conflict semantics remain those of one trusted filesystem; application ownership does not provide file isolation. Family memory publication writes SQLite records rather than shared memory files, and its concurrency tests preserve shared-file content. Provider budgets use the opt-in durable budget policy merged in #1263; the soak verified accounting/policy tests but made no paid provider requests.

## Operational effects

Family mode adds one account/login claim row per pending upload until message admission or one-hour expiry. Each account can hold at most 32 pending uploads, and each message can consume at most 16. Normal attachment bytes remain in the existing `media` table. The parity layer reuses the standard chat component tree and adds no second renderer cache.

Instance-wide operations remain disruptive: offline migration/promotion, mode changes, provider/add-on configuration and service restart. Account profile, owned session, queue, annotation, upload and generic card/widget chat actions do not require a restart. Automatic family scheduling, Dream, shell, terminal, VNC, global provider/add-on controls and isolated containers are unavailable.

## Visual evidence

- [Rich desktop conversation](screenshots/01-rich-conversation-desktop.png)
- [Curated model picker](screenshots/02-curated-model-picker.png)
- [Owned session picker](screenshots/03-owned-session-picker.png)
- [Live status, thinking, tools and queue](screenshots/04-live-status-thinking-tools-queue.png)
- [Rich mobile conversation](screenshots/05-rich-conversation-mobile.png)
- [Family administration](screenshots/06-family-administration.png)
- [Workspace and security](screenshots/07-workspace-security.png)
