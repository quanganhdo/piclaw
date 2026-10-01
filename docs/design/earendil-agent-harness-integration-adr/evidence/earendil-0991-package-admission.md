# Earendil 0.99.1 package and public-contract admission (#1443)

Exact Earendil **0.99.1** is admitted as a migration candidate at gitHead `d86654abb8862e201933517d6f1fce9f88dd117f`. This receipt does not select it for Piclaw, change the current `0.87.1` pins, enable native MCP/Harness/Pico3, call a provider or authorise installation.

## Exact package closure

A disposable consumer declared only `@earendil-works/pi-coding-agent: 0.99.1` and installed with scripts disabled. Its Bun lock resolved eight coordinated packages at `0.99.1`:

- `@earendil-works/chord`
- `@earendil-works/pi-agent-core`
- `@earendil-works/pi-ai`
- `@earendil-works/pi-codemode`
- `@earendil-works/pi-coding-agent`
- `@earendil-works/pi-mcp`
- `@earendil-works/pi-telemetry`
- `@earendil-works/pi-tui`

The versioned registry receipt at `runtime/test/fixtures/earendil-package-admission/registry-0.99.1.json` (SHA-256 `c01d3f55f2b4d776e3d3a86682b2d1f37820cdd2c9374d157c153d8402cc996a`) pins every package's npm SHA-1, SHA-512 integrity, tarball URL, gitHead and Node engine. The real admission downloads all eight official tarballs, verifies those hashes, extracts them, and requires each canonical extracted-tree SHA-256 to match the installed consumer tree. All eight registry and installed manifests declare Node `>=22.19.0`. The disposable lock resolved `pi-mcp` and `pi-codemode` through coding-agent's `^0.99.1` dependencies to exact `0.99.1`; its SHA-256 was `6e96fdd88cdc28637a8e8b7bb23c8ee15c0a6941986137dbbad0d5498eb42d2b`. The consumer manifest SHA-256 was `8368659addd9affab1e3f6932ef4f14caa681da710ad07076ca1afea78b461c3`.

The checker preserves the six-package `0.87.1` contract for historical tests. For `0.99.0` and later it requires the eight-package closure and a versioned registry receipt. Missing, duplicate, extra, stale-version, wrong-gitHead, wrong-hash, wrong-tarball and wrong-engine cases fail.

## Packed public imports

The actual installed npm artifacts were probed under Homebrew Node `26.7.0` and Bun `1.4.2`. Both runtimes imported these root/public functions without provider or MCP-server calls:

- coding-agent: `createAgentSession`, `createAgentSessionRuntime`, `ModelRuntime`, `createMcpExtension`, `createToolSearchExtension`, `createCodemodeExtension`;
- pi-mcp root: `McpClient`, `StdioTransport`, `StreamableHttpTransport`;
- pi-mcp OAuth: the complete exported OAuth flow/error/store surface frozen by the checker;
- pi-ai `./bun-oauth`: `registerBunOAuthFlows()`, including resolution of the packaged `dist/auth/oauth/openai-chatgpt.js` fixed in 0.99.1.

Coding-agent `./client` and `./experimental/plugin` remain source-conditioned and runtime-rejected. Direct imports of `@earendil-works/pi-mcp/dist/client.js` and `@earendil-works/pi-ai/dist/auth/oauth/openai-chatgpt.js` are rejected by package export resolution. Integration must use the root/public subpaths.

The final actual-package command returned `admitted: true`, eight verified tarballs, 42 provider definitions in each runtime and no private import. Its JSON SHA-256 was `8eab185f41bdb638c120d00f17e9efec1d095e739115092b93b2fdcbf35039fa`. Probes used empty disposable HOME/XDG/auth paths, `PI_OFFLINE=1`, telemetry disabled and `allowModelNetwork:false`. Node ran with its native permission model denying network and child processes while allowing only the consumer/scratch filesystem roots. Bun used a preload that replaces named and default fetch/HTTP/socket/child-process APIs before package imports, including synchronous child methods. Both enforcement modes were tested with deliberate denied `fetch` and named `execSync` calls. Node's native boundary records denied capability but cannot count caught attempts, so Node attempt counts are `null`; it makes no zero-attempt claim. Bun's preload records intercepted attempts and the admitted package run observed zero. The Bun preload is process-level instrumentation, not an OS network namespace.

## Provider/auth handoff to #1458

