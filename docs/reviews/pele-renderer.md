# Pele timeline renderer

The timeline uses Pele 1.6.0 through one lazy local asset and one shared Classic/Visual/Family lifecycle. This branch is stacked on PR #1652, exact base `7c50ada74887ee418721a1255121960da01930a6`, to build against the durable runtime architecture without modifying its implementation. PR #1655 is a separate contributor MCP preset change; this feature does not depend on it. Generated bundles must be rebuilt when integrating either branch.

## Scope

- Exact-pinned Pele, deterministic browser IIFE, provenance for Pele and bundled DOMPurify, complete package licence notices.
- Live theme-token colours for light/dark text, surfaces, connectors and chart series. Fixed authored colours remain fixed; no theme-driven regeneration.
- Host-owned limits, disabled diagram links/images, unique accessibility IDs, fail-closed sanitizer and text-only errors. The lazy loader joins overlapping callers, renders the latest streamed source and ignores removed placeholders.
- No new diagram controls, zoom, automatic direction changes or dimmed stale-error overlays.
- Legacy `beautiful-mermaid.js` remains separate and unchanged for existing artifacts and all eight public exports. No automatic fallback hides Pele failures. Old package removal requires an explicit compatibility migration for parser/theme helper callers.

## Local evidence before freeze

- Focus: 40 passed, 426 assertions across seven files, including 18 semantic corpus cases, explicit direction, IDs, authored colours, limits, no new navigation, vendor reproducibility, legacy public API and Family allowlisting.
- Chromium and WebKit: 29 passed / 648 assertions per engine before the image-set regression; new renderer suite after that correction: nine passed / 393 assertions per engine. Tests cover all host presets, imported light/dark themes, same-SVG recolouring in Classic/Visual/Family, complete corpus, cold/failed/overlapping loading, detached placeholders and sanitizer-unavailable denial.
- Actual Family rich-timeline case: one passed / 124 assertions. Wider Family suite fails its existing model/session-settings case, then browser closure cascades; untouched exact base reproduces the same 30-second failure. No deadlines changed. Logs retained under `/workspace/tmp/pele-assessment/`.
- `make build-web`: passed, nine build tests / 26 assertions; existing app/editor size ceilings unchanged. DOMPurify moved into the lazy Pele asset after the first app-size failure.
- Strict focused TypeScript, settings and pane typechecks, scoped lint, silent-swallow/structured-log/dependency/local-entrypoint checks, pack hygiene, stale-dist and whitespace checks passed.
- Aggregate `bun run typecheck` fails the existing web-compose audited baseline. Untouched exact base produced byte-identical diagnostics after normalising worktree names. No baseline waiver or unrelated type fix added.
- Bounded independent source judge found one P2: quoted relative CSS image-set resource URLs. Fixed standard/prefixed forms and added no-request browser regression; follow-up returned READY with no remaining P1/P2 in the reviewed renderer/security files.
- Light/dark old/new screenshots inspected. Single-run Chromium render+sanitize observations for 10/100/300 edges: about 5/16/40 ms; no performance SLA inferred.

## Frozen full gate

`make ci-fast` passed at `3a28393a2779e810b8941a9e61955bed0651b7c2`, tree `5fa230589b230b5f276650519f23aefd72d92ae7`: 7,327 passed / 84 skipped / 0 failed / 48,225 assertions across 1,009 files; feature stage 25 passed / 253 assertions; build stage nine passed / 26 assertions. Head/tree were identical before and after. The only untracked output was the retained browser screenshots. Frozen browser matrices passed 29 tests / 651 assertions per engine. The qualification receipt is `/workspace/exports/pele-renderer-qualification.json`.

The publication update changes documentation only; runtime/generated-assets parity with that frozen commit is verified separately. Aggregate typecheck and wider Family-suite baseline failures above remain disclosed. No merge, deployment, installation into the running runtime or restart is authorised by this work.
