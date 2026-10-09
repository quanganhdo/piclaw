# Pi 1.0.3 integration

Piclaw selects released Pi 1.0.3 while retaining the shipped MCP wrapper. This source change follows the merged timeline/meters/audit integration PR1557. It does not install or restart Piclaw, access live credentials, activate production Delegate or include pi-durable.

Exact upstream release: `d78dc83d633229d12f8b79631384c4c2717c399f`, published5October2026 at08:38:23UTC. Qualification uses Bun1.4.2 on Smith LXC and isolated synthetic state. The wrapper remains pinned to `dddfcf630508f42c169889c11dee94e69b746e7c`; Native replacement/parity is future scope.

## Released changes

- Azure's built-in provider ID changes from `azure-openai-responses` to `azure`. Its Responses API identifier remains `azure-openai-responses`; Foundry Chat Completions uses `openai-completions`, with `azure/deepseek-v4-pro` added. `AZURE_OPENAI_*` environment variables keep their names. Piclaw's optional custom `azure-openai` and `azure-foundry` providers are separate and unchanged.
- OAuth refresh which has started now persists rotated credentials under the store lock even if request delivery is cancelled. The fix excluded as postrelease work for1.0.2 is part of this exact1.0.3 release.
- Codemode saves displayed images to private temporary files and names their paths. Truncated output/binary resources/images use private output files. Codemode also handles removal/update of the running package more safely.
- TUI Home/End navigation and EIO handling changed. They are not web-interface replacement or native-terminal acceptance.

## Azure migration and provider selection

Piclaw's provider inventory/fallback UI now names `azure`. `auth.json` and `models.json` must use that provider key; settings defaults, enabled-model patterns and model-thinking keys must use `azure/<model>` selections. The upstream SDK can choose another model after failing to restore the retired provider. Piclaw rejects an explicit retired Azure default/pattern/thinking key or reconstructed session model before SDK model selection instead of accepting that fallback. The public `SessionManager.buildSessionContext()` supplies the effective identity, including assistant-derived legacy selections. A newer valid choice supersedes the old historical entry.

The error supplies migration instructions, with no credential value or automatic rewrite. Existing normal session sanitation can run before the selection check; refusal does not promise zero file writes. No live credential/configuration file is rewritten by this work. A rollout needs a separate approved, protected migration/rollback procedure. If both old and new keys exist, resolve that conflict explicitly; do not overwrite a working credential or restore superseded OAuth refresh tokens. Saved API type names and Piclaw optional custom provider IDs are not renamed.

Tests cover retired defaults/patterns/thinking keys, model-change and assistant-derived identity, valid supersession and optional custom providers. A synthetic public Azure request confirms deployment-name mapping through `AZURE_OPENAI_DEPLOYMENT_NAME_MAP` without sending; catalogue identity is retained. Azure endpoint, account and provider authority are never inferred from a model label.

## Fresh source and artifact evidence

