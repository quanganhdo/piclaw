# Historical Harness manifest retirement

The unregistered historical Harness compatibility module is removed from executable Core. Its complete schema-6 evidence remains as inert JSON. The bespoke normaliser/data builders are deleted, with **no replacement validator, compatibility facade or SDK activation**.

## Usage decision and preserved evidence

Implementation base: `f2b1c90bb3c13200def2118499481d6970590de4`.

Tracked/ignored/type/static/dynamic/startup/registry/package and approved ad7 add-on audits find no production consumer of the module, exported manifest/types or normaliser. The normaliser only validated its own constant at import time. Root index545, AgentPool324 and native factory634reachable-file graphs contain none of this module. Loaders use declared extension/runtime entries; they do not discover arbitrary service-effect files. The root package broadly shipped `runtime/src`, so the dormant module was distributed executable source despite having no installed API.

Actual consumers were historical release-churn and 1.0.3/1.4.0 contract tests plus the retired-boundary oracle. They now read the [complete materialised receipt](../design/earendil-agent-harness-integration-adr/evidence/receipts/earendil-harness-compatibility-schema6.json). [Provenance](../design/earendil-agent-harness-integration-adr/evidence/receipts/earendil-harness-compatibility-schema6.provenance.json) records original revision/path/hash, exact-object equality, archive hash and conservative source accounting.

The archive expands both `packageRows()` and `CURRENT_RUNTIME.capabilities.map`, including HC-024/025 overrides, without changing arrays, field order, strings, versions, package coordinates, fingerprints, EB/HC/PC/PG rows, unsupported outcomes or activation restrictions. Its “installed/current” labels are frozen as-of observations, including0.99.1; current repository SDK1.4.0 selection remains separately checked.

- Original source SHA-256: `b7874e86bbd03d005bff57655a6308c8efd2c3025699ae815dc061c50948e91f` (85,898bytes).
- Whole JSON SHA-256: `1f6f640cc8ef89163b5d439304792abc735db2fc9251bcbc26bb590f660c932f` (93,814bytes/2,253lines).
- Canonical full-object SHA-256: `eb4d28490de9ea4f9bff77c3a9b06051fae8e835133e0ad3f1d9d734275bea7e`.

Before source deletion, the materialised object was deeply equal to the original frozen export. Reproduction directly from immutable Git source, without restoring a production file, produces byte-identical archive/provenance. Existing independently pinned selected/historical aggregate hashes remain unchanged; no expected hash was regenerated to pass a changed fixture. The whole-file/object checks also protect previously unreferenced Pico3/current-runtime fields.

Existing historical negative/compiler/public-export receipts stay unchanged. Evidence index/version/candidate pages now point to the archive and label as-of results; old commands/operational permissions are not extended. Upstream SDK code, active private native engine and real MCP/auth/budget/Delegate/backup/service-worker owners are untouched.

## Deleted implementation and accounting

The module loses ten unused function declarations: package-row builder, exported exact normaliser, descriptor/array/record snapshotters, difference reader, own-value reader, recursive freezer and result/issue builders. The import-time self-normalisation lifecycle and production canonical-evidence export disappear. Normaliser API1→0, bespoke closed-evidence validation subsystem1→0, import-time validation lifecycle1→0; installed activation paths0→0. No active native call-path speedup is claimed.

Stable #1270 raw source: **144,442→142,602 physical**, **134,052→132,263 nonblank**, **711→710files**: gross **−1,840physical/−1,789nonblank**, no production additions.

**Do not credit all1,840lines.** Conservative Babel top-level function spans (excluding attached comments) contain **181physical/179nonblank** removed implementation lines. Every other original data/type/constant/top-level lifecycle/comment/blank line—**1,659physical/1,610nonblank**—is fully charged as non-credit relocation/removal. Genuine credited reduction is therefore **−181physical/−179nonblank**. All spans are in the provenance/machine receipt. JSON representation expansion is inert historical data, not production implementation or deletion credit. No code is moved into an excluded production/helper path.

## Regression and boundaries

Before deletion, the modified cases give6pass/3expectedfail; all original historical/current-package assertions already pass against the archive. After deletion:16pass/one existing historical1.0.3skip,299assertions across four explicit files. Current1.4package/lock/installed family, model catalogue/OAuth, MCP wrapper ownership/public compile and ten measured diagnostic gaps remain. Realpath/symlink containment negatives, package ordering/uniqueness/SRI/fingerprints/classifications and historical aggregate pins are retained unchanged.

The Root retired-boundary scan still rejects old contracts/SDK paths and now requires zero compatibility files. Added private-engine checks reject only retired compatibility/Harness/Pico3 imports; active public pi-durable/native contracts remain allowed. No scan rule is weakened.

All three source type projects pass. Strict archive/churn and historical1.0.3test typing passes with normal JSON-module support. A broader ad-hoc four-test project reports13existing Babel-oracle/readonly-matcher diagnostics versus17at unchanged baseline; normalised diagnostics prove zero introduced errors. It is **not green**, no suppression/configuration weakening is added. Four old DTO-literal matcher diagnostics disappear with the retired source types; that earns no reduction credit.

Shipping native Delegate standard-policy/model/thinking, files, timeout/cancellation, denial and accounting cases pass5executions/203assertions; actual SDK watch progress1/11passes. Shared accounting/auth/MCP/backup and separate supported add-on execution stay. Runtime graph545/0cycles, env observations, silent-swallow guard0/0 and scoped package checks pass. The retired executable and inert archive are absent from runtime packaging; active native/budget/service owners remain. General import checks still report25byte-identical pre-existing findings, not green.

## Rollback and scope

Reverting restores only dormant source; historical artifact data remains exact and no stored state needs migration. No SDK/version/pin update, old-branch/worktree deletion, live schema/configuration/credential/history/retention action, install/restart or restore promotion is included. Required automatic CI, author review, authorised merge and final exact-head acceptance remain integration steps. This bounded #1575 slice is not whole-epic completion.
