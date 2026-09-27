# Classic workspace collapse motion

Closing the desktop workspace moved the sidebar right because the shell switched to `justify-content: center` before the sidebar finished shrinking. The toggle also jumped immediately to the left edge.

## Change

- Keep the shell's flex row anchored left and centre only the collapsed chat using auto margins. Preserve the existing chat width constraints and editor-open exclusions.
- Transition the toggle's `left` position with the sidebar width. Disable toggle movement during sidebar resizing.
- Respect reduced motion for sidebar, splitter, chat and toggle transitions.
- Include the toggle and its icon in the existing resume-layout-settling transition guard.
- Rebuild the Classic CSS bundle and cache token. No JavaScript animation state, timers, runtime configuration or dependencies changed.

## Validation

All commands ran in the isolated `workspace-collapse-motion` worktree on Smith, using the repository test launcher and minimum niceness 10. Browser fixtures bind an ephemeral loopback port and block external requests; they do not access the live server.

| Check | Result |
| --- | --- |
| Regression against unchanged CSS | Four selected Chromium/WebKit cases failed: sidebar anchoring and reduced-motion settling |
| `make ci-fast` | 5,655 runtime passes, 7 skips, 0 failures; 25 feature checks and 9 build tests passed |
| Post-build optional browser tests | 20 passes, 0 failures, 1,130 assertions across motion and existing responsive suites |
| Focused visibility/shell unit tests | 14 passes, 42 assertions |
| `bun run typecheck` | Runtime, scripts, shared Settings and web panes passed |
| Scoped Oxlint, stale-dist, pack-hygiene, `git diff --check` | Passed |

Browser tests sample geometry during closing and reopening, not only final screenshots. They cover source CSS at 1024, 1366 and 1920 pixels; the built CSS at production transition speed; rapid direction reversal; retained draft, focus and tree scroll; an open editor with a resized sidebar; reduced motion; resume settling; and narrow/portrait drawers.

The first full-gate invocation was interrupted before completing. No child test processes remained; the subsequent complete run exited zero. A mistaken extra `typecheck:web-core` invocation named a nonexistent script; the final static-check run used the repository's actual `typecheck` command and exited zero. The build emitted the existing shared-passkey JSX pragma warning.

## Review and limits

A delegated source review identified the missing resume-settling toggle guard. The patch and browser regression resolve it; the follow-up review found no further blocker. Its non-blocking note concerns icon rotation if visibility changes during an active splitter drag; dragging alone does not change the icon's open/closed transform.

Tests use production CSS with a minimal DOM/class-toggle fixture, rather than the complete running application. Desktop WebKit coverage does not establish native iOS behaviour. No installation, deployment or restart was performed.

Local logs: `/workspace/tmp/workspace-motion-ci-final.log`, `workspace-motion-browser-final.log`, `workspace-motion-static-final.log`; the baseline failures are in `workspace-motion-red.log`.
