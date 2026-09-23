# Widget host-state polling (#1352)

Interactive generated widgets no longer poll every 250 ms when their host iframe
is accessible. The bootstrap observes the iframe's `name` attribute and retains
`postMessage` delivery. Opaque or inaccessible frames keep the existing polling
fallback.

Baseline: `044dabf325624cac17eb0715e32031445d67900a`, 22 September 2026.
This is a Classic/family generated-widget bridge change. The Visual bundle does
not import this bootstrap; its independent dashboard widgets are outside this
slice. Theme animation, shared snapshots and status watchdogs are unchanged.

## Finding

[The host pane](../../runtime/web/src/components/floating-widget-pane.ts) writes
`iframe.name` and sends init/update messages. [The bootstrap](../../runtime/web/src/ui/generated-widget.ts)
previously read `window.name` four times a second. It already cached the string,
so an unchanged widget produced **no repeated JSON parsing**.

Chromium and WebKit also kept the child's `window.name` unchanged after a parent
`iframe.name` assignment. The old name-only fallback therefore missed later
updates in both test engines. Normal `postMessage` updates still worked. Reading
the observed attribute receives the value the host actually wrote.

The observer watches only `name`. String deduplication, envelope coalescing,
widget-ID filtering and init/runtime-state merging remain in place. `pagehide`
disconnects observation, stops fallback polling and cancels pending RAF/timeout
work. `pageshow` reconnects once and reads the latest state. Opaque frames avoid
`frameElement` access: WebKit reports a security error for that access even when
caught. Those frames continue reading `window.name` at the original cadence.
Removing an iframe destroys its browsing context; absence of a former explicit
cleanup function did not establish a leak. The new lifecycle tests cover explicit
suspend/resume, document replacement, removal and reopening.

## Measurements

Fresh headless Chromium and WebKit contexts on Linux, synthetic iframe content,
and an ephemeral loopback fixture. No live chat, providers or credentials. Browser
versions and raw callback deltas are in [widget-state-measurements.json](browser-idle-cpu-1352/widget-state-measurements.json).

| Window | Engine | Poll callbacks, baseline → candidate | Repeated JSON parses | Idle RAF callbacks |
| --- | --- | ---: | ---: | ---: |
| 60 seconds, Playwright virtual clock | Chromium | 240 → 0 | 0 → 0 | 0 → 0 |
| 60 seconds, Playwright virtual clock | WebKit | 240 → 0 | 0 → 0 | 0 → 0 |
| 10 seconds real clock, after 1 second settling | Chromium | 40 → 0 | 0 → 0 | 0 → 0 |
| 10 seconds real clock, after 1 second settling | WebKit | 39 → 0 | 0 → 0 | 0 → 0 |

One real-clock window per engine/build; instrumentation wraps interval, parsing
and RAF calls. These are callback counts, not CPU percentages, energy estimates
or a physical-device benchmark. Virtual time gives a deterministic regression
budget. Pagehide/pageshow are dispatched lifecycle events; these tests do not
establish native tab throttling or actual back-forward-cache admission.

## Validation

- Five always-on bootstrap tests execute the generated script, including the
  no-RAF timeout fallback, name filtering, malformed payloads, deduplication,
  single-observer/poll ownership, paused message handling and cancellation.
- Fourteen optional browser cases across Chromium/WebKit cover real and virtual
  clocks, name-only updates, messages, init merging, other-widget rejection,
  burst coalescing, final/error states, opaque fallback, lifecycle and removal.
- The mounted `FloatingWidgetPane` fixture exercises the production component,
  updates, explicit ready/submit/refresh actions, srcdoc replacement, close and
  reopen. It always uses candidate source, including during baseline bootstrap
  measurements. It does not submit anything to a real chat.
- Existing widget helpers and app orchestration: 36 passing tests.
- `make ci-fast`: 5,567 runtime tests pass, four skips; 25 feature tests and nine
  build tests pass. All four typechecks pass.
- Final post-build browser pass: 26 cases / 208 assertions, including the 14 widget
  cases, eight elapsed-clock/recovery cases and four shipped Classic/Visual shell
  cases. This tests cold boot, forced reload and status updates alongside the widget
  changes. The widget cases use the production component source in a fixture bundle.
- Lint has the same 20 diagnostics as unchanged main; scoped lint for all changed
  TypeScript files passes. The environment-observations manifest was regenerated
  for the documented test-only baseline flag; runtime configuration is unchanged.

## Reproduction

Install existing dependencies with `bun install --frozen-lockfile`. Use the
repository's isolated, niced launcher:

```sh
bun run test:local --cwd runtime -- bun test test/web/generated-widget-bootstrap.test.ts
bun run test:local --cwd runtime \
  --env PICLAW_RUN_OPTIONAL_BROWSER_TESTS=1 \
  --env PLAYWRIGHT_BROWSERS_PATH=/absolute/browser-cache \
  -- bun test test/web/generated-widget-state.playwright.optional.test.ts
```

For the baseline bootstrap (assertions explicitly expect its polling and missing
name-attribute updates):

```sh
mkdir -p .artifacts/widget-state
git show 044dabf32:runtime/web/src/ui/generated-widget.ts > .artifacts/widget-state/baseline-widget.ts
# Add --env PICLAW_WIDGET_POLLING_BASELINE=1 to the browser command above.
```

## Remaining timer inventory

Source inventory only, unless a measurement is linked. These are candidates for
separate profiling, not additional fixes in this PR.

| Owner | Current behaviour | Boundary / next evidence |
| --- | --- | --- |
| Shared UI snapshot | Five-second polls; previous settled fixture measured 12/min | Preserve delivery/reconnect; already covered by the [snapshot work](browser-ui-snapshot-1352.md) |
| Classic status watchdog | Ten-second interval; returns immediately when agent is idle; effect clears interval | Six idle callbacks/min in the previous full-app fixture; prove active recovery before any change |
| Workspace explorer | Minimum 15-second, default 60-second tree/index refresh; effect clears interval | Mounted/collapsed behaviour and network cost need a disposable pane profile |
| Models settings | 15-second refresh plus focus/SSE/model events; cleanup removes timer/listeners | Measure only while mounted, including close/reopen |
| System meters HUD | Shared cadence; skips refresh when document is hidden; clears interval | Native hidden scheduling is unmeasured |
| Editor file conflict monitor | Three-second stat polling; stops at conflict/dispose | Preserve conflict detection; profile open/close and background editing |
| Terminal pane | Connected-session heartbeat; reconnect/dispose paths clear it | Protocol liveness, not a timer to remove based on idle appearance |
| VNC / other add-on panes | Event/resize/media-specific work | No real-device or open-pane CPU claim from this widget fixture |

The [elapsed-clock fix](browser-idle-status-clock-1352.md) removed the earlier
60 callbacks/minute in Visual. Intentional SynthWave Full paint remains intact.
Reporter-specific device/browser profiling, native hidden-tab behaviour, multiple
windows, active media, VNC and other optional panes still need evidence. #1352
stays open.
