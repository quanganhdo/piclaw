# Instance MCP engine settings and switch policy

The MCP settings pane will select one instance-wide owner: the existing adapter or native pi MCP. Codemode will offer Auto / On / Off, defaulting to Auto. Adapter remains the default; backend compatibility checks must reject unsupported configurations instead of dropping settings or selecting a fallback.

Rui approved immediate switching through the supported public lifecycle: abort active agent turns, then reload all extensions while preserving chat/session identity and history. This is not MCP-only teardown. The pane must disclose this interruption. No service restart is required by the policy; deploying this feature remains separately authorised.

## First slice: policy and coordinator

`mcp-engine-policy.ts` defines the strict non-secret engine/codemode shape and codemode requirement resolution. Invalid choices and unknown fields reject. Off rejects exposure requiring codemode. Determining which configured exposure requires codemode belongs to the later engine-specific planner.

`mcp-engine-switch.ts` defines an unwired host contract and coordinator:

1. Strictly parse and validate the requested policy before disturbing the current owner.
2. Synchronously fence admission and old executions; drain pre-fence runtime creation and capture every participating session atomically.
3. Abort all participant turns before changing the inline-factory selection.
4. Reload participants through public `AgentSession.reload`. The SDK emits old `session_shutdown`, reloads all resources and rebuilds tools.
5. Hold every `beforeSessionStart` hook until all participants reach it. Persist the selected policy before releasing any new startup.
6. Complete every reload, then reopen admission. Abort, snapshot, reload, persistence and startup failure leave the host fenced without fallback.

A real transition deadline bounds caller completion even if a participant hangs. Failed transitions quarantine captured sessions and late-returning snapshots through host-owned public runtime teardown. Reloads completing after failure trigger teardown again. Cleanup is deliberately not awaited without a bound before reporting failure; the host remains blocked until recovery is explicitly implemented. The host must provide idempotent quarantine and an idempotent synchronous non-throwing fence. Resume must open admission atomically; defensive re-fencing handles a throwing resume.

Status distinguishes confirmed active, selected and persisted policies. Unknown selection/commit outcomes are null, never represented as rollback. Raw participant diagnostics do not enter the status or returned failure.

## Public lifecycle and ordering

Exact Earendil 0.99.1 publicly declares `AgentSession.abort()`, `AgentSession.reload(options)` and `AgentSessionRuntime.dispose()`. No private extension runner, manually invoked shutdown handler or mutated agent tool array is used.

The supplied public resource loader reinvokes inline factories on reload; each factory must capture its selected owner for its generation. Selecting the owner in `beforeSessionStart` would be too late because tools are already rebuilt. New owner factories must not acquire MCP resources before `session_start` if they participate in this barrier.

The actual runtime's reload emits the startup hook only when lifecycle bindings exist. Piclaw installs error/shutdown bindings; the host integration must preserve them. A reload bypassing the hook is a failed transition.

## Tested scope

Bun tests cover strict engine/codemode choices, all-abort-before-selection, all-shutdown-before-start, persistence ordering, duplicate participants/hooks, incompatible configuration, failure categories, hung participants, late snapshot/startup quarantine, resume failure and unknown selected/durable state.

An isolated probe uses actual public SDK sessions with synthetic owner extension factories. It verifies two preserved session IDs and histories, unrelated extension reload, replacement of registered old tools, and shutdown/commit before new startup. No inference or real MCP connection runs; active agent turn interruption is tested through fake abort participants only. Initial fixture failures from a tool allowlist and missing lifecycle binding were corrected and retained locally. That probe establishes SDK ordering, not full MCP switching acceptance.

Focused result: 21 tests / 127 assertions; independent review findings fixed and re-reviewed. Scoped strict typing, Oxlint and diff checks pass. At baseline `5fb7dbad40dbc04c9a21a84086be3eb0ff743e16`, `make ci-fast` passed 6,015 runtime tests, eight existing/opt-in skips and no failures, plus 25 feature tests and nine web checks. Pack hygiene passed 24,745 files; final five typechecks passed with the unchanged 95-diagnostic compose baseline. Private Bun caches were used without shared-cache permission changes.

## Remaining implementation

- Register instance engine/codemode settings, with strict persistence/revisions and administrator-only writes.
- Build engine-specific server/exposure/codemode capability plans from the revisioned MCP bridge. Preserve secret references and fail closed for missing native credentials/policy/lifecycle controls.
- Install exactly one selection-reading owner factory and codemode factories; fence tool execution and admission in the real pool.
- Connect public abort/reload and idempotent runtime quarantine to every cached/in-flight session; qualify real adapter/native resource closure, late completion and interrupted turns.
- Add the consolidated backend endpoint and MCP pane, including current/selected/effective state, compatibility reasons, interruption warning and structured server settings.
- Test server persistence, auth safety, real owned transports and browser interactions on Bun before publication/deployment.

This first slice does not install a runtime controller, mutate configuration, expose an API or add a settings pane. Native parity, exact 0.99.2 adoption, live authentication, deployment and epic acceptance are separate gates.
