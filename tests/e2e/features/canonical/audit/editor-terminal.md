# Editor + terminal feature audit

Classic source inspected: `runtime/web/src/components/tab-strip.ts`, `runtime/web/src/components/markdown-preview.ts`, `runtime/web/src/ui/use-editor-state.ts`, `runtime/web/src/ui/app-browser-events.ts`, `runtime/web/src/ui/use-splitters.ts`, `runtime/web/src/ui/app-pane-runtime-orchestration.ts`, `runtime/web/src/ui/app-main-shell-render.ts`, `runtime/web/src/panes/terminal-pane.ts`, `runtime/web/src/panes/terminal-theme-runtime.ts`.

## tests/e2e/features/classic/editor/editor-stability.feature

| Scenario | Evidence | Status | Notes |
| --- | --- | --- | --- |
| Switching files does not cause visible flicker | `tests/e2e/steps/us04-editor.spec.ts` | test | Reframed to visible pane + no loading placeholder; no source-level flicker metric. |
| Closing an unsaved tab shows confirmation | `runtime/web/src/ui/use-editor-state.ts`; `tests/e2e/steps/us04-editor.spec.ts` | source+test | Dropped unsupported explicit “Don't save” / “Cancel” button flow; Classic uses `window.confirm(...)`. |
| Clicking a tab activates it immediately | `runtime/web/src/components/tab-strip.ts`; `tests/e2e/steps/us04-editor.spec.ts`; `tests/e2e/steps/us25-safe-area-layout.spec.ts` | source+test | Anchored to `handleTabMouseDown(...)` activation-on-press behavior. |
| Markdown preview is stable during splitter resize | `runtime/web/src/components/markdown-preview.ts`; `tests/e2e/steps/us04-editor.spec.ts` | source+test | Corrected “split ratio” to stored preview height; source writes preview panel height after drag. |
| Zen mode does not spike CPU on hover | `runtime/web/src/ui/app-browser-events.ts`; `runtime/web/src/ui/app-main-shell-render.ts`; `tests/e2e/steps/us04-editor.spec.ts` | source+test | Removed unsupported CPU baseline / layout-thrashing magic values; kept zen shell visibility assertions only. |

## tests/e2e/features/classic/panes/terminal.feature

| Scenario | Evidence | Status | Notes |
| --- | --- | --- | --- |
| Open terminal standalone without garbled output | `runtime/web/src/panes/terminal-pane.ts`; `tests/e2e/steps/us13-15-terminal.spec.ts` | source+test | Dropped blinking-cursor assertion; kept rendered surface + theme-backed container checks. |
| Execute ls -al in terminal | `runtime/web/src/panes/terminal-pane.ts`; `tests/e2e/steps/us13-15-terminal.spec.ts` | source+test | Relaxed to recognizable shell text instead of exact column-alignment formatting. |
| Terminal opens clean without IME active | `runtime/web/src/panes/terminal-pane.ts`; `tests/e2e/steps/us13-15-terminal.spec.ts` | source+test | Replaced unsupported IME/CJK mode assertions with plain ASCII echo evidence. |
| Close terminal via tab close button (click) | `runtime/web/src/components/tab-strip.ts`; `runtime/web/src/ui/app-main-shell-render.ts`; `tests/e2e/steps/us13-15-terminal.spec.ts` | source+test | Scoped to visible terminal close controls only. |
| Close terminal via tab close button (tap) | `runtime/web/src/components/tab-strip.ts` | source | Pointer/touch close-path exists; no direct canonical touch assertion found. |
| Pop out terminal to new window (desktop) | `runtime/web/src/ui/app-main-shell-render.ts`; `runtime/web/src/components/tab-strip.ts` | source | Corrected from tab-only/button-specific language to generic pop-out + reattach affordance. |
| Terminal theme matches UI theme | `runtime/web/src/panes/terminal-pane.ts`; `runtime/web/src/panes/terminal-theme-runtime.ts`; `runtime/test/web/terminal-pane.test.ts`; `runtime/test/web/terminal-theme-runtime.test.ts` | source+test | Removed magic theme-name dependency. |
| Toggle terminal dock via keyboard shortcut | `runtime/web/src/ui/keyboard-shortcuts.ts`; `runtime/web/src/ui/app-browser-events.ts`; `tests/e2e/steps/us13-15-terminal.spec.ts` | source+test | Keeps Classic `Ctrl+Backtick` contract. |
| Toggle terminal dock via tab strip button | `runtime/web/src/components/tab-strip.ts`; `tests/e2e/steps/us13-15-terminal.spec.ts` | source+test | Matches `.tab-strip-dock-toggle`. |
| Dock splitter resizes terminal height | `runtime/web/src/ui/use-splitters.ts`; `runtime/web/src/ui/app-main-shell-render.ts`; `tests/e2e/steps/us13-15-terminal.spec.ts` | source+test | Corrected to observable height change, not proportional editor math. |
| Terminal dock is interactive alongside editor | `runtime/web/src/panes/terminal-pane.ts`; `tests/e2e/steps/us13-15-terminal.spec.ts` | source+test | Keeps cross-focus input routing only. |
| Dock hidden in zen mode | `runtime/web/src/ui/app-pane-runtime-orchestration.ts`; `tests/e2e/steps/us13-15-terminal.spec.ts` | source+test | Source explicitly hides dock on zen enter. |
| Zen mode hides all chrome except the terminal/editor | `runtime/web/src/ui/app-pane-runtime-orchestration.ts`; `runtime/web/src/ui/app-main-shell-render.ts`; `tests/e2e/steps/us13-15-terminal.spec.ts` | source+test | Scoped to visible editor/terminal surface instead of viewport-fill geometry. |
| Zen mode has permanently visible exit indicator | `runtime/web/src/components/tab-strip.ts`; `tests/e2e/steps/us13-15-terminal.spec.ts` | source+test | Dropped unsupported “permanently visible” and `44x44` tap-target requirement; Classic evidence is hover-discoverable clickable toggle. |
| Clicking zen exit indicator reverts to normal layout | `runtime/web/src/components/tab-strip.ts`; `runtime/web/src/ui/app-pane-runtime-orchestration.ts`; `tests/e2e/steps/us13-15-terminal.spec.ts` | source+test | Anchored to zen toggle control. |
| Escape key exits zen mode | `runtime/web/src/ui/app-browser-events.ts`; `tests/e2e/steps/us13-15-terminal.spec.ts` | source+test | Direct shortcut support exists in Classic. |
| Hover-reveal tab strip in zen mode | `tests/e2e/steps/us13-15-terminal.spec.ts` | test | Removed unsupported fade timing / fade-out assertions; retained hidden-by-default then visible-on-hover. |

