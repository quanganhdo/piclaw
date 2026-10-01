# Earendil 0.99.1 MCP policy boundary (#1447)

Piclaw retains `pi-mcp-adapter` as the sole MCP runtime owner. Native Earendil MCP/codemode/tool-search factories remain unwired because #1444 proved exact 0.99.1 lacks required resource/status/lifecycle/auth public seams. This slice closes policy widening paths in the retained owner and records what remains blocked for native cutover.

## Adapter policy

The pinned adapter evaluates include/exclude selectors against raw names and every configured prefix candidate. Empty inclusion means allow-by-default; inclusion is AND NOT exclusion, so exclusions always win. `*` and `?` retain glob semantics. The adapter filters cached/live tool and resource-derived metadata before direct, namespace, list, search and describe publication. Calls to names absent from the filtered registry fail locally without connection or transport invocation.

The Piclaw contract tests freeze:

- raw, server-prefixed and `mcp__` candidate matching;
- single-character `?`, multi-character `*`, empty filters and exclusion precedence;
- filtered tool/resource metadata on list/search/describe/call surfaces;
- denied calls causing zero manager connection calls;
- adapter integration policy over stale discovery and immediately before transport.

## Immutable registrations

Piclaw's #1446 bridge is a complete immutable session snapshot. A policy extension is installed before the adapter and rejects `MCP_RUNTIME_REGISTER_EVENT` requests. An extension therefore cannot add a new server outside admitted layer provenance, quarantine and scoped credentials. Config writes remain revisioned/authorized through the bridge.

## Family and late output

Family mode does not admit `mcp`, dynamic MCP direct names, codemode or tool-search into its fixed tool ceiling. The family guard reauthorizes every SDK-routed call and final `tool_result` delivery. Static family definitions already reauthorize their update callbacks and final results, so logout/source/policy revocation suppresses private partial output before it is emitted. Dynamic MCP names are never admitted to the family tool ceiling; final SDK-routed results are replaced with a bounded `session_access_denied` result. Private content and path-bearing errors are not released.

Static custom definitions remain wrapped at execute/update/result boundaries. Unknown, replayed, dynamically registered or stale tool names fail the live family policy check. Operation-profile sessions load no ambient extension factories, including MCP.

## Native 0.99.1 decision

Exact native MCP remains blocked rather than weakened:

- native shared resource tools aggregate servers at the widest exposure and have no per-server URI/result filter seam;
- prompts and MCP Apps have no required public host path;
- initial lazy lifecycle, host status observer and keychain credential-store injection remain unavailable;
- hidden exposure is not a lifecycle control.

Accordingly no native direct/deferred/codemode resource is activated. Policy parity is provided by the retained adapter; adapter removal remains prohibited until a later exact target supplies the missing public seams or Rui explicitly changes scope.

No live MCP call, credential, install, restart or deployment is part of this receipt.
