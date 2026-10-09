# Visible divider scroll chevrons

Classic and Visual now show a bold downward chevron on each side of the central divider grip when scrolled away from the latest message. The arrows use 3px CSS strokes, primary text colour and the existing new-message accent. A clear gap separates them from the 36px grip. Existing drag, tap and keyboard handlers remain unchanged; decorative spans are aria-hidden and pointer-transparent.

Classic's centred button expands from 48×20 to 100×24 pixels to cover both arrows. Visual retains its full-width divider button. Two unused bindings already present in the changed Classic component were removed to pass scoped lint; their baseline diagnostics are retained. Generated Classic, Visual and shared family bundles were rebuilt.

## Qualification

Frozen head `d1b314de7dc2437201f9f7db3c96b7b5a282ad90`, tree `06d3148e0067c2d89f5c830250a78d9de6636f75`, runtime tree `cca9ed69d41177044fc8ba62ed8a926a2c78a9e7`.

- Complete gate: 6,553 passed / 8 skipped / 0 failed, 42,805 assertions across 931 files, 652.48s.
- Rebuilt browser matrix: 17 passed / 168 assertions; Chromium/WebKit, actual Classic/Visual, desktop and 390px geometry. Checks both arrows, symmetry, stroke, >6px grip clearance and pointer/accessibility isolation. Existing history, catch-up and drag-versus-tap assertions remain.
- Settings contracts: 25 passed / 246 assertions; web build: 9 passed / 26 assertions.
- Types and scoped lint passed; 95 unchanged transitive frontend diagnostics.
- Scoped explicit 6.1 source review CLEAR; read-only, no reviewer tests. Earlier review timeout supplied no approval.

Full gate ran 6 October 2026 08:17:11–08:28:13 UTC with a clean unchanged head/tree before and after. Log SHA-256 `19950f50302ecc18cf29230fcdda5b9a9d361bbd07d086cbf54888c739468577` at `/workspace/tmp/divider-chevron-full/ci-fast.log`.

First browser matrix had one timeout in the unchanged WebKit tall-viewport test; retained at `/workspace/tmp/divider-chevron-browser.log`. The unchanged rerun passed 17/112; the final expanded rebuilt matrix passed 17/168. Deadlines and assertions were not relaxed.

Publication changes are documentation/receipts only, with runtime parity required. No live UI mutation, provider/account/configuration change, installation or restart.
