# Pi 1.0.0 public MCP contracts and codemode runtime

The assessed Pi 1.0.0 declarations still reject all ten requested public MCP seam probes. The synthetic fixture demonstrates deferred discovery and codemode calls through the public SDK's real session tool pipeline, including policy refusal, schema validation and same-session reload. This #1495 qualification slice changes no production code or engine selection.

## Compile contracts

`scripts/check-earendil-mcp-public-100.ts` compiles positive and negative consumers with TypeScript invoked by Bun. It requires installed coding-agent, pi-mcp and pi-codemode versions `1.0.0`. The positive consumer checks public factories, transport injection, config/update callbacks, exposure, low-level client methods and OAuth primitives. It is compiled but never executed.

The negative consumer must produce exactly ten distinct diagnostics. Missing, duplicate, changed or extra diagnostics fail. The receipt's `referenceGitHead` is the selected upstream revision `a13d35a742c6ef8462812a28fbe1d8c8b7431c32`, not a new provenance measurement. Exact package archive/tree admission remains the separate #1492 gate.

| Requested seam | Diagnostic | Requirement |
|---|---|---|
| `lazy` | TS2353 | MCP-08 |
| `statusObserver` | TS2353 | MCP-12 |
| `resourceFilter` | TS2353 | MCP-06 |
| `authStart` | TS2353 | MCP-10 |
| `appRenderer` | TS2353 | MCP-11 |
| `absoluteDeadlineMs` | TS2353 | MCP-07 |
| Structural replacement for concrete `McpOAuthCredentialStore` | TS2740 | MCP-03 |
| `socket` transport configuration | TS2322 | MCP-08 |
| `McpClient.listPrompts` | TS2339 | MCP-11 |
| `McpClient.getPrompt` | TS2339 | MCP-11 |

A rejected type member establishes that the named seam is unavailable in these declarations. It does not prove that every possible public composition is impossible. No missing requirement is waived by this matrix. In particular, a codemode script deadline is not the host-owned absolute deadline required for every exposed MCP operation.

## Real SDK fixture

`mcp-public-runtime-100.ts` creates an in-memory `ModelRuntime`, `AgentSessionRuntime`, `SessionManager` and resource loader through public exports. An explicit synthetic provider emits deterministic assistant tool calls and stop messages; no external inference is performed. The MCP extension receives a public `McpTransport` implementation through `createTransport`. Its valid stdio configuration is never passed to a process launcher.

Two independent runs select server exposure `deferred` or `codemode`. They verify:

- automatic activation of the corresponding discovery tool;
- a deferred MCP tool is callable but absent from the model's active tools until `tool_search` finds it;
- exact search results and namespace instructions through codemode;
- the real MCP client adds a progress token and returns content/structured content, excluding response `_meta` from the script result;
- top-level and nested policy hooks run, and nested calls carry the expected parent ID;
- an explicit policy refusal, missing required argument and hidden-tool invocation fail before transport dispatch, with the expected diagnostic;
- numeric input for a string property is converted to a string by the SDK's documented validation behaviour;
- whole-extension reload preserves session identity, transcript and loaded tools, closes the first transport before starting the second, and a later call reaches only the new transport;
- final disposal closes both synthetic transports.

Each run uses 14 scripted responses. Fetch/preconnect guards are installed before SDK imports and record zero attempts. Profiles and writable state use owned temporary directories; the parent owns cleanup even if its child deadline expires. No private SDK imports, runtime module mocks, tool-array mutation or fabricated extension context are used. The old 0.99.1 compile matrix and private-mock historical lifecycle probe remain unchanged and are not reused as new lifecycle evidence.

## Scope limits

This is public SDK qualification, not Piclaw pool/backend/settings integration. It does not exercise native HTTP/OAuth, real stdio processes, sockets, resources, prompts, MCP Apps, active-turn abort, concurrent shutdown/startup, durable session reopen/fork, or cross-process behaviour. The fetch guard is not an exhaustive socket audit. Synthetic closure proves the extension calls the injected transport's close method; it does not establish cleanup of a real server process.

Native parity remains `not_qualified`, production activation remains false, and the existing adapter default and incompatibility planner remain unchanged. Keychain-backed authentication and unsupported native configurations keep their separate gates. No provider credentials, live MCP server, external inference, deployment or restart is used.

## Validation and retained failures

The current focused set passes four tests / 17 assertions, plus internal Node-compatible assertions executed under Bun in each child. Strict fixture typing is checked separately.

Initial direct wrapper invocation failed with `No assistant message issued this call`; the fixture now emits real assistant tool calls through a scripted provider. A too-strict request comparison omitted the legitimate progress token. A numeric-input refusal expectation was wrong because the SDK coerces primitives; the fixture now records that behaviour separately and tests absent required input as the refusal case. The compiler returned exit 1 for the ten diagnostics; both TypeScript diagnostic exits 1 and 2 are accepted only when the exact diagnostic set matches.

Independent review required exact codemode search output, rejection-specific diagnostics and an actual post-reload invocation. Those assertions were added. Failed runs remain under `/workspace/tmp/1495-mcp-public-100/`; no failing expectation was relabelled as native acceptance.

Receipt: `receipts/earendil-100-mcp-public.json`. Corrected-delta review found no blocker. The frozen full `make ci-fast` gate passed 5,920 current-runtime tests, eight existing skips and zero failures (38,114 assertions, 855 files, 912.77 seconds), plus 25 feature tests, both frontend builds and nine web checks. Separate frozen 0.99.1 replay passed 468 tests / 8,720 assertions. Final pack hygiene checked 24,746 files; strict fixture typing, all five repository typechecks and scoped lint passed, retaining 95 existing compose diagnostics. Final MCP/public reload/planner set passed 28 tests / 113 assertions.

Frozen tree: `c2959b3f53e09e609349d15fe3ca6f8f96478523`. Full log: `/workspace/tmp/1495-mcp-public-100/ci-fast.log`, exit zero, SHA-256 `08d1dcfc61f63311f0152592a607fe916c7ae6ec9bee21609eb422fba7af231a`. Only this evidence text changed after the full gate.
