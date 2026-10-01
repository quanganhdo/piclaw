# Earendil 0.99.1 MCP lifecycle decision (#1448)

Full native MCP replacement remains **no-go** on exact 0.99.1. The retained `pi-mcp-adapter` owns lifecycle/transports/cancellation; Piclaw retains its absolute operation deadline and now aborts the actual adapter operation when that deadline expires.

## Retained owner

The exact coordinates are Earendil 0.99.1 (`d86654abb8862e201933517d6f1fce9f88dd117f`) and `piclaw-bot/pi-mcp-adapter@082ade48096e85f60c1d1343ce2b9328d605ad45` (2.31.0 family). The pinned adapter supports lazy (default), eager, keep-alive, lazy-keep-alive and idle-timeout lifecycle modes; stdio, streamable HTTP/SSE compatibility and Unix-domain sockets; request inactivity timeouts; caller abort propagation; reconnect single-flight; runtime shutdown and child/transport cleanup. Its clean upstream receipt is 1,402 tests. Piclaw integration proves eager start is deferred until the SDK session owns `session_start`, one process belongs to each replacement owner, and disposal closes the process.

Adapter session recovery retries only narrowly proven terminated sessions carrying a prior session id (HTTP 404 or exact server-not-initialized gates). Ambiguous HTTP/connection errors propagate; generic mutating failures are not replayed.

## Absolute deadline

Adapter request timeout is an inactivity limit and can reset on protocol progress. Piclaw's `domains.tools.mcpToolTimeoutMs` remains a separate absolute deadline (120,000ms default; zero disables only this wrapper).

The compatibility wrapper now:

- creates a child `AbortSignal` for the actual registered MCP tool execution;
- forwards caller abort into that signal;
- aborts the signal when the fixed wall-clock deadline expires;
- races completion so an implementation that ignores abort still cannot deliver a late result;
- never resets its timer on progress;
- recognizes proxy, script, namespace and label-marked direct MCP definitions present at session binding;
- avoids double wrapping the same definition.

The private `_agent.tools` compatibility seam is deliberately retained. Hot registration after the binding scan cannot be proven through a public Piclaw hook; adapter protocol timeouts/caller abort still apply, but exact absolute-deadline parity for every future dynamic direct definition is a cutover blocker, not silently waived.

## Native exact-target blockers

Earendil 0.99.1 native config has stdio/HTTP only and no initial-lazy/keepalive/idle/socket field. Every enabled native server connects at `session_start`; deferred/hidden exposure and `startupWaitMs:0` do not change transport lifecycle. The native extension exposes no host absolute-deadline signal injection around its dynamic tools, and initial `getClient()` cancellation coverage is insufficient.

The controlled #1444 delayed-load probe remains correctly classified: one transient connection object, zero client/transport/tool/resource ownership; not a process leak. Native adapter removal waits for a later exact public seam or explicit scope change.

## Reproduce

```sh
bun run test:controlled -- \
  runtime/test/extensions/mcp-timeout-patch.test.ts \
  runtime/test/extensions/mcp-lifecycle-contract.test.ts \
  runtime/test/agent-pool/mcp-adapter-bundled.test.ts
```

Result: 17 pass / 67 assertions; log SHA-256 `555789e2d59aaeb9ecf99ab4493a8fb3d174cc6713b09f7a2792365af84dc94e`. The adapter clean-environment suite ran 1,402 tests; log SHA-256 `6f5ee1ec3bebf9fde135a95db701315796c066cf1ff9d5e7b58f5c7fe08ed290`.

No live server call, credential, deployment or restart is part of this receipt.
