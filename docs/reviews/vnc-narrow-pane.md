# VNC narrow-pane layout

The connection manager used the browser viewport to choose its layout and kept a 250px right column even when the VNC pane was narrow. The earlier phone tests did not exercise a narrow docked pane inside a wide application window.

## Fix

- A named inline-size container measures the VNC pane. The safe default is one column; two columns start at 720px of pane width.
- New connection comes first in the narrow layout and DOM/tab order. On wide panes the saved list remains on the left and the form on the right.
- Server and port inputs remain usable at 280px. Long target labels use ellipsis, with full text retained in the DOM and title; pin/remove buttons keep their width.
- Help is collapsed under Viewer controls instead of competing with the form. Shorter supporting text and explicit spacing keep the screen compact.
- Return to desktop is at the top of the history overlay. Session controls stay width-bounded and scroll in short panes; resizing preserves form values and the live session.
- No protocol, renderer, authentication, read-only policy, stored-history format or keyboard/pointer mapping changes.

## Evidence — 18 September 2026

The 360px embedded-pane regression failed on the old CSS in both Chromium and WebKit. The host input remained constrained by the fixed second column instead of using available pane width.

- 22 layout cases / 244 assertions passed: Chromium and WebKit; 280, 360, 520, 680 and 900px panes inside a 1440px viewport; light/dark; ten history rows with long labels; password expansion, filtering, clear/pins, short-height scrolling and live width changes.
- 9 real x11vnc cases / 63 assertions passed. Existing framebuffer/input/clipboard/reconnect/auth/read-only tests plus Chromium and WebKit narrow embedded desktop/overlay tests. The default remains localhost:5901 inside a private network namespace with a separate disposable X display.
- 61 focused VNC protocol/history/layout tests passed. All typechecks and changed-file lint passed.
- Full `make ci-fast` passed: 5,412 runtime tests, 4 skipped, zero failures; 25 feature and 9 web-build tests. The first run hit the existing five-second token-usage migration timeout; the DB file passed alone and the complete rerun passed without database/timeout changes.

The layout suite uses a mocked session-metadata endpoint and cannot connect upstream. The separate desktop suite uses the actual pane and backend services with real x11vnc. WebKit runs on Linux; physical iOS/macOS devices were not tested.

## Captures

- [360px connection pane inside a wide window](vnc-narrow-pane/manager-360.png)
- [280px light connection pane](vnc-narrow-pane/manager-280-light.png)
- [Real desktop history overlay](vnc-narrow-pane/real-history-overlay.png)
- [Real desktop controls in a short narrow pane](vnc-narrow-pane/real-controls.png)

## Reproduce

From the repository root after installing dependencies and Playwright browsers:

```sh
PICLAW_RUN_OPTIONAL_BROWSER_TESTS=1 \
PLAYWRIGHT_BROWSERS_PATH="$HOME/.cache/ms-playwright" \
  bun run test:local --cwd runtime -- bun test test/web/vnc-narrow-pane.playwright.optional.test.ts

PLAYWRIGHT_BROWSERS_PATH="$HOME/.cache/ms-playwright" \
  runtime/scripts/test-vnc-disposable.sh /tmp/vnc-narrow-evidence
```

The layout test writes captures under `.artifacts/vnc-narrow-pane/`. The real runner refuses the host network namespace and cleans up its desktop. Never point acceptance tests at the production desktop. Acceptance prose is mapped to `@ux-vnc-003` in `tests/e2e/features/classic/panes/vnc.feature`.
