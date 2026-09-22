# SynthWave normal and Full

Adds a separately selectable **SynthWave ’84 Full**, while preserving the existing **SynthWave ’84** ID and steady glow. The earlier implementation used a restrained two-layer shadow on three syntax categories. It was an approximation, not a faithful reproduction of the upstream bright-core treatment.

## Full treatment

- Pale neon cores with layered coloured halos, adapted from upstream SynthWave's token replacements to actual Piclaw syntax classes.
- Keyword/yellow, number/type/cyan, function/property/pink, literal/inserted/green and invalid/deleted/red roles; orange string halos extend the treatment to Piclaw's existing string palette.
- Slow 5.5-second syntax pulse and 4.8-second accent light animation. These animations are Piclaw additions, not upstream behaviour.
- Active-tab neon edge, glowing primary controls and cyan/magenta accent halos. Full now also gives ordinary chat text, inputs and the compose frame neon treatment; see [the UI/focus correction](synthwave-full-ui.md). Normal keeps its original static syntax-only treatment.
- No rapid flashing or whole-page flicker. Reduced motion disables animation but retains strong static glow. Hidden-document events pause CSS animations. Forced colours disable shadows/motion. Switching away removes the treatment.

There is no animation timer or RAF loop in the theme runtime: one visibility listener sets a CSS state. Visible Full can still incur paint/compositing work; no CPU or battery claim is made. Canvas terminals follow the palette but cannot receive DOM syntax text shadows.

## Evidence

- Actual Classic and Visual theme selectors expose Normal and Full separately.
- Chromium/WebKit tests verify a running Full animation timeline, different bright-core colour, wider shadows, glowing prose, normal static behaviour, reduced-motion/forced-colour handling, and complete removal after switching.
- The hidden test explicitly overrides `document.hidden` and dispatches `visibilitychange`. It validates the handler and CSS pause, not native headless background-tab throttling.
- The moving preview is 44 actual browser captures sampled at 125ms intervals from the CSS animation timeline. It is not a production screen recording.
- Existing all-palette, import/reset, mounted terminal and Appearance-column regressions remain in the suite.

Normal and Full use the same base palette. The follow-up catalogue request brings the total to 56 entries, including source-verified Turbo Pascal, Tokyo Night/Storm/Light, Noctis/Lux, historical MIT Bearded Arc, four Catppuccin flavours, Nord, AS/400 Green Screen and OldJobobo Lumon. Existing bookmarks and `/theme synthwave` remain Normal; `/theme synthwave-full` selects Full.

## Captures

- [Normal](synthwave-full/normal.png)
- [Original syntax-focused Full preview](synthwave-full/full.png)
- [Original syntax motion preview](synthwave-full/full-motion.gif)
- [Full UI and input-focus correction](synthwave-full-ui.md) — current composer, picker and prose captures

Upstream reference: [token glow replacement formulas](https://github.com/robb0wen/synthwave-vscode/blob/master/src/js/theme_template.js). Source hash and existing MIT licence notice are recorded in the theme palette manifest/licence file. No upstream VS Code injection or MutationObserver bootstrapping is copied.

The requested-family tests select every added variant through actual Appearance controls in both engines/skins and check native mode/background and lack of Full animation on other themes. Source inconsistencies (Turbo Pascal labelled light and Tokyo Night Light labelled dark) are resolved by actual palette mode. Explicit ANSI roles are supported so AS/400 green does not inherit unrelated accent-derived terminal colours.

No live palette/configuration changes, merge or reload performed. Local validation results are recorded in the PR receipt.
