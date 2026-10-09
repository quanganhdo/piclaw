# Uncovered popup typeahead matches

Model and session popup section headings now scroll in normal flow, so labels such as Pinned cannot cover the first typeahead match. The production change is three CSS rules: Classic session/model headings and Visual model headings change from sticky to relative positioning. Group ordering, matching, focus and selection handlers remain unchanged.

## Qualification

Frozen head `7a8ff331736cff8fd0bf8c47e5925c95e285e310`, tree `c4908bf0f0456fa2db5a16b449234cc626f352ff`, runtime tree `72803739b56baaf4eea6a340bdd012e8e3ef1e8c`.

- Complete gate: 6,553 passed / 8 skipped / 0 failed, 42,805 assertions, 931 files, 699.29s.
- Browser: 7 passed / 85 assertions. Real Pinned model groups in Classic/Visual on Chromium/WebKit at 820px and 390px; heading text and row geometry asserted, Enter selection retained. Existing Classic session fixture checks pinned search geometry, keyboard selection, tablet and phone behaviour.
- Focused popup/model/session helpers: 16 passed / 122 assertions across four files.
- Settings contracts: 25 passed / 246 assertions; build tests: 9 passed / 26 assertions.
- Types and scoped lint pass; 95 unchanged transitive frontend diagnostics.
- Explicit 6.1 scoped review CLEAR after correcting the fixture API; reviewer ran no tests.

Full gate ran 6 October 2026 10:35:45–10:47:37 UTC with unchanged clean inputs. Log `/workspace/tmp/popup-heading-full/ci-fast.log`, SHA-256 `4acef0f68d1110dbccf9516813203af93765705f25d98fc64550dfc5558eb137`.

Initial fixture failures from wrong rendering/props/API and focus are retained; they were corrected before qualification. The four-case sticky-heading red is retained at `/workspace/tmp/popup-heading-confirmed-red.log`. An interim passing fixture did not populate Pinned and is superseded: review found the wrong options shape, then top-level pinnedKeys/current payload and an explicit Pinned assertion corrected coverage. No deadlines or production selection assertions were relaxed.

Publication updates are docs/receipts only with runtime parity verified. No installation, restart, live UI interaction or provider/configuration changes. Other pending PRs remain separate.
