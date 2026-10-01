# Earendil 0.99.1 native MCP public-API decision (#1444)

Exact Earendil **0.99.1** cannot replace `pi-mcp-adapter` while preserving Piclaw's required MCP contract through public APIs. Package admission (#1443) passes, and several native seams are usable, but required lifecycle, credential, policy, prompt/App and management seams remain unavailable. Adapter removal and single-owner cutover stay blocked.

This is an evidence and decision receipt. It changes no package pin, server configuration, credential, runtime activation or deployment.

## Reproducible contract

`runtime/test/fixtures/earendil-mcp-0991-contract.json` freezes MCP-01–15 ownership/status/reason rows at SHA-256 `f984b289503a6238eee03e5007083663da6e44d25085d4ce4c585a1f383f492e`. The checker rejects any matrix mutation. Only MCP-01 is `pass`; implementable rows remain implementation work, and required missing seams are `blocked` or `fail`.

`bun scripts/check-earendil-mcp-public-api.ts` runs against the actual packed 0.99.1 consumer admitted by #1443:

- a positive TypeScript program compiles root-public coding-agent MCP/discovery/codemode factories, config/transport callbacks, pi-mcp client/transports/resources/request and OAuth primitives;
- a negative program must produce exactly ten named diagnostics proving no public fields/methods for initial lazy lifecycle, status observer, resource filter, headless auth controller, App renderer, absolute deadline injection, generic credential-store substitution, socket config, prompt listing or prompt retrieval;
- the lifecycle probe delays the extension's second lazy runtime load, shuts the session down, then releases it and records connection/client/tool cleanup effects.

The compile checker uses package root/public subpath declarations only and neither constructs a parallel MCP client nor imports private coding-agent paths as an implementation workaround. The lifecycle evidence harness deliberately intercepts the packed `dist/extensions/mcp/runtime.lazy.js` implementation through a disposable Bun mock, and source review reads packed implementation files. Those are test/evidence dependencies, not production imports.

## Public surfaces available in 0.99.1

The following are public and can support later children:

- `createMcpExtension`, `createToolSearchExtension` and `createCodemodeExtension` for explicit SDK resource loading;
- synchronous `loadConfig(ctx)`, `createTransport(entry,cwd,authProvider)`, `updateConfig(entry,patch)`, `startupWaitMs`, `logPath` and `openUrl` options;
- stdio and streamable HTTP server config, server/tool exposure and enabled/timeout fields;
- `McpClient`, `StdioTransport`, `StreamableHttpTransport`, request cancellation/inactivity timeout, tools, paginated resources/templates, reads and calls;
- public low-level OAuth authorization/discovery/token primitives and memory state storage;
- native tool hooks and `parentToolCallId` for direct/nested tool execution.

These primitives make MCP-02/04/05 implementation candidates. They do not establish host-policy parity by themselves.

## Blocking seams

| Requirement | Exact packed public evidence | Decision |
|---|---|---|
| Initial lazy lifecycle | Every enabled server starts from `session_start` after one event-loop turn. `deferred`/`hidden` only changes exposure; `startupWaitMs:0` only changes first-prompt waiting. No `lazy`, keepalive or idle option compiles. | **Blocked — MCP-08 / #1448.** |
| Socket representation | `McpServerConfig` is stdio or HTTP. `{type:"socket",socket:...}` is rejected. A custom transport factory cannot make an invalid/synthetic config a supported contract. | **Blocked — MCP-08 / #1448.** |
| Absolute operation deadline | Public calls accept cancellation/inactivity timeout, but `McpExtensionOptions.absoluteDeadlineMs` is absent and extension-owned tool execution exposes no host signal/controller seam. | **Blocked — MCP-07 / #1448.** |
| Keychain credential store | `credentials` is a concrete `McpOAuthCredentialStore` whose public type requires inaccessible implementation/private state. `{}` and a generic structural store do not compile. Low-level OAuth primitives do not inject a host store into the sole extension owner. | **Blocked — MCP-03/MCP-10 / #1447/#1450.** |
| Headless OAuth | `openUrl` is notification only. The integrated `/mcp login` path requires interactive UI. No public extension `authStart/authComplete` controller compiles. | **Blocked — MCP-10 / #1450.** |
| Resource policy | Native resource tools aggregate enabled, non-hidden servers and take the widest server exposure. No `resourceFilter`/URI policy hook compiles. Hidden servers disappear; broadening exposes metadata too widely. | **Blocked — MCP-06 / #1449.** |
| Prompts | The extension owns its clients and exports no prompt tools/controller. `McpClient.listPrompts/getPrompt` do not exist. Generic `request()` could send raw methods only from a prohibited second client. | **Blocked — MCP-11 / #1449.** |
| MCP Apps | The runtime deliberately filters `ui://`/`profile=mcp-app` resources. No public App renderer or host message/stream bridge compiles. | **Blocked — MCP-11 / #1449.** |
| Status/management | `/mcp` has internal UI state, but no public connection observer/snapshot/reconnect/login/logout controller compiles. TUI scraping is prohibited. | **Blocked — MCP-12 / #1451.** |

Current adapter config/import/keychain/policy/output behavior also still requires implementation and qualification; package primitives do not silently satisfy it.

## Lifecycle race classification

The earlier source review suggested a startup/shutdown resource leak. The controlled probe narrows this:

1. `session_start` loads the runtime once before invoking `createConnection()`.
2. `createConnection()` performs a second lazy-runtime load. The probe delays this second load.
3. `session_shutdown` increments the generation and closes the current connection snapshot while none exists.
4. Releasing the delayed load constructs one `McpServerConnection`; the post-create generation check returns without adding it to the extension's server state.

Receipt: `runtimeLoads:2`, `connectionsConstructed:1`, `clientStarts:0`, `connectionCloses:0`, `toolRegistrations:0`.

No `getClient()`, transport, server process, request, listener or tool registration starts; therefore this is **not a demonstrated resource/process leak** and does not fail MCP-09's resource-cleanup criterion. The transient constructed object is not explicitly closed, so MCP-09 remains `implementable` cleanup work with a regression requirement. Any upstream report must describe this measured object-lifetime asymmetry, not claim leaked processes.

## Decision and allowed next work

Full upstream replacement on unmodified exact 0.99.1 is **no-go** under the accepted scope because MCP-03/06/07/08/10/11/12 lack required public seams. MCP-02/04/05/09/13/14/15 are implementation, qualification or cutover work and do not themselves prove an upstream public-API deficiency. The old adapter remains the sole owner. The following paths require Rui's explicit decision before cutover planning continues:

1. target a later exact upstream release that supplies the missing public seams;
2. explicitly waive named capabilities/security/lifecycle requirements;
3. approve a core-only 0.99.1 migration with `pi-mcp-adapter` retained as the MCP owner.

A private import, private-class cast, fake transport config, parallel client, TUI scraping, patched agent tool array or automatic adapter fallback cannot be used to make the gate appear green. No third-party issue was filed; upstream collaboration requires separate authorization and exact API/fix requests.

## Reproduce

```sh
EARENDIL_0991_CONSUMER=/path/to/admitted-consumer \
  bun run test:controlled -- runtime/test/scripts/earendil-mcp-public-api.test.ts

bun scripts/check-earendil-mcp-public-api.ts \
  --consumer-root /path/to/admitted-consumer \
  --tsc node_modules/.bin/tsc \
  --contract runtime/test/fixtures/earendil-mcp-0991-contract.json
```

The check performs no server connection, OAuth flow, provider call, credential access or installation. MCP-14 live validation remains separately authorized work after blockers resolve or are explicitly waived.
