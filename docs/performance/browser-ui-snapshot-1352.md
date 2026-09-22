# Shared Classic/Visual status polling — #1352

Both skins now coalesce passive status, current-model, context and system-metrics reads into one five-second snapshot request per page. Visual's settled traffic falls from 90 to 12 requests/minute in the disposable fixture. Classic's model/context callers share the same transport and reply; separate presence and timeline recovery requests remain.

Base: `5ca0b16cff917234051d8b504060905897a6284e` (after #1362). This follows the Classic mention-effect fix in [the earlier investigation](browser-idle-cpu-1352.md). No live chat data, production configuration or restart was used.

## Request and reply ownership

- `GET /agent/status?chat_jid=…&ui=1` is an opt-in operator UI envelope. Ordinary status requests keep their synchronous response shape. Family authorization rejects `ui=1` before accessing private sections; family pages are unchanged.
- The envelope contains status, current-model metadata, context/cache usage, cached system metrics, display name and names of failed optional sections. A metrics/model/context failure does not discard healthy sections or expose exception text.
- `includeCatalogue:false` projects only the selected model; `available_model_count` preserves OOBE readiness even without a selected model. Provider diagnostics are omitted. The full model catalogue remains an explicit picker/Settings request. Passive model reads do not hydrate cold runtimes.
- `runtime/web/src/ui/agent-ui-snapshot.ts` owns chat-keyed in-flight promises and cached replies for both skins. Equal reply sections retain their object identity. A 4.75-second freshness window allows five-second callers to tolerate scheduling skew; shared requests have a 15-second timeout. Completed history is bounded to 32 entries where no request is in flight.
- Model changes, reconnects, chat changes and terminal agent events invalidate cached state. An invalidation during body parsing causes all callers to await one replacement. Token/tool progress already arrives over SSE and does not continually invalidate pending requests.
- Visual mounts one App-owned poller and passes its signals to both desktop/mobile bars and SystemStats. It no longer polls models, roster, context or metrics separately. Unmount clears intervals/deferred refreshes; version checks suppress late consumer writes without aborting another consumer's request.
- Classic passive model/context/status callers use the same transport. Its metrics HUD uses the shared five-second interval instead of an independent two-second loop. Full catalogues on interaction, presence POSTs, queue/branch/timeline recovery and search remain separate operations.

Coalescing is per page/JavaScript context. Independent browser tabs do not share a worker or connection. Hidden tabs retain the existing freshness policy; this change does not disable SSE or rely on headless background throttling.

## Matched measurements

Host `smith`, Debian LXC, Bun 1.4.1, Chromium headless 151.0.7922.34. Desktop viewport 1366×820; mobile 390×820. Each case uses a fresh isolated context, deterministic synthetic messages/APIs and stub SSE; requests outside the disposable origin are aborted. Ten posts for ordinary cases, 200 for long cases. Fixed 30-second settling and 60-second recording windows. Minimal traffic injects a heartbeat plus unchanged status every five seconds.

The values below are CDP `TaskDuration / 60s × 100`, a renderer main-thread busy-time equivalent. They are not operating-system CPU, GPU usage or battery measurements. These paired runs had CPU sampling disabled. Timer/DOM counters were enabled except for the explicit control case.

| Case | Baseline requests/min | Snapshot requests/min | Baseline busy equivalent | Snapshot busy equivalent |
|---|---:|---:|---:|---:|
| Classic idle | 46 | 29 | 0.109% | 0.115% |
| Classic minimal updates | 37 | 23 | 0.076% | 0.074% |
| Visual idle | 90 | 12 | 0.134% | 0.095% |
| Visual minimal updates | 90 | 12 | 0.150% | 0.095% |
| Visual uninstrumented control | 90 | 12 | 0.142% | 0.091% |
| Visual mobile | 90 | 12 | 0.135% | 0.087% |

Visual's original 90 calls were status/models/roster ×24 each, context ×12 and metrics ×6. The snapshot makes 12 status requests and none to those other four endpoints. Classic likewise makes 12 snapshot requests; its other requests are four presence POSTs, workspace index status and existing branch/queue/timeline/autoresearch recovery. Classic timing differences are small and mixed; no meaningful CPU improvement is established there.

An earlier narrow shared-poller trial reduced Visual 90→48 requests/minute with no cadence change. Its original baseline idle result was 0.143%; the repeat baseline above was 0.134%. This provided a second baseline observation before the cross-skin snapshot was implemented.

## Traces, Full effects and variance

A subsequent diagnostic run enabled CDP sampling and saved bounded `.cpuprofile` files. All seven cases passed the deterministic request budget, absence of legacy polling, no console errors and no unexpected routes: Classic/Visual idle, Classic/Visual long, Classic/Visual simulated-hidden, and Visual Full.

Sampling adds overhead: diagnostic idle busy equivalents were 0.849% Classic and 0.306% Visual, versus the unsampled values above. The Classic trace contained about 260ms of sampled GC; both idle traces were overwhelmingly idle. Do not use the sampled timings as before/after performance deltas.

SynthWave Full is intentionally unchanged. Before coalescing it recorded 46.396% busy equivalent; the intermediate shared-poller build recorded 46.865%. The final sampled diagnostic recorded 54.001%, with the UI, compose and accent animations running and 12 status requests/minute. The `(program)`/style-layout work dominates that trace. These observations separate deliberate animation work from excess polling; they do not establish a physical-device cost or justify reducing the requested effects.

Raw bounded measurements are in [the companion JSON](browser-ui-snapshot-1352-results.json). Local profiles and full run logs are preserved under `/workspace/.pi/artifacts/1352-visual-polling-20260921/`; only synthetic text and localhost URLs occur in them.

## Regression coverage

- Shared transport tests: Classic API consumers and Visual share a promise/reply; cache reuse, per-chat separation, response invalidation during JSON parsing, HTTP 401/403/500 retry and partial failures.
- Backend tests: exact chat, compact-model flags, OOBE available count, partial failure isolation, unchanged ordinary status facade and family rejection.
- Chromium/WebKit component tests: one-minute hybrid Classic/Visual caller budget, five-second cadence, reconnect, matching/wrong-chat model events, context pushes, stale/error recovery, mobile consumer mount/unmount, late JSON, model changes during a pending request, and deferred refresh disposal.
- Existing Settings model-picker and Classic mention-idle regressions pass. The desktop compaction selector width test fails identically on unchanged main and this branch (190px, expected >300px); phone and invalid-model cases pass. No compaction CSS is changed here.
- Full-app profile harness checks 12±1 status snapshots/minute after settling and zero passive models/context/metrics/roster requests. Hidden state is explicitly simulated and restored.

## Validation receipt

- Full `make ci-fast`: **5,492 runtime passes**, 4 skips, zero failures; 25 feature tests and 9 build tests.
- Focused backend/transport/OOBE/authorization tests: **84 passes / 659 assertions**.
- Final post-build browser regression: **17 passes / 130 assertions**, including 12 Chromium/WebKit poller lifecycle/budget cases, two Classic mention-idle cases and three Settings catalogue cases.
- Full-app attribution run: **7 passes / 65 assertions**, with 30-second settling and 60-second recording per case. Earlier paired baseline and snapshot runs each passed six cases.
- All four typechecks, scoped lint, packaging hygiene, stale-bundle and environment-surface checks passed. The independently reproduced baseline-only compaction width failure is recorded above.
- The delegated second review of #1363 timed out. No independent review is claimed for this snapshot patch.

## Reproduce

Run through the isolated repository launcher, never the live application:

```sh
make build-web
PLAYWRIGHT_BROWSERS_PATH=/workspace/.cache/ms-playwright \
PICLAW_RUN_OPTIONAL_BROWSER_TESTS=1 \
bun run test:local --cwd runtime -- bun test \
  test/web/visual-status-polling.playwright.optional.test.ts

PLAYWRIGHT_BROWSERS_PATH=/workspace/.cache/ms-playwright \
PICLAW_RUN_OPTIONAL_BROWSER_TESTS=1 PICLAW_RUN_IDLE_CPU_PROFILE=1 \
PICLAW_IDLE_CASES=classic-idle,visual-idle,classic-minimal,visual-minimal \
bun run test:local --cwd runtime -- bun test \
  test/web/browser-idle-cpu.playwright.optional.test.ts
```

For exact paired assets, save the base Classic bundle as `.artifacts/baseline-assets/app.bundle.js` and Visual bundle as `visual.bundle.js`, then set `PICLAW_IDLE_BASELINE_ASSETS=1`. Snapshot assertions are disabled for the original assets. Set `PICLAW_IDLE_PROFILE=1` only for attribution runs; do not compare their CPU timings directly to unsampled runs.

## Outstanding #1352 work

The Visual idle AgentStatusPanel still owns a one-second timer; pane-specific media/editor/widget costs, native background behaviour, multiple physical tabs, and the reporter's browser/device/power mode still need profiling. This PR does not close the parent investigation. Standalone family/login pages and optional add-on refresh loops are outside this slice. No merge or reload is included.
