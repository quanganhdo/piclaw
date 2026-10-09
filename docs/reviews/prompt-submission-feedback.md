# Prompt submission feedback qualification

Prompt submission now has immediate truthful local feedback in Classic and Visual, followed by an accepted-waiting state until matching lifecycle or terminal feedback arrives. No model-running status is invented before acceptance. The backend already emits initial Thinking before metadata/hydration; this slice fixes the reproduced UI visibility gap rather than attributing every long wait to hydration.

## Qualification

Frozen combined source `f1ba263550ff3a62cf0b016123f11f2548fcfe27`, tree `7154140394b3d5584987e1ec58af9baa4407cb58`, runtime tree `97d321cedd267d812d469850258e51638a93285e`. Main8796113cf was integrated by merge; the asset-cache tag conflict was resolved by a full rebuild, not by discarding either source change.

| Gate | Result |
| --- | --- |
| Complete runtime suite | 6,670 passed / 71 skipped / 0 failed; 43,311 assertions; 957 files; 663.73s |
| Focused feedback/status/startup | 38 passed / 114 assertions; 6 files |
| Rebuilt shipped-entrypoint browsers | 4 passed / 68 assertions; Classic/Visual Chromium/WebKit |
| Settings/pane contracts | 25 passed / 253 assertions |
| Web build | 9 passed / 26 assertions |
| Types and scoped lint | Passed; 94 unchanged transitive frontend diagnostics |
| Explicit6.1 follow-up source review | Scoped CLEAR; no reviewer tests |

Full gate ran 7 October2026 20:07:23–20:18:36UTC, clean unchanged head/tree. Wrapper log SHA-256 `2dd37c52a0e1e9e2ec88031f851b404932efff0259c66b26fe5566d2ff7ccd47`. Private exact-source canonicalci-fast receipt `d1e60d88-1b1f-4b9c-a576-ea919eb77497` passed, aggregate6704/71skip/0fail across three subprocess summaries, raw log hash `20429d8f3181f7437ba1a217218bf5e0456b696e64b8c367ca29eaa893cff78f`. Other receipt capabilities are not-run; optional browser qualification is separate.

## Corrections and retained evidence

Initial non-DOM unit tests found unguarded window dispatch; corrected with the safe presentation publisher. Type baselines shifted by imports; exact existing diagnostics retained with new line positions, no diagnostic waived. Browser fixtures initially assumed the same hard-coded chat and thread identity; corrected to actual submission chat and backend timestamp identity. A terminal-state fixture refresh previously returned an empty timeline despite durable rows; corrected its mock persistence. Debug logging used for diagnosis was removed.

Review found waiting feedback could survive missed-SSE terminal status. Both Classic status polling and reconnect now publish actual matching terminal identity before returning. Regression tests cover before/after ACK and unmatched/idle-only uncertainty. Visual polling uses the shared publication path. Follow-up review cleared the corrected lifecycle/correlation behaviour. Earlier failed unit/type/browser logs are retained under `/workspace/exports/prompt-feedback-*`; no deadlines or admission/selection assertions were relaxed.

Both skins retain per-generation/chat fencing, bounded pre-ACK status identities, queue/command/UI/relay semantics, failure draft recovery and reduced-motion/polite status presentation. Publication updates after qualification are docs/receipts only with runtime parity verified. No live prompt, provider/account, production configuration, installation or restart change.
