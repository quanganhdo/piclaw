# Requested catalogue additions and SynthWave Full

Implemented in an isolated branch from `3ebb5fc91`, following the user's requested vscodethemes list and explicit request for pulsing/animated Full glow. No live palette/settings, installation, merge or reload performed.

## Included

- Turbo Pascal (Original): the catalogue's `ionis.modern-turbo-pascal-ui` Original blue/grey palette.
- Tokyo Night: preserve `tokyo` ID and add Storm/Light; use the canonical source repository behind `enkia.tokyo-night`.
- Noctis and Noctis Lux: original dark and representative light variant.
- Bearded Arc: immutable MIT snapshot `01455843a944ec51216b373a13bd620fbea92e5a`; current upstream GPL licensing is documented and not silently copied.
- Catppuccin: Latte/Mocha retained, Frappé/Macchiato added from official palette 1.8.0. `catpuccin` spelling alias supported.
- Nord: existing ID retained with source-derived palette roles.
- AS/400 Green Screen (5250): the exact `jordan-diaz-dev.as400-cursor` entry, adapted to strictly green/black syntax, status, overlays and all ANSI roles. Error/warning meaning uses labels/icons/intensity rather than source red/yellow accents.
- Lumon: the exact trending `oldjobobo.lumon-theme` publisher, not another similarly named extension.
- SynthWave ’84 Normal remains steady; **SynthWave ’84 Full** has bright cores/layered halos, slow pulsing syntax and animated accent lighting. See [Full evidence](synthwave-full.md).

Total: 56 shared IDs/variants. Mode inconsistencies in source JSON are explicitly corrected: Original Turbo Pascal is dark, Tokyo Night Light is light. All requested catalogue URLs were retrieved successfully; immutable upstream JSON hashes, source commits, licence attribution and known historical-source limitations are recorded in `runtime/vendor-manifests/theme-palettes.json` and [theme documentation](../theme-palettes.md).

## Validation

- **38 Chromium/WebKit browser cases passed, 3,248 assertions**, including 16,736 individual rendered-colour comparisons in the exhaustive syntax/import checks. Both real Appearance components, all 56 palette applications, twelve requested variants selected by accessible UI names, normal/full effects and actual highlighted code, reduced motion, forced colours, simulated hidden-document pause, switching/import/reset and mounted xterm.
- **48 focused tests passed, 3,947 assertions:** all catalogue roles/contrast, source identity/mode/aliases, explicit ANSI overrides plus existing theme/terminal/command coverage.
- **Full `make ci-fast` passed:** 5,458 runtime tests, 4 skipped, zero failures; 25 feature tests and 9 build tests.
- Repository typechecks, scoped lint, environment inventory, package hygiene, stale-dist and diff checks passed.
- Independent delegate review timed out and is not counted as approval. No physical Apple/Windows, native hidden-tab or OS CPU/battery measurements are claimed. Full motion is intentional and can increase visible paint/compositing work; no browser-loop regression claim follows merely from CSS-only implementation.

## Actual rendered snippets

- [Turbo Pascal](requested-themes/turbo-pascal.png)
- [AS/400](requested-themes/as400.png)
- [Lumon](requested-themes/lumon.png)
- [Bearded Arc](requested-themes/bearded-arc.png)

These are browser-rendered theme/highlighter fixtures, not live user content. Following the syntax audit, both `.post-content` and a mounted CodeMirror editor use a shared role contract and highlighter. AS/400 regression checks require zero red/blue channels in rendered syntax/status/overlay/terminal values; Full's bright cores are also checked inside this real scope. [The per-theme syntax audit](theme-syntax-audit.md) records source precedence, every role and documented fallbacks. Lumon uses the exact OldJobobo source, including its semantic token colours. The complete browser matrix includes both skins and desktop/phone Appearance geometry. Source websites are used only at authoring time; there is no runtime theme download.
