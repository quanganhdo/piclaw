# Browser idle work: Classic mention-effect loop (#1352)

A Classic compose effect caused continuous re-rendering with an empty, idle draft.
The fix memoizes its filtered agent list and supplies a stable empty-list default.
It does not change polling intervals, delivery, visible controls or permissions.

Baseline: `4a2e07259ea411cda1d620044a5689132661dac3`.
Investigation date: 20 September 2026. Reporter browser/device/skin details were
requested but not provided. The reproduction below uses synthetic data and does
not establish the cause of every reported client CPU symptom.

## Cause and correction

In [ComposeBox](../../runtime/web/src/components/compose-box.ts), `mentionAgents`
was produced by `.filter()` on every render. The mention-refresh effect depends
on that array and calls `updateMentionAutocomplete(content)`. An empty or ordinary
draft calls `setMentionMatches([])`, scheduling a new render with another array.
Preact schedules effects through RAF/timeout work, so the loop continued at about
60 callbacks/second even with no server changes or user input.

A DOM observer attributed the repeated mutations to an empty text node inside
`.compose-model-meta-subline`. Source-mapped CPU samples included ComposeBox,
Preact effects/rendering, storage reads and model-catalogue normalisation. The
model label was the visible mutation location, not the source of the feedback loop.

The correction uses `useMemo(..., [activeChatAgents])` and a frozen default empty
array. Current single-user/family callers replace the array when its contents
change. They must continue to do so; mutating an existing array in place is not a
supported update contract. Archived agents remain filtered, current-chat selection
is unchanged, and mention suggestions update when the list is replaced.

## Measurement method

- Headless Linux Chromium `151.0.7922.34`, 1366×820 viewport, fresh context per case.
- Real Classic/Visual HTML and built bundles, served by an ephemeral loopback
  fixture; explicit fixture APIs and controlled EventSource. No production chat,
  credentials, providers or configuration were read or modified.
- After 30 seconds settling, collect 60 seconds of CDP `Performance.getMetrics`
  deltas. The long-window comparison has CPU sampling disabled.
- Report `100 × delta(TaskDuration) / measurement_seconds` as **main-thread
  busy-time equivalent**. It is not OS process CPU, GPU load, energy use or a
  whole-browser measurement. CDP calls and automation also have overhead.
- Timer/RAF callback counts and DOM mutations are diagnostic instrumentation.
  Separate uninstrumented Classic control runs reproduce the before/after change.
- Quiet cases inject no additional SSE messages; normal application HTTP polling
  remains active. Minimal-update cases inject a heartbeat plus unchanged
  `context_usage` notification every five seconds. No streamed generation runs.
- Short/long fixtures supply 10/200 static message payloads. This measures the
  application's handling of those fixtures; it is not proof that every item is
  mounted at once, nor a multi-year production-history benchmark.
- Workspace is requested collapsed; terminal, VNC, editor and optional add-on
  entries are not opened. Theme effects/animations are absent in these captures.

The initial attribution pass injected an invalid generic idle `agent_status`
shape. Its minimal-update results are excluded from the principal comparison.
The corrected pass uses the actual `context_usage` event branch. Baseline idle
and uninstrumented-control results do not depend on those injected messages.

## Matched results

One long window per row per build, serial execution. Repeated short attribution
runs and an additional long idle baseline confirmed the loop, but these are not
statistical confidence intervals or universal performance thresholds.

| Fixture | Before busy-time % | After busy-time % | RAF callbacks/min, before → after | Style recalculations/min, before → after |
| --- | ---: | ---: | ---: | ---: |
| Classic idle, 10 messages | 2.959 | 0.100 | 3,600 → 8 | 3,600 → 8 |
| Classic minimal updates, 10 messages | 2.958 | 0.075 | 3,601 → 4 | 3,601 → 4 |
| Classic minimal updates, 200 messages | 3.498 | 0.087 | 3,600 → 4 | 3,600 → 4 |
| Classic idle, instrumentation off | 2.348 | 0.098 | not instrumented | 3,600 → 8 |
| Blank page, instrumentation on | 0.0164 | 0.0165 | 0 → 0 | 0 → 0 |
| Visual idle, unchanged implementation | 0.138 | 0.147 | 0 → 0 | 0 → 0 |

Visual minimal-update and 200-message cases measured 0.150% and 0.159% respectively,
with zero RAF callbacks. Both are unchanged-source controls, not claimed Visual
optimisations. Raw per-case deltas, callback origins, request counts and limits are
in [measurements.json](browser-idle-cpu-1352/measurements.json).

HTTP polling counts were unchanged for matched Classic cases: 46/minute idle and
37/minute minimal-update fixtures. Visual made 90/minute in the measured idle and
minimal fixtures; its status/model/roster work is a separate potential optimisation.
This fix removes the self-sustaining render loop without suppressing those requests.

## Motion, visibility and teardown