- Eight exact registry archives matchSHA1/SHA512/gitHead. A standalone consumer with only coding-agent1.0.3 passes installed/archive payload equality, public root/export resolution, private/source-only import denial and inactive durable/Harness boundaries. Admission adds1.0.3 constants without changing older exact metadata.
- Fresh public inventory:42providers/nine OAuth owners. API/provider/auth distinctions remain separate. Azure is the new built-in ID; custom cloud/local routes retain their own scope.
- Fresh device authentication22cases and Codex6cases pass with intercepted synthetic endpoints. Browser20 and Anthropic copy-code17cases run in distinct loopback-only network namespaces.
- Exact published CLI OpenAI/Codex10cases pass in isolated namespaces/disposable profiles. Bundle75JavaScript files; actual archive/payload/OAuth fingerprints measured. No source substitution or inference.
- Anthropic privateUI10Chromium/WebKit cases/1,342assertions pass. Stored cards/rows/recordings/exports and denied/stale/cancelled flows are checked; family gateway and real accounts are not exercised.
- Current broad auth/MCP/core suite:364passed/eight existing opt-in skips/zero failures,4,303assertions across58files. Required currentCLI/browser/privateUI flows were executed separately; an unexecuted opt-in crash case supplies no new pass.
- Both-skin MCP Settings Chromium/WebKit terminal summary reported14passes/590assertions on1.0.3; the interrupted tool wait did not capture the launcher exit. Public MCP compile probe still reports the exact ten missing Native contracts. Unsupported Native remains fail-closed.
- Eight actual public SDK synthetic MCP child runs, including twoCPU profiles, complete14scripted responses/reload/disposal with zero guarded network attempts. This candidate-only measurement includes module loading, has no DB/live-provider comparison and does not establish production latency.
- A gated actual publicModelRuntime/FileCredentialStore test verifies cancelled delivery before the raw refresh completes, a separately timed non-aborted raw signal, persistence of the rotated token and reopening without a second refresh. Cleanup drains the store lock. This supplies scoped regression evidence for the released fix; it exposes no public raw-task acknowledgement to Delegate.
- A real public codemode tool pipeline emits two identical synthetic images, reports one private PNG path, preserves both image blocks and exact bytes, and writes the full truncated text. Files are0600and owned by the test user. The dedicated temporary directory is restored/removed even if setup fails. No image model/provider runs; the proof is a deduplicated file result, not an instrumented count of native write calls.
- Seventeen replaced1.0.2 executable registrations have1.0.3 counterparts; Git retains old source. Twelve immutable1.0.2 JSON receipts/artifacts are hash-guarded and unchanged. Existing1.0.1 preservation guard remains unchanged.

Five type stages and scoped lint pass; compose retains95unchanged transitive diagnostics. The corrected frozen full gate passed on `ff8667b67c95882f333cd303c71b030599334cdf`, tree `6145b826e474155383e9468be41b5b3b09bd5491`, from13:12:53to13:23:46UTC on5October2026:6,516passed, eight existing skips, zero failures,42,702assertions across929files,643.04seconds; features25/246 and web/build9/26. Exit0; final source unchanged and clean. Full log SHA256 `bd1a7ec8c148e15900f116e520531efc3011ccfa176cfbc61ae39f714950b002`. Publication adds qualification prose/JSON only; runtime/dependency/test/script parity with that frozen head is verified before push. Merge/postmerge receipts remain separate from installation.

## Retained failures and corrections

The first broad run failed because two renamed network preloads were missing, the safe admission receipt hid the archive basename and the privateUI receipt lacked expected scope/hash fields. Those failures are retained. A later broad run found stale codemode version reporting and retired Azure catalogue identity; actual package metadata and new provider identity corrected the fixtures without weaker assertions or increased timeouts.

The first frozen full invocation at `071a6b801` stopped at the static silent-catch guard before tests ran: a cleanup-only promise catch discarded its outcome. The fixture now captures resolved/rejected cleanup explicitly. The failed log remains retained; no test or application bound changed.

The initial Azure metadata fixture expected the older display name. The payload fixture initially used an unavailable root export and an unsupported single-deployment environment key; the public providers export and documented map are used in the passing run. Codemode setup initially disabled its own extension, then attempted a nonexistent public tool-execution method and omitted the synthetic model baseURL. The final fixture uses a real public session prompt/tool pipeline. Review strengthened duplicate-image/full-text/ownership assertions, refresh draining and setup-failure cleanup. Broader delegates that timed out or were interrupted supply no approval; completed narrow corrected reviews are separately recorded.

The [integration receipt](receipts/pi-103-integration.json) binds the target, measured outcomes, hashes and scope limits.

## Remaining gates

Public1.0.3 terminal/result and caller-auth cancellation still do not supply raw provider/auth task settlement or account-generation leases. Public Models/EventStream declarations do not add those contracts. The parent host/shared request installer stay inactive; add-ons160 and production immutable-artifact/policy/credential/owner/orphan gates remain open. No private SDK workaround, provider substitution, credential copying or synthetic settlement promise is promoted to production acceptance.

The measured performance audit preserves rejected FTS candidates, outliers and deeper HTTP/GC/family/claim-loop gaps. Its1.0.2 measurements remain historical; new1.0.3 SDK measurements have their own scope. Deployment/restart, real-account/server calls, canary/soak and operational rollback require separate approval.
