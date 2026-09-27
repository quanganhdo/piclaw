# Standalone iOS theme chrome

The reported Home Screen webapp retains its old safe-area colour until opening the dashboard triggers a repaint. This patch corrects the theme startup and browser-chrome paths without a dashboard dependency.

## Confirmed inconsistencies

- Both HTML shells used a short, obsolete preset list before the application loaded. New dark themes such as SynthWave Full and Lumon initially painted white and declared light mode.
- Runtime selection changed `apple-mobile-web-app-status-bar-style` from `black-translucent` to `default` for light palettes. This changes the standalone viewport contract during a palette switch.
- Theme-colour media tags could advertise another palette when the user's explicit colour mode differed from the OS.
- Visual imports changed document backgrounds without updating theme-colour metadata. Resume had no shared mechanism for preserving imported chrome colours.

## Changes

The build generates an inline, background-only catalogue projection before either skin's stylesheet. It resolves the saved palette, alias, explicit/system mode, tint and Visual custom background; body creation uses the current root colour rather than a stale captured colour. The canonical catalogue remains the source of preset values.

Bundled themes and imports share document background and browser-meta updates. Both legacy media-qualified theme-colour tags agree with the chosen background. The status-bar mode stays `black-translucent` in light and dark palettes, matching the shell's original viewport contract.

On visible Apple standalone pages, one coalesced animation frame replaces the dynamic theme-colour element with an identical copy after styles are applied. This asks WebKit to resample its browser chrome without changing body transforms, dimensions, scroll position or focus. Theme changes replace pending work; teardown and hiding cancel it. Other browsers/tabs do not schedule that frame. Page restoration and becoming visible reapply the current computed background, including imports.

There is no interval, repeated repaint loop, animation, dashboard call or viewport-height change.

## Verification

- Generated HTML is checked against the current catalogue generator and placed before stylesheet loading.
- Chromium and WebKit exercise both skins: every preset's startup background, cold page reload, explicit mode against OS preference, short/full/named/RGB tints, custom imports, reset, restoration and metadata consistency.
- Standalone behaviour is simulated through browser navigator properties. Tests verify a single coalesced frame, cancellation on teardown, no scheduling while hidden or in a normal tab, and no changes to focus, scroll position or viewport dimensions.
- Existing palette, syntax and theme-effect suites remain part of regression validation.

Local results: 13 focused tests / 1,903 assertions; 46 catalogue/chrome browser cases / 3,354 assertions; 64 post-build chrome/effects browser cases / 1,028 assertions. The full gate passed 5,650 runtime tests (seven skips), 25 feature tests and nine build tests. Four typechecks, scoped lint, pack hygiene, stale-dist and diff checks pass.

The delegated read-only review timed out; there is no independent review result for this patch.

**Native iOS safe-area pixels cannot be verified by desktop Playwright.** These tests establish the DOM/state contract, not that Safari has painted the OS-controlled safe area. On-device confirmation is required: launch the Home Screen app with SynthWave Full or Lumon, switch light/dark or imported themes, background/resume it, and check the top/bottom safe areas without opening the dashboard. No live theme settings were changed during testing.