`ModelRuntime.getProviders()` was read from the exact package after bundled OAuth registration, with network refresh disabled. Node and Bun produced the same 42 sorted providers. The versioned matrix at `runtime/test/fixtures/earendil-package-admission/provider-auth-0.99.1.json` (frozen SHA-256 `09a7c902f5b7c8bd69f92b5416d496bfe1ba7d09447c6dd3fa6f236851faaea7`) records every provider ID/name and whether the provider definition exposes API-key and OAuth methods. The checker rejects any changed receipt before comparing both runtimes against it.

The OAuth providers are `anthropic`, `github-copilot`, `kimi-coding`, `meta`, `openai`, `openai-codex`, `openrouter`, `radius` and `xai`. `openai-codex` is OAuth-only in this runtime; the other 41 definitions expose API-key auth. These are packaged definitions, not successful-login claims. External/ambient/no-auth semantics, prompts, callbacks, persistence, refresh, logout and live account flows remain #1458 acceptance work.

## Cumulative 0.87.1 → 0.99.1 delta

The published coding-agent changelog has no intervening releases between `0.87.1`, `0.99.0` and `0.99.1`.

- SDK/tools: 0.99.0 adds public tool exposure/namespace/annotations/output schemas, structured results, `prepareLoadout()`, nested `ctx.executeTool()`, parent-call IDs, built-in extension factories, tool search and codemode. Existing Piclaw activation, loadout, transcript and output contracts therefore require migration tests; admission does not enable them.
- MCP: 0.99.0 adds native MCP, `pi-mcp`, stdio/streamable-HTTP transports, resources and OAuth. The public package surfaces import successfully. Full Piclaw parity is separately evaluated by #1444 and is not implied by package admission.
- Providers/models/auth: 0.99.0 adds ChatGPT sign-in, virtual models, classifier/image APIs and broader runtime auth. 0.99.1 adds GPT-6.1 Sol to OpenAI, Azure OpenAI Responses and OpenAI Codex, makes it the Codex default, and repairs the bundled OpenAI login module. Availability does not approve any provider/model, tier or billing route.
- Transcript/session/compaction: 0.99.x inherits 0.87.1 canonical session context and adds nested-tool usage plus per-operation model surfaces. Piclaw's existing context-edit, orphan repair, fork/resume/compaction and fail-closed service-effect tests remain required during #1445/#1446 qualification.
- CLI/resources: built-in extensions are explicit resources, `--no-extensions` disables them, and SDK sessions load selected factories explicitly. Piclaw must not accidentally enable built-in MCP/codemode/tool-search during the core upgrade.
- Runtime/build: package declarations require Node `>=22.19.0`; packed probes passed under Node `26.7.0` and Bun `1.4.2`. Upstream targets ES2024/TypeScript 7.0. Piclaw's own full type/build/runtime compatibility is deferred to integration children.

No advertised 0.87.1 acceptance is reclassified. The current compatibility manifest remains `currentRuntimeVersion: "0.87.1"`, `harnessActivation: "latent_only"`, `unsupportedCountsAsPass:false`. Updating that manifest before package selection would falsely describe the running/current loop.

## Reproduce

Install the exact package in an isolated consumer, with no live profile or scripts, then run:

```sh
bun scripts/check-earendil-package-admission.ts \
  --consumer-root /path/to/consumer \
  --version 0.99.1 \
  --git-head d86654abb8862e201933517d6f1fce9f88dd117f \
  --registry-receipt runtime/test/fixtures/earendil-package-admission/registry-0.99.1.json \
  --provider-receipt runtime/test/fixtures/earendil-package-admission/provider-auth-0.99.1.json \
  --tarball-dir /path/to/verified-tarballs \
  --node /path/to/node \
  --bun /path/to/bun

bun run test:controlled -- runtime/test/scripts/earendil-package-admission.test.ts
```

The focused suite covers legacy admission, exact metadata, public imports, OAuth packaging, frozen provider definitions, mandatory tarballs and negative drift/private-import cases. Its synthetic declaration fixture is not accepted as a published package tree; only the actual command with official tarballs establishes release admission. Production package pins, installation, sessions and live credentials are untouched.

## Rollback and dependency status

This is evidence-only admission. Rollback is deletion/reversion of the new checker fixtures and document; no persisted runtime format or live state changes. #1445 may change package pins only after this issue merges. #1458 consumes the provider matrix and must still qualify real interactions using synthetic/offline flows first. #1444 remains authoritative for native MCP replacement feasibility and may block adapter removal even though the packages themselves are admitted.
