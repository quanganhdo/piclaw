# Focus contours, session labels and native tooltips

The field/composer focus indicator now overlays the existing border instead of drawing a second outline outside it. Session labels use explicit line heights, attachment backdrops remain translucent, and timestamp/context details use native browser `title` tooltips only.

## Corrections

- The generic field ring had a two-pixel external offset over an already highlighted border. Visual's composer added a sharp one-pixel box shadow, and Full's pulse had another zero-blur rim. Focus now uses a negative two-pixel offset for fields and compose frames. Ordinary focus shadows are suppressed; Full retains blurred neon halos and its animation, without the sharp outer rim. Button/link keyboard indicators keep their existing offset. The inner compose textarea remains borderless.
- Classic's session label mixed an 11px line box with vertical padding; Visual inherited different default button fonts in Chromium and WebKit. Classic now uses the existing mono stack at 12px/16px with horizontal-only padding. Visual explicitly uses the UI font at 12px/16px (the existing 11px mobile override remains). Label and parent centres match within one pixel in the tested engines.
- `.image-modal` and Visual `.lightbox__backdrop` use `--media-backdrop`, derived from the theme background at 0.62 alpha. Images, attachment shells and controls retain full opacity. This affects attachment/image previews; other modal overlays are unchanged.
- Classic timestamps retain every available timing, input/output/reasoning/cache and cost field but pack them into at most five native-title lines: sent/duration, token totals, reasoning/cache, cost provenance, start time. No authored data is truncated by the formatter. Visual timestamps retain their existing native date title.
- The context pie's duplicate `data-tooltip`/CSS pseudo-popup is removed. Classic and Visual context indicators retain native `title` details and compaction actions. Existing model-picker tooltip behavior is unchanged.

No tooltip library, portal, JavaScript positioning or replacement tooltip UI is added. Browser-controlled tooltip appearance, wrapping and platform truncation remain outside page CSS control. Tests inspect complete title text and absence of custom tooltip markup; they do not claim to control native popup dimensions.

## Verification

- Updated real-component suite: **56 Chromium/WebKit cases / 926 assertions**, covering both skins, all 56 presets, imported palettes, 390px/1280px layouts, focus/blur/keyboard behavior, Full animation keyframes and accessibility modes.
- Existing shared-theme, model/session picker and responsive picker suites: **57 browser passes / 4,527 assertions**.
- Timing/attachments/shared-theme focused suite: **27 passes / 1,947 assertions**.
- Screenshot/geometry evidence uses actual components with synthetic data. Session tests measure text-range and label/parent centres; full theme tests verify no extra zero-blur spread at three animation phases. Lightbox tests check alpha, full image opacity, close controls and backdrop/Escape dismissal.
- Full `make ci-fast`: **5,541 runtime passes**, 4 skips, zero failures; 25 feature tests and 9 build tests. Four typechecks and scoped lint pass.
- No new network polling or background loop. No live theme/settings changes, installation or reload.

## Captures

- [Classic compose focus](focus-session-lightbox-tooltips/compose-phone.png)
- [Visual translucent lightbox](focus-session-lightbox-tooltips/lightbox.png)
- [Classic session label](focus-session-lightbox-tooltips/session-label.png)
