# Optional-pane idle lifecycle (#1352)

The always-mounted Classic workspace explorer previously kept its index-status
poll running while the drawer was closed, and open optional surfaces retained
interval callbacks while the document was hidden. The fix scopes workspace polls
to the visible drawer and uses one shared visibility-aware interval for workspace,
model settings and the opt-in system meters HUD.

Baseline: `4187dc78bb0187fecb9ad37f8a7e0344ed4a4c08`, 22 September 2026.
Disposable Chromium/WebKit fixtures only; no live notes, chats or profiling.

## Matched result

With a 60-second Playwright virtual-clock window and the workspace closed:

| Engine | Tree requests | Index-status requests, before → after |
| --- | ---: | ---: |
| Chromium | 0 | 1 → 0 |
| WebKit | 0 | 1 → 0 |

When open, one tree and one index-status refresh remain per configured minute.
A simulated hidden interval makes neither request; restoring visibility refreshes
both once. Closing clears the interval; setting the editor-active flag while the
workspace remains closed does not restart tree polling. Server workspace-visibility
pings remain and are excluded from these counts.

`createVisibleInterval` clears its interval while hidden, owns exactly one timer,
refreshes once on restoration and cannot restart after disposal. System meters
retain their immediate enabled refresh and normal cadence while visible. Models
settings retain model/SSE/focus event refreshes and their 15-second visible cadence;
the settings component already unmounts when its pane closes.

## Other optional panes

- The editor conflict monitor starts only for a mounted editor, owns one three-second
  timer, stops on conflict/stop/disposal, restarts after save/dismiss, and cannot
  restart after disposal. A deterministic timer-ownership regression now covers it.
- Terminal heartbeat is required protocol liveness only while its WebSocket is open.
  `dispose()` clears heartbeat/reconnect/resize resources and closes the socket.
  Existing teardown-race tests pass.
- Retained tab panes are hidden without disposal only while their tab remains open.
  Closing/pruning disposes them; full shell teardown disposes all. Existing cache
  lifecycle tests pass.
- VNC performs active remote-display work only for a live pane. Its idempotent
  `dispose()` stops the connection, resets the live session and removes its root.
  No timer-removal change is justified by the idle fixture.

These tests exercise app lifecycle events, not native browser background throttling,
OS CPU, GPU/compositor use, battery or physical Safari/iOS. The issue's manual
protocol remains the evidence path if symptoms persist on a specific device.

## Validation

- Workspace Chromium/WebKit lifecycle: 2 cases / 22 assertions.
- Combined browser smoke: 6 cases / 48 assertions, including status-clock idle and
  mounted generated-widget lifecycle.
- Focused optional-pane/unit tests: 48 pass / 144 assertions.
- All four typechecks and web build pass.

Together with the earlier mention-loop, shared snapshot, elapsed-clock and generated
widget fixes, all reproducible unnecessary idle callback sources found in the
disposable matrix are removed. Required protocol/media work remains explicit.