## Stable scenario cross-reference

IDs below refer to the source/correction tables above by feature and current title. Review state: source checked; bounded independent packet reviewed; browser not run. A related test path is not a per-clause execution claim.

| ID | Current scenario | Feature |
|---|---|---|
| ux-editor-001 | Switching files does not cause visible flicker | [classic/editor/editor-stability.feature](../../classic/editor/editor-stability.feature#L14) |
| ux-editor-002 | Closing an unsaved tab shows confirmation | [classic/editor/editor-stability.feature](../../classic/editor/editor-stability.feature#L22) |
| ux-editor-003 | Clicking a tab activates it immediately | [classic/editor/editor-stability.feature](../../classic/editor/editor-stability.feature#L30) |
| ux-editor-004 | Markdown preview is stable during splitter resize | [classic/editor/editor-stability.feature](../../classic/editor/editor-stability.feature#L40) |
| ux-editor-005 | Zen mode keeps editor content visible while other shell panes are hidden | [classic/editor/editor-stability.feature](../../classic/editor/editor-stability.feature#L49) |
| ux-terminal-001 | Open terminal standalone without garbled output | [classic/panes/terminal.feature](../../classic/panes/terminal.feature#L12) |
| ux-terminal-002 | Execute ls -al in terminal | [classic/panes/terminal.feature](../../classic/panes/terminal.feature#L20) |
| ux-terminal-003 | Terminal opens clean without IME active | [classic/panes/terminal.feature](../../classic/panes/terminal.feature#L28) |
| ux-terminal-004 | Close terminal via tab close button (click) | [classic/panes/terminal.feature](../../classic/panes/terminal.feature#L35) |
| ux-terminal-005 | Close terminal via tab close button (tap) | [classic/panes/terminal.feature](../../classic/panes/terminal.feature#L43) |
| ux-terminal-006 | Pop out terminal to new window (desktop) | [classic/panes/terminal.feature](../../classic/panes/terminal.feature#L50) |
| ux-terminal-007 | Terminal theme matches UI theme | [classic/panes/terminal.feature](../../classic/panes/terminal.feature#L57) |
| ux-terminal-008 | Toggle terminal dock via keyboard shortcut | [classic/panes/terminal.feature](../../classic/panes/terminal.feature#L70) |
| ux-terminal-009 | Toggle terminal dock via tab strip button | [classic/panes/terminal.feature](../../classic/panes/terminal.feature#L79) |
| ux-terminal-010 | Dock splitter resizes terminal height | [classic/panes/terminal.feature](../../classic/panes/terminal.feature#L87) |
| ux-terminal-011 | Terminal dock is interactive alongside editor | [classic/panes/terminal.feature](../../classic/panes/terminal.feature#L98) |
| ux-terminal-012 | Dock hidden in zen mode | [classic/panes/terminal.feature](../../classic/panes/terminal.feature#L107) |
| ux-terminal-013 | Zen mode hides all chrome except the terminal/editor | [classic/panes/terminal.feature](../../classic/panes/terminal.feature#L119) |
| ux-terminal-014 | Zen mode has a hover-discoverable exit control | [classic/panes/terminal.feature](../../classic/panes/terminal.feature#L127) |
| ux-terminal-015 | Clicking zen exit indicator reverts to normal layout | [classic/panes/terminal.feature](../../classic/panes/terminal.feature#L135) |
| ux-terminal-016 | Escape key exits zen mode | [classic/panes/terminal.feature](../../classic/panes/terminal.feature#L144) |
| ux-terminal-017 | Hover-reveal tab strip in zen mode | [classic/panes/terminal.feature](../../classic/panes/terminal.feature#L152) |
