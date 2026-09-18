# Import UX specifications by skin

Import one skin root plus `shared/`. Each stable scenario ID occurs once across all roots. Reserved `planned/` contracts must remain separate from implemented acceptance.

| Skin | Import glob | Feature files | Scenarios / outlines | Example rows |
|---|---|---:|---:|---:|
| Classic — current | `tests/e2e/features/classic/**/*.feature` | 24 | 235 | 25 |
| Visual — current | `tests/e2e/features/visual/**/*.feature` | 1 | 5 | 0 |
| Shared — both skins, browser-verified | `tests/e2e/features/shared/**/*.feature` | 1 | 8 | 19 |

- [Classic](classic/README.md) retains the existing topic subfolders, including `canonical/`, `compose/`, `editor/`, `mobile/`, `panes/`, `sessions/`, `settings/` and `timeline/`.
- [Visual](visual/README.md) contains the separately source-reviewed search, scheduled-task and scratchpad scenarios. Classic behaviour has not been copied into Visual or asserted as skin parity.
- [Completion matrix](canonical/COMPLETION.md) and [audit evidence](canonical/README.md) stay outside the import roots.

The #1323 skin reorganisation preserved 241 scenario definitions. Follow-up #1324 moves `@ux-original-029` from a negative Classic baseline assertion to the desired SVG-image contract, adding seven focused acceptance cases. The current inventory has 248 scenarios/outlines in 26 files and 44 example rows. Other scenario definitions are unchanged.

[Shared SVG images](shared/README.md) are now implemented and browser-verified in both skins. #1325 promotes the same IDs without duplicating features into each skin root.

## Import and test boundaries

These files are Gherkin specifications. Importers must supply their own step bindings and fixtures. The repository's Playwright configuration runs `tests/e2e/steps`, not these Gherkin files automatically. Feature imports do not imply browser execution or complete cross-port parity.

The repaired `runtime/test/features/canonical-ux-contract.test.ts` checks root separation, scenario identity and planned metadata without a whole-file hash or aspirational wording oracle. `run-feature-tests.ts` includes it in the feature gate. These structural checks do not execute Gherkin steps or prove SVG rendering. Parse the files with the existing E2E Cucumber toolchain when changing Gherkin.

`runtime/test/web/svg-images.optional.test.ts` exercises the actual Classic and Visual renderers, sanitizer and copy handlers in isolated Chromium/WebKit documents. CI runs both engines. See [SVG evidence and commands](canonical/audit/svg-images.md). It replaces the temporary source-only baseline test.
