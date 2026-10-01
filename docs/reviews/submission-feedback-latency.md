# Submission and working-feedback latency

Two reproducible feedback gaps can make an accepted submission look unresponsive. Classic waits for SSE to insert the returned user message; the server waits for model metadata before publishing initial working status. Neither delay is necessary to acknowledge the message.

## Observed runtime evidence

Smith runs portable PiClaw 3.2.4 under the user systemd service, not the workspace checkout. On 28 September 2026, the reported message followed this path:

| Event | UTC | Time since handler entry |
| --- | --- | --- |
| Handling agent message | 18:34:54.821 | 0 ms |
| Persisted message timestamp | 18:34:54.822 | 1 ms |
| Normal processing queued, after new-post broadcast | 18:34:54.878 | 57 ms |
| Session ready | 18:34:55.059 | 238 ms |
| Provider/model call started | 18:34:55.128 | 307 ms |
| First model response event | 18:35:06.377 | 11,556 ms |

The model-response wait was 11.25 seconds. A three-hour sample of Smith's logged first-response latency gave Astra a median of 11.8 seconds (96 calls) and Sol 5.6 seconds (50 calls); their p95 values were 22.4 and 19.2 seconds. This explains time to actual model output, not delayed display of the accepted user input.

Read-only idle status probes returned HTTP 200 on Smith, redshirt, sigma, sandbox and orangepi6plus. Smith's status/timeline requests took about 2 ms locally; the other hosts' first-byte times ranged from about 5 to 304 ms in one sample. These are idle endpoint measurements, not end-to-end proof for the affected remote submissions. The affected instance names and browser/network traces were not supplied.

Smith also logs frequent session eviction with a main-session pool limit of one and a 384 MiB memory-pressure threshold, despite having a 4 GiB container allocation. That may amplify cold starts, but this particular cold start took under 300 ms. No pool configuration was changed.

## Confirmed defects and fixes

### Classic discards the useful HTTP acknowledgement

The submission POST returns the already-stored `user_message`. Visual inserts it immediately through its existing response path. Classic only refreshed ancillary state and waited for `new_post` over SSE.

A shipped-shell fixture returning HTTP 201 while withholding SSE reproduces a missing Classic timeline row; the same test passes in Visual. Classic now inserts the durable acknowledged row immediately, using the existing ID deduplication logic. Later SSE does not duplicate it. Queued, UI-only, invalid, other-chat and filtered-view responses are excluded. The active-chat ref prevents delayed responses from entering another session.

This is a confirmed-server acknowledgement, not an optimistic message before acceptance. Upload time, a genuinely slow POST, and queued followups retain their existing semantics.

### Initial working status waits for optional metadata

`createProcessChatStreamingRuntime` awaited `getAvailableModels` before emitting its first thinking status. A gated metadata promise reproduces the absence of working feedback until the gate is released.

The initial lifecycle event is now emitted before that await. The metadata request explicitly excludes provider usage, diagnostics and the full catalogue. The same thinking event is emitted once, and its model/thinking labels are still available to subsequent stream formatting.

### SSE throttling is not the admission bottleneck

The coalescer throttles replaceable thought/draft/tool-display payloads. User `new_post` events go straight to the SSE hub, and initial lifecycle status is unthrottled. A regression leaves a 60-second display timer pending and verifies that the accepted input and initial working event are synchronously enqueued to the SSE client. The patch does not increase bulk-stream cadence.

## Validation and scope

Validated on the combined branch after merging main `01b15b061`:

| Check | Result |
| --- | --- |
| Full runtime suite | 5,750 passes, 7 skips, no failures; 38,043 assertions |
| Feature and build stages | 25 feature checks and 9 build tests passed |
| Post-build Chromium/WebKit shells, Classic/Visual | 4 passes, 36 assertions |
| Focused streaming, SSE and frontend tests | 43 passes, 146 assertions |
| Repository typecheck | All five configured projects/checks passed; 95 unchanged frontend baseline diagnostics |
| Stale-dist, pack hygiene and diff check | Passed |
| Independent source review | No blockers |

The first full runtime run hit two existing EF-S07 SQLite checkpoint timeouts. Unchanged focused retry passed all 18 cases without extending limits. The final full-gate parent shell was interrupted, but its runtime child continued; it was allowed to finish successfully before running the remaining feature/build stages explicitly. No duplicate runtime gate was launched. Logs: `/workspace/tmp/submission-ci-final.log`, `submission-features-final.log`, `submission-build-final.log`, `submission-browser-final.log`, `submission-focused-final.log`.

- Original Classic shipped-shell acknowledgement test failed; Visual passed after correcting its fixture endpoint.
- Original delayed-metadata working-status test failed; patched test passes and checks the slim metadata options.
- Chromium and WebKit, Classic and Visual: delayed SSE, HTTP-first/SSE-first deduplication, and rejected submission coverage.
- Focused frontend helpers guard chat/view boundaries and invalid or queued responses; existing stream/coalescer tests remain intact.
- Existing compose type baseline is audited: a callback type annotation is corrected, and an existing missing-input diagnostic has only its inferred object shape updated. No new type error is accepted.
- A pre-existing duplicate-key lint diagnostic in `app-main-orchestration-composition.ts` is unchanged; modified submission logic is independently checked.

Tests use disposable state/intercepted APIs. There were no test submissions, configuration changes, installations or restarts on live instances. These fixes address proven feedback gaps, not all possible causes of slow provider calls or remote network buffering.
