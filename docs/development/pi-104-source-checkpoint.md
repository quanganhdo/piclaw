# Pi 1.0.4 source checkpoint

Piclaw's isolated source branch uses the exact released Pi 1.0.4 package family. The shipped MCP wrapper stays selected, and Delegate stays a plain subprocess. Nothing is installed or activated by this checkpoint.

## Release and packages

Upstream commit: `7c10bd4337495ee613f2224843ecdf349b80d1df`. Four direct dependencies and eight family overrides are pinned to1.0.4. All eight downloaded archives match registry SHA-1/SHA-512 and release metadata. A standalone coding-agent-only consumer passes package admission, installed-payload and public/private export checks with network and process calls denied.

Wrapper pin `dddfcf630508f42c169889c11dee94e69b746e7c` is unchanged. No native MCP activation, pi-durable dependency or experimental Delegate proxy/resource API is added. Runtime production sources are unchanged; this upgrade changes dependencies, admission checks, tests and evidence.

## Tests

| Check | Result |
|---|---|
| Full `make ci-fast`, second run | Exit0;6568pass,70skip,0fail;42755assertions;648.58seconds |
| Feature / web phases | 25 / 9 passing tests |
| Types | Five projects pass;95 unchanged compose-reference transitive diagnostics retained |
| Fresh auth cases | 20tests/189assertions;22Copilot/Kimi device cases and6Codex cases |
| Browser auth / copy-code | 20 / 17 synthetic scenarios |
| Packaged CLI auth | 10 synthetic outcomes in isolated loopback-only namespaces |
| Final affected CLI/tool/receipt tests | 9pass/303assertions |
| Private Anthropic UI | 10pass/1342assertions; Chromium/WebKit, isolated synthetic flow |
| Shipping Delegate / actual1.0.4 CLI | 1pass/5assertions; thinkingmedium, JSON/no-session, no provider spend |
| Changed-file lint and diff check | Pass |

The full gate predates two CLI-loading tests and removal of two unused test helpers. Those affected files were tested separately after the change. Seventy skips include old exact-version probes and existing opt-in tests; they are not current-release passes. All nine stored1.0.3 receipt JSON files remain byte-identical.

## Pi 1.0.4 changes checked

Actual SDK sessions verify that a built-in-only tool list retains MCP-named tools, an MCP wildcard filters by server, exclusions remove them, and an empty list exposes none. Actual packaged CLI tests verify `--no-mcp` and the shipping `--no-extensions` path do not start a configured native MCP server. An explicitly loaded synthetic reasoning provider receives thinking `medium`; no provider request is made.

Public OAuth tests verify native registration for loopback/custom-scheme redirects and web registration for HTTPS redirects. Credential lifecycle, cancelled refresh persistence, wrapper reload, synthetic MCP/codemode tool calls, sampling and private image/full-output files pass fresh1.0.4 checks.

The exact public MCP compile probe retains ten unsupported seams and native parity as unqualified. `ToolLoadout.getPromptGuidelines()` has a checked public signature. Compile checks do not prove runtime native parity or replace wrapper containment.

## Failed attempts and limits

The first full run failed nine tests: old installed-version assertions, current receipt/target references, and `fd` missing from the cleared test PATH. Corrections preserve historical receipts, run fresh counterpart fixtures and supply the existing local `fd` executable. Original logs remain retained.

Intermediate failures included an incorrect OAuth fixture call signature, CLI thinking clamped to off without a reasoning-capable synthetic model, copied collector metadata and excessive receipt-path redaction. Corrected runs pass. Measured outcome rows were not rewritten to conceal failures.

A bounded read-only review found no blocker in the inspected admission/contract files but lacked Git-diff tooling. Owner checks verify there are no production runtime-source edits and stored historical receipt bytes match the branch base.

Private Anthropic browser UI on1.0.4 passes fresh Chromium/WebKit checks. The shipping Delegate runner passes an actual packaged1.0.4 CLI smoke with synthetic responses and thinkingmedium; this is separate from its prior1.0.3 all-thinking-level qualification. Neither test is live-account or paid-inference acceptance. Rollout/canary and operational rollback need separate approval.

No merge, publication, installation, restart, activation or issue closure occurs in this checkpoint. Experimental owned-task upstream failures are outside this released-package integration.
