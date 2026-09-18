# SVG image contract and implementation gap

Merged PR #1326 / issue [#1324](https://github.com/rcarmo/piclaw/issues/1324) separated desired acceptance from the old source-only baseline. Issue [#1325](https://github.com/rcarmo/piclaw/issues/1325) implements shared bounded SVG images and browser assertions.

## Revision evidence

- Piclaw [`70d33bc93`](https://github.com/rcarmo/piclaw/commit/70d33bc93ab540845bbcf5f80503ca8125c71594): Classic `runtime/web/src/markdown.ts` escapes source, parses Markdown and highlights code; it special-cases Mermaid but has no SVG-fence image converter. `runtime/web/src/components/post.ts` adds the normal source-copy control through `enhanceCodeBlocks`.
- Piclaw [`3f8ee0d2f`](https://github.com/rcarmo/piclaw/commit/3f8ee0d2f9eddab3828f9a5d4f626716469636d8) requested safe accessible SVG rendering in Gherkin/test wording. It did not implement the renderer and precedes 70d33bc93.
- Vibes [`4c9191b8`](https://github.com/rcarmo/vibes/blob/4c9191b86953bb564cc82a517f8d417fdc7751e7/src/vibes/static/js/app.js#L164-L189) sanitises fence content into a data-URL `img` with alt text, not page-DOM SVG. Its inspected helper has no explicit size limits and replaces malformed input with an “Invalid SVG” placeholder. It is a reference, not a complete implementation of our desired fallback/bounds contract.
- Tau (`rcarmo/tau-prime`) main [`3a0d734a`](https://github.com/rcarmo/tau-prime/blob/3a0d734ac264ab975b6fee6557889008824afcdb/src/tau_web/vibes/static/js/app.js#L351-L378) did not corroborate equivalent SVG-fence conversion in the inspected renderer. Other Tau revisions are unverified. Piclaw public main was still 70d33bc93 during the 16 September check; no later merged implementation was verified.

The source-only `@ux-original-029` introduced by #1323 described that Classic baseline. It was not a permanent product prohibition. #1324 moves the identity to [shared/svg-images.feature](../../shared/svg-images.feature) and keeps the negative observation here rather than using it as cross-port acceptance.

## Implemented acceptance and coverage (#1325)

Both skins call runtime/web/src/utils/svg-images.ts in the browser. The original XML is never inserted as host-page SVG. See [shared subset, limits and cache](../../shared/README.md). The historical source-only test has been replaced by runtime/test/web/svg-images.optional.test.ts, which imports actual production renderers and copy handlers. CI runs Chromium and WebKit explicitly; these are isolated DOM/component tests, not Gherkin auto-binding or a live server test.

| Stable ID | Direct assertions |
|---|---|
| ux-original-029 | Both-skin safe-image cases: model SVG DOM absent before trusted UI icons, decoded geometry/refs retained, image loads, accessible label, keyboard source-copy |
| ux-svg-001 | Both-skin raw SVG/XML/nested-code/Mermaid cases; attachment routing is unchanged and remains outside the fence converter |
| ux-svg-002 | Both-skin malicious XML/active element fixtures, DOM sentinel unchanged, requests recorded/aborted, dialog/navigation checks; root/descendant URI/style/event attributes and namespace resets |
| ux-svg-003 | Shared below/at/above byte/node/depth boundaries, byte rejection without XML parsing, both-skin over-limit code fallback |
| ux-svg-004 | Both-skin malformed/unsupported/incomplete/rejected/over-limit source; real fallback copy handler |
| ux-svg-005 | Both-skin title/default label, focus preserved, narrow and desktop widths, aspect ratio and keyboard disclosure |
| ux-svg-006 | Both-skin real copy-button handlers, original entities/CRLF at Clipboard API boundary, success/failure labels |
| ux-svg-007 | Both-skin incomplete-to-complete and repeated reconstruction; one image/source/control; cleanup of copy listeners |

The ordinary svg-images.test.ts also verifies no-DOM ordinary Markdown, incomplete CRLF/entity source, nested fences and YAML frontmatter. Structural canonical-ux-contract.test.ts checks shared/current/planned identity and tags, not renderer success.

## Validation and performance

- Frozen-lockfile install in the isolated renderer worktree repaired the stale local MCP package without a dependency change. MCP suite: four pass.
- Full make ci-fast: 5,329 runtime tests pass, four skips, zero failures; 25 feature-gate tests and nine web-build tests pass. Both frontend builds pass.
- Optional browser acceptance: ten tests per engine; Chromium and WebKit pass. Final assertion totals and exact CI runs are recorded in the PR.
- Typecheck and direct strict helper typecheck pass. Cucumber parses 26 files, 248 unique scenarios/outlines and 44 example rows; all indexed anchors and Markdown links resolve.
- Repo lint has unrelated baseline errors; no diagnostic names the changed SVG files. The contract PR previously documented that baseline.
- Independent security review: no blocker. Explicit namespace-reset rejection was tightened; the claimed uppercase-fence issue was already covered by the case-insensitive flag and is now tested.
- Representative desktop-container measurements (not phone guarantees): cold median roughly 0.2–1 ms / 20 shapes, 1.5–4 ms / 200, 12–21 ms / 1,500. Cold tails vary with JIT/GC and host load. 1,000 cached sanitizer calls took 0–0.2 ms at browser timer precision and performed zero XML parses. Ordinary messages also perform zero SVG XML parses. No hard wall-time threshold is asserted by tests.

## Running the tests

From repository root with installed browsers; set PLAYWRIGHT_BROWSERS_PATH when test filesystem isolation changes HOME:

```sh
bun run test:local --cwd runtime -- bun test test/web/svg-images.test.ts test/features/canonical-ux-contract.test.ts
PICLAW_RUN_OPTIONAL_BROWSER_TESTS=1 bun run test:local --cwd runtime -- bun test --timeout=30000 test/web/svg-images.optional.test.ts
PICLAW_RUN_OPTIONAL_BROWSER_TESTS=1 PICLAW_OPTIONAL_BROWSER=webkit bun run test:local --cwd runtime -- bun test --timeout=30000 test/web/svg-images.optional.test.ts
```

No live application server, external validation process or model provider is used. Page-initiated network requests are aborted and asserted absent. The browser processes are test infrastructure only.

## Historical contract/test PR validation — 16 September 2026

- Cucumber parsing: 26 files, 248 unique scenarios/outlines, 44 example rows (235 Classic / 5 Visual / 8 planned). All indexed line anchors and touched local Markdown links resolve. The other 240 scenario ASTs are unchanged from 70d33bc93.
- Repaired contract plus existing Markdown tests: 10 passed, 144 assertions.
- Isolated feature gate (`bun run ci:fast:features`): 25 passed, 164 assertions, including the repaired structural test.
- Optional baseline browser test: Chromium and WebKit each passed, 11 assertions per engine. No live application server or provider used.
- `bun run typecheck`, local-test-entrypoint check and `git diff --check`: passed.
- Full `make ci-fast` attempt did not pass: its runtime test child reported 5,322 pass, four skips, one failure/one error in the same missing MCP export (`getActiveMcpRuntimeOwnerCount`). The outer command timed out while the isolated child finished. A focused rerun on clean canonical main reproduced that export failure (zero pass, one failure/one error). No dependency repair or full-green CI claim is made.
- Repository lint fails with the same diagnostic set as clean main (compared after sorting). No diagnostic names the changed tests. Unrelated family/runtime lint repairs are outside this PR.
- Generated bundles touched by repository tests were restored; production source, dependency pins and bundles are unchanged in the patch.
- A bounded independent Gherkin/browser-test review returned no blockers after clarifying observables and strengthening the complete-message SVG DOM assertion. The initial broader review timed out and is not counted as approval.

When editing Gherkin, use the Cucumber parser from the existing `tests/e2e` dependency tree; do not add a second parser dependency or claim structural matching executes steps. Record parse counts, browser engines and gate outcomes in the PR. The #1323 [validation record](validation.md) remains historical and its old hash/path failure is not a current failure claim after this repair.
