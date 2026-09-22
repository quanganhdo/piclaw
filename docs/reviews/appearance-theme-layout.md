# Appearance layout and intrinsic SynthWave glow

Corrects the deployed Appearance UX reported on 20 September 2026. The first shared-theme implementation exposed a separate glow checkbox and a table with eight raw colour-token headings. Those controls added clutter and squeezed the useful theme columns.

## Changes

- SynthWave glow is part of the theme. There is no checkbox, exported opt-out API or stored preference lookup. Historical `piclaw_synthwave_glow=off` values cannot suppress it.
- Switching away removes glow. Normal prose remains unglowing; forced-colours mode still suppresses decorative shadows for accessibility.
- Classic Appearance has four fixed-layout columns: Selected, Theme, Mode, Palette. Eight colours form one compact strip rather than eight headings.
- Theme names have flexible space, mode has a short fixed column, and palette strips remain visible on phones. Swatch tooltips retain role and colour values.
- The automatic-mode label and selector/help use a scoped two-column row that stacks when the content pane is narrow. Both skins use shorter explanatory text; no global settings sizing change.

## Verification

- 20 Chromium/WebKit cases passed, 1,452 assertions. Includes all 45 palettes, actual selection/import/reset, real terminal repaint, intrinsic glow with a legacy off preference, forced colours, and the full Classic Settings dialog at 1366/820/520/390px with all eight backend colour keys.
- Geometry checks require exactly four aligned columns, readable name widths, visible eight-colour strips and no content overflow.
- 40 focused theme/terminal/command tests passed, 1,330 assertions; repository typechecks and scoped lint passed.
- Full `make ci-fast` passed: 5,439 runtime tests, 4 skipped, zero failures; 25 feature tests and 9 build tests.

The earlier browser fixture used only three colour keys and did not reproduce the full dialog's constrained content area. It now uses all eight and mounts the real Settings dialog for the geometry tests. Physical mobile devices and screen-reader behaviour were not tested.

## Screenshots

- [Desktop Appearance](appearance-theme-layout/desktop.png)
- [Phone Appearance](appearance-theme-layout/phone.png)

No theme catalogue entries, protocol behaviour, add-on settings or live theme selection changed. Implementation is isolated; merge/reload require approval.
