# Visual idle status-panel clock (#1352)

The Visual status panel no longer runs its one-second elapsed clock while it has
no visible elapsed label. This removes 60 timer callbacks per minute from the
settled idle fixture without changing status polling or live delivery.

Base: `2e2fd03a1` (22 September 2026). This follows the already merged Classic
mention-loop and shared five-second snapshot fixes. No production chat data,
settings, provider requests or live instrumentation were used.

## Cause and scope

`AgentStatusPanel` previously started its elapsed interval on mount, before the
conditional empty-panel return. Every tick assigned a new elapsed object even
when all values were zero. The hidden panel rerendered once per second.

The effect now depends on whether a visible draft, thought, tools or timestamped
output panel needs elapsed updates. It samples immediately on activation and
clears its interval on dismissal, turn end or unmount. Start timestamps remain
unchanged. OutputPanel's elapsed label is included even without draft/tool rows.

Retry countdowns, extension-panel timestamps and the existing ten-second watchdog
remain separate and unchanged. The idle watchdog callback still runs and returns
without setting state. This patch does not gate document visibility, modify the
snapshot cadence, alter SynthWave Full animations or suppress recovery feedback.

## Evidence

The actual component, with a test-only Preact render counter and browser virtual
clock, rerendered five times over a 5.1-second empty interval before the fix and
zero times after. Chromium and WebKit regressions cover turn end/remount, visible
elapsed labels, dismissed cards, output-only timestamps, extension timers,
retry countdowns, compaction/recovery and hung-run watchdog feedback.

Matched full-app Chromium fixtures use 10 synthetic posts, a fresh context, a
30-second settle and a 60-second measurement, default theme/reduced-motion, with
instrumented timers and CDP metrics. A missing picker-pin fixture route was added
for both runs; the initial unhandled-route exploratory run is excluded.

| Metric | Before | After |
| --- | ---: | ---: |
| Interval callbacks / minute | 78 | 18 |
| One-second elapsed callbacks / minute | 60 | 0 |
| Status snapshot requests / minute | 12 | 12 |
| RAF callbacks / minute | 0 | 0 |
| Main-thread busy-time equivalent | 0.09163% | 0.08106% |

The remaining intervals are 12 five-second polls and six ten-second watchdog
checks. The minute clock can add a timeout or interval depending on alignment.
The tiny task-time difference is a single-window observation, not a reliable
OS CPU, GPU, power or battery improvement. The timer/render elimination is the
deterministic result. No native background-tab or physical-device test is claimed.

## Reproduction

```sh
bun run test:local --cwd runtime \
  --env PICLAW_RUN_OPTIONAL_BROWSER_TESTS=1 \
  --env PLAYWRIGHT_BROWSERS_PATH=/absolute/browser-cache \
  -- bun test test/web/agent-status-clock.playwright.optional.test.ts
```

The existing optional `browser-idle-cpu.playwright.optional.test.ts` can reproduce
the full-app window using `PICLAW_RUN_IDLE_CPU_PROFILE=1` and
`PICLAW_IDLE_CASES=visual-idle` through the same isolated launcher. CPU sampling is
not enabled in the matched timing comparison.

Eight component cases pass with 48 assertions. The full-app before and after
runs each pass nine assertions. Bounded receipts are in
[idle-status-clock measurements](browser-idle-status-clock-1352.json); local logs
are retained with the workspace evidence archive.

#1352 still includes unmeasured native background/device and optional-pane costs.
This slice does not close the parent investigation or establish zero idle work.
