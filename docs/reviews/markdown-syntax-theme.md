# Markdown syntax colours

Timeline code fences and Markdown previews use the active theme's code foreground, background and syntax roles. System mode changes update existing blocks without re-rendering their Markdown.

## Corrections

- Visual's highlighter read `window.cmHighlight`, but the shipped shell no longer initialised that global. It now imports the shared CodeMirror vendor through the existing import map and uses the same semantic highlighter as Classic and the editor. Visual's language aliases and Bicep parser remain intact.
- Visual's timeline and workspace-preview containers did not match the shared syntax CSS scope. They now use the shared `--syntax-*`, `--text-code` and `--bg-code` variables, including the function role and imported theme colours.
- Visual's build externalises the editor vendor, avoiding a second parser bundle. Fences above 96 KiB fall back to escaped text, matching Classic's parsing bound.

Classic attachment previews and both skins' Markdown editor previews already use shared theme variables; regression coverage now includes their rendered fences alongside Visual workspace previews.

## Verification

Base: `a65ca1d49`. Worktree: `/workspace/piclaw-worktrees/markdown-syntax-theme`.

- Focused renderer/theme tests: **23 passes, 4,042 assertions**. Includes function-role parity, Bicep, unknown-language escaping and the large-fence fallback.
- Chromium and WebKit theme/editor tests: **52 passes, 21,084 assertions**. New coverage renders actual Markdown in timeline, preview and editor containers, then switches system dark/light, named themes and imported VS Code colours without replacing the nodes.
- Rebuilt Classic/Visual entrypoints: **4 browser passes, 20 assertions**. Verifies highlighted timeline fences without the old global, then live OS and SSE theme changes.
- Five typecheck projects pass; the existing 95 transitive frontend diagnostics are unchanged. Web build: **9 passes**.
- Full `make ci-fast` runtime phase: **5,795 passes, 7 skips, 2 failures**. Operator recovery exceeded its 5-second timeout and the note-retrieval release workflow exceeded its walk budget while another session's tests were running. Both unchanged files passed isolated retry: **5 passes, 135 assertions**, with original limits. The failed full command stopped before its feature/build phases; these phases were run separately.
- Final separate feature/build phases: **25 feature passes, 9 build passes**. Post-build new browser cases: **6 passes, 116 assertions**; renderer tests: **2 passes, 13 assertions**. Typechecks, scoped lint, stale-dist, pack hygiene and diff checks pass.
- Independent bounded source audit found no merge blockers.

Tests used disposable fixtures. No live settings, installation or restart. Merge requires separate approval.
