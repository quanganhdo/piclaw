# Isolated durable-session map retirement

`AgentRuntimeFacade` now uses its existing backend lookup without a separate `durableSessions` snapshot map. The retired internal input is rejected before lookup getters or map iterators run. Native controls, history readers and explicit legacy resource capture retain their current owners.

## Consumer and ownership decision

The review pin is `6eec077c222c1451da0939d2b0edffc119cb18bd`. This F2 slice initially builds on F1 candidate `c49cd22e215113be3199f1ab430a7cfaa3550cac`; final parent integration and qualification are recorded on #1837. SDK pins and dependencies are unchanged.

Actual application composition supplies `getDurableSession`. The old map input had only isolated host/native qualification consumers and a historical README claim. The audit included tracked/ignored source, dynamic/package/CLI selectors and approved/current/installed add-ons. Local backend-owned Maps feeding the supported lookup are different from the removed constructor input and remain valid.

Before, the isolated path copied a Map, validated every entry and rebound every optional method, then used a compatibility lookup followed by the live runtime-port validator. After, the existing dynamic lookup feeds that same validator. One legacy binding-map owner and its rebinding factory disappear. No generic facade, replacement Map, additional lifecycle owner or SDK boundary is introduced.

## Preserved contracts

- The lookup callback captures its original receiver and identity. Backend-owned routing can still change after construction.
- Per-lookup object, session/branch ID, callable-method and AbortSignal-shape validation is byte-identical with the base (SHA-256 `0d88cd352f469aa55038a1010761384462d69ccf76af0ee0439d5725533758ba`).
- The constructor still copies options. Removing that copy makes the new counterfactual enter a forbidden legacy fallback; the corrected implementation passes after restoration.
- Missing native bindings/capabilities and failed reads cannot hydrate a legacy session. Retired input is rejected even when explicitly undefined or accompanied by a live callback. Its iterator and lookup getter are not evaluated.
- Current native context/model/thinking/auth, command protection, scoped cancellation, public history/tree/report, owner/lifetime, compaction and same-database recovery paths remain unchanged.

The removed map specifically promised an immutable copy of caller-owned entries and methods. That input contract is deliberately retired with approval. Four fixtures now use immutable **backend-produced ports**, matching current application composition; they no longer attribute that freezing to the facade. Replacing a method on those ports is explicitly refused. All surviving functional assertions remain unchanged, with four additional immutability assertions. The shared-database fixture’s `bindings.clear()` setup exercised only the old map-copy promise; it now supplies the actual immutable adapter position directly. Every same-file/history/reopen/no-replay assertion stays.

## Accounting

| Stable backend metric | F2 base | Candidate | Raw reduction |
| --- | ---: | ---: | ---: |
| Physical lines | 142,266 | 142,197 | 69 |
| Nonblank lines | 131,958 | 131,889 | 69 |
| Files | 707 | 707 | 0 |

The 69-line net includes the explicit three-line retirement guard, unchanged empty lookup for legacy mode and preserved options snapshot. Fully charge two option/type/comment lines and the entire five-line old signal type expression, including its mixed-code endpoints, as conservative non-credit removal. **Credited net reduction is 62 physical / 62 nonblank lines.** No production code is moved elsewhere; generated data, types-only support, tests, documentation and fixtures earn zero credit.

Together with F1’s 228/218, batch A currently yields **290 physical / 280 nonblank credited lines**, above the agreed 280/260 minimum. Raw batch reduction is 437/405 with total conservative charges 147/125. This is candidate accounting, not final merged acceptance or a second credit for F1. See the [machine receipt](receipts/durable-session-map-retirement-1837.json).

## Tests and failure evidence

Before implementation, the new retirement suite has 24 pass / 5 expected failures. After, all 29 cases / 37 assertions pass. It checks refusal before getter/iterator side effects, all 23 live callable methods, captured callback/mode, live receiver-owned routes and no fallback. A compile-only contract in the normal qualification type project has a positive callback and three negative inputs. Before retirement its map-input directive fails as unused; afterward all expected errors are enforced.

The focused host facade/construction/retirement matrix passes **96 cases / 606 assertions**. Actual SDK compaction, idle model/reset, imported history and single-database recovery pass **17 cases / 415 assertions** across four files. The first run exposed the fixture’s deliberately removed map-copy `clear()` setup; only that setup changed to the supported lookup, and the original functional assertions remained. The failed run is retained.

An AST/source comparison preserves all 526 original surviving assertion expressions across the facade and four native fixture files; the facade adds four more. Eight constructor tests belonged solely to the retired map protocol. Dynamic lookup validation already existed and remains, with new exhaustive callable-method checks. No safety assertion or timeout was weakened, and no new test shim implements the removed map snapshot/rebinder.

Normal runtime/private/qualification type projects and strict new-test typing pass. Final full repository/native gates, package/import checks, author review, exact-head automatic CI and fresh merged-head verification are integration requirements; their receipts belong to the PR and issue.

## History and scope

The qualification README labels its original map receipt historical; original counts, provenance and source remain in immutable Git. Revert restores an internal constructor input and needs no data rollback.

This approved #1809 F2 slice has #1811 as its sole credit owner and #1815 cross-linked. It does not change SDK versions, storage schemas, accepted bytes, history, budgets, credentials, settings, backup/retention/schedules or restore policy. No install or restart is included. The parent stays open until batch acceptance and all review findings are reconciled.
