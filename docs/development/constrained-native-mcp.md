# Experimental Native MCP in Settings

Native is an optional, tool-only MCP engine. Adapter remains the default and supports configurations outside this profile.

## Supported profile

- Single-user administration on POSIX hosts. Windows uses Adapter until process-tree cleanup is qualified.
- Local stdio servers with an explicit command, arguments and literal environment values. Children receive a small operational environment, excluding unrelated provider and server credentials.
- HTTP servers with an explicit server-scoped bearer credential. Existing bridge keychain/environment references resolve within the captured server generation; no secrets appear in preview or persisted Native headers.
- HTTP responses must be JSON, bounded to 1 MiB. SSE-only servers use Adapter. Redirects and requests to different endpoints are rejected.
- Native direct and deferred tool exposure. Auto enables codemode when exposure requires it; model execution inside codemode stays disabled.

Resources and prompts are disabled at discovery and direct protocol access. Server sampling and elicitation are denied. Native MCP apps, browser OAuth, provider authentication and extension-registered servers are unavailable. Unix sockets, lazy lifecycle, adapter include/exclude policies, per-request header commands, and per-server absolute-deadline settings reject Native compatibility preview.

Pi can retain its normal private `mcp-auth.json` storage because the extension receives no replacement store. This profile never starts OAuth or consumes that file for HTTP authentication: HTTP uses the explicitly captured bearer credential. It does not copy or migrate existing credentials. A web OAuth flow needs separate qualification before using Pi storage for sign-in.

## Settings and switching

Both skins label the option **Native (experimental)**. Preview checks the complete configuration; unsupported entries, including disabled entries that cannot be projected, refuse Apply. Native server definitions are read-only in this first version. Switch to Adapter to edit them.

Apply requires fresh administrator authority, a current preview and acknowledgement that active turns may be interrupted. It fences new admissions, drains active work and waits for old-owner cleanup before saving the policy and loading replacements. All captured sessions reach a startup barrier before execution resumes. Config source identities, revisions, authority and policy are checked again after reload. Session IDs and history remain intact.

Failed cleanup, timeout, revoked authority, changed configuration or failed activation quarantines captured sessions and blocks admission. There is no automatic fallback or simultaneous owner. Repair or explicitly restore an approved policy before resuming.

## Cleanup guarantees and limits

The host retains Native shutdown obligations independently of upstream error suppression. Stdio cleanup closes pipes and signals the detached process group even if the parent already exited; a surviving group or pipe failure rejects acknowledgement. Descendants that deliberately escape the process group are outside this boundary. This is not a filesystem/network sandbox.

HTTP request IDs have local abort controllers. Cancelled RPCs abort their fetch/body work without creating another unbounded cancellation POST. Close aborts and drains every tracked continuation and retains reader-cancellation failures. Remote MCP session deletion is best-effort; fulfilled local cleanup does not prove remote deletion. GET/SSE streams are disabled in this profile.

Malformed JSON-RPC shapes, mixed request/response envelopes and oversized messages fail closed. Unsupported credential reference forms reject before activation; the owner uses the same header validator as preview.

## Qualification

Tests cover actual public SDK Adapter→Native→Adapter reload, preserved history and sole-owner leases; controller rejection when old cleanup fails; real stdio and loopback HTTP tool execution; 401 without OAuth/provider lookup; resource/prompt and sampling denial; held reply/body cleanup; RPC cancellation; ambient credential exclusion; parent-exits-first descendants; EPIPE; oversized bodies and mixed envelopes. Both Settings skins have Chromium/WebKit desktop/mobile preview, denial, stale-response and Apply checks.

Independent reviews initially found lifecycle and isolation blockers. Repairs introduced host-owned transports, captured-generation projection, rejectable startup barriers, fresh source/authority checks and shared header validation. Failed and superseded runs are retained. Final full-gate and review results belong in the PR receipt; this document does not count a mixed-source interrupted run as acceptance.

No live server login, production credential write, installation, restart or activation follows source qualification.