Normal-motion smoke windows (5 seconds settling, 20 seconds measuring) had zero
Classic RAF callbacks/DOM mutations and no active CSS animations; reduced-motion
was not concealing the loop. Simulated hidden/visible transitions also remained
usable and produced zero RAF callbacks during the measured hidden period.

Playwright with Xvfb did not make the background target's native
`document.visibilityState` become hidden in this environment. The harness therefore
labels hidden cases **simulated**: it changes the visibility properties/events to
exercise application handlers. It does not measure native tab throttling or
certify battery use. Real Safari/iOS, browser extensions, multiple windows,
compositor/GPU work, active media and open terminal/VNC/add-on panes require
separate matched profiling.

The targeted component regression exercises supplied and omitted agent props,
selecting a mention, replacing the agent list, filtering archived agents, clearing
to ordinary text, unmounting and remounting. Its deterministic budget allows at
most three RAF callbacks in each 400–500ms settled window, rather than asserting
fragile wall-clock CPU percentages. No perpetual animation/timeout loop is allowed
in this isolated idle ComposeBox state.

## Reproduction

Install existing dependencies and browser binaries through the repository's usual
setup. Always use the filesystem-isolated, niced launcher. Neither test defaults
to the live Piclaw server.

Quick behavior regression:

```sh
bun run test:local --cwd runtime \
  --env PICLAW_RUN_OPTIONAL_BROWSER_TESTS=1 \
  --env PLAYWRIGHT_BROWSERS_PATH=/absolute/browser-cache \
  -- bun test test/web/compose-idle.playwright.optional.test.ts
```

The longer diagnostic harness requires a second explicit opt-in. Select cases to
avoid running the whole matrix while another session has heavy work:

```sh
bun run test:local --cwd runtime \
  --env PICLAW_RUN_OPTIONAL_BROWSER_TESTS=1 \
  --env PICLAW_RUN_IDLE_CPU_PROFILE=1 \
  --env PLAYWRIGHT_BROWSERS_PATH=/absolute/browser-cache \
  --env PICLAW_IDLE_CASES=blank,classic-idle,classic-control,visual-idle \
  -- bun test test/web/browser-idle-cpu.playwright.optional.test.ts
```

Defaults are 30s settling/60s measurement; `PICLAW_IDLE_SETTLE_MS` and
`PICLAW_IDLE_MEASURE_MS` accept 1,000–120,000 ms. `PICLAW_IDLE_PROFILE=1` saves
DevTools CPU profiles for attribution (run separately from performance comparisons).
`PICLAW_IDLE_HEADED=1` needs an available display and does not establish native
background throttling on its own. Unknown case names fail. Unhandled fixture
routes/page errors fail rather than silently continuing with invented responses.

For an unchanged Classic baseline bundle with the same fixed fixture:

```sh
mkdir -p .artifacts/baseline-assets
git show 4a2e07259:runtime/web/static/classic/dist/app.bundle.js \
  > .artifacts/baseline-assets/app.bundle.js
# Add --env PICLAW_IDLE_BASELINE_ASSETS=1 to the long-harness command.
```

Results go to `.artifacts/browser-idle-cpu/results.json`; copy each run before the
next overwrites it. CPU profiles should contain only disposable fixture content.
The checked-in receipt excludes synthetic page text and includes the baseline
bundle hash. Sample profiles used for attribution are retained with the workspace
investigation exports, not runtime distribution assets.

## Validation and follow-up

- Focused compose/mention/model/session/SSE/performance helper tests: **71 pass**.
- Component idle/lifecycle browser regression: **2 pass, 13 assertions**.
- Final diagnostic-harness smoke: **4 pass, 13 assertions**; longer windows and
  motion/visibility experiments are recorded above, not counted as unit tests.
- Runtime gate: **5,439 pass / 4 skips / 0 failures**. The command wrapper was
  interrupted, but the isolated child completed and its final receipt was read.
  The remaining gate stages then passed separately: **25 feature tests** and
  **9 web-build tests**. All four typechecks passed.
- Repository lint fails with 20 pre-existing diagnostics, identical to unchanged
  `main` at `4a2e07259`; none concerns a file changed for #1352. Environment
  inventory, package hygiene, stale-dist, test-entrypoint, silent-catch and diff
  checks pass.
- No claims of a complete physical-device CPU audit or zero idle work. Reporter
  configuration and a device profile are still needed if symptoms persist.

Further candidates should be measured before changing behavior: Visual status
polling, hidden-tab notification/connection recovery, and teardown of real optional
panes. Preserve live delivery, session navigation, notifications and reconnect;
server suspendable-runtime work (#410/#414/#422) is a different concern.

## Shared polling follow-up

[The Classic/Visual snapshot follow-up](browser-ui-snapshot-1352.md) measures the residual duplicate polling, coalesces passive requests and replies across both skins, and records a five-second request budget. SynthWave Full's deliberate effects are measured separately and remain unchanged.
