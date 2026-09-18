# VNC viewer UX: implementation evidence

Tested on 2026-09-16 in the `feat/vnc-viewer-ux` worktree. No production reload, merge or desktop connection was performed.

## Scope

Classic now has a separate connection manager with configured targets, scoped successful history and a direct-connect form. A connected session shows only the framebuffer. Hover at the top centre, tap/swipe there, or press Ctrl+Alt+Shift+V for temporary controls. Local focus and open details retain controls; Escape or Hide returns to the desktop.

History records only target, label, last-success timestamp and pin state after a painted frame. It is origin-local and namespaced by an opaque hash of instance workspace, origin and account. It does not import old unscoped preferences. Configured targets do not bypass server policy. The existing family/isolated route denial remains unchanged.

The renderer, input encoding and WebSocket/TCP bridge were not replaced. The pane now fences asynchronous work by connection generation, releases input before local interaction, cancels retries on explicit disconnect, and records pipeline-painted frames as successful. Existing pop-out password handoff remains separate from history. Visual pane hosting is not part of this change.

## Reproduce

See [VNC viewer setup](../../runtime/skills/integrations/vnc-viewer-setup/SKILL.md). From the repository root, run:

```sh
PLAYWRIGHT_BROWSERS_PATH="$HOME/.cache/ms-playwright" \
  runtime/scripts/test-vnc-disposable.sh /tmp/vnc-evidence
```

The Linux runner creates a private network namespace and a separate X display, drops privileges before starting the desktop/browser, and uses real x11vnc at untouched `localhost:5901`. A second password-protected listener at 5902 exercises authentication failure/recovery. Both listeners and the X display are disposable. This cannot contact the host TCP desktop.

## Results

| Gate | Result |
|---|---|
| Runtime, scripts, settings and pane typechecks | Passed |
| Focused VNC/protocol/history/HTTP/family authorization suite | 92 passed |
| Full fast runtime test partition | 5,331 passed, 4 skipped, 0 failed across 752 files |
| Fast feature partition | 25 passed, including the current structural Gherkin contract |
| Web build, Classic/common and Visual | Passed; 9 build tests passed |
| Real x11vnc Chromium cases | 7 passed, 35 assertions |
| Changed-file lint | Passed |
| Dependency pins, pack hygiene, stale dist, environment inventory, local test entrypoints | Passed |
| Canonical workspace Gherkin | 19 scenarios parsed; dedicated VNC acceptance file adds 7 scenarios |

The broad `make ci-fast` call exceeded the tool wait while its runtime child continued; the child finished with zero failures. The remaining feature/build phases were run separately. This is not reported as one uninterrupted `make ci-fast` success. Repository-wide lint reports 20 pre-existing diagnostics in untouched files; changed-file lint passes. After merging current `main`, the fast feature runner includes the structural Gherkin contract. Its initial CI failure identified missing stable IDs on the seven VNC scenarios; `@ux-vnc-001` through `@ux-vnc-007` fix that omission. All 25 feature checks now pass.

## Real-browser coverage and limits

- Actual 1024×768 pixels, terminal keyboard input verified through a fixture file, ClientCutText verified in the X cut buffer, and remote clipboard reception. This is not merely a WebSocket greeting.
- Hover reveal/hide; open-details retention; keyboard shortcut and Escape; real touch tap at 820 and 390px; no horizontal manager overflow in Classic light theme.
- Reconnect, duplicate suppression, pins and clear-recents; read-only pointer/keyboard/clipboard restrictions; authentication failure then successful retry; unavailable/denied target recovery; disposal during a pending session load; blocked history storage.
- Unit checks cover history bounds/corruption, no arbitrary secret fields, distinct account namespaces and stable namespaces across login rotation.
- The fixture mounts the real Classic pane and real session service/HTTP bridge. It does not pretend to validate the full app's login/pane-host navigation. Existing backend tests cover family denial. Touch evidence is Chromium's touchscreen emulation, not physical iOS hardware.
- x11vnc's ZRLE path exercised the existing timed RAW fallback on this fixture. The accepted framebuffer/input/clipboard checks ran against the resulting real stream; this work makes no new decoder-compatibility claim.

## Screenshots

These captures use the real disposable desktop, not the earlier prototype.

- [Desktop connection manager](vnc-viewer-ux/connections-desktop.png)
- [Framebuffer only](vnc-viewer-ux/framebuffer-desktop.png)
- [Revealed controls](vnc-viewer-ux/controls-desktop.png)
- [Phone manager, Classic light](vnc-viewer-ux/connections-390-light.png)
- [Phone touch controls](vnc-viewer-ux/touch-controls-390.png)
- [Tablet manager, Classic light](vnc-viewer-ux/connections-820-light.png)

## Specification mapping

`@ux-workspace-015` in the canonical workspace feature now describes the manager, successful history, temporary controls and recovery. The dedicated [VNC pane feature](../../tests/e2e/features/classic/panes/vnc.feature) is acceptance prose; its comments name the executable optional browser suite rather than claiming unimplemented Gherkin step bindings. The canonical completion index and workspace audit link to this evidence.
