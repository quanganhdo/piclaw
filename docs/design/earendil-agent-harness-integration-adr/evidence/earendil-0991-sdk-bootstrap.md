# Earendil 0.99.1 SDK/bootstrap and MCP config bridge (#1446)

Piclaw now owns the MCP configuration/credential bootstrap boundary while retaining `pi-mcp-adapter` as the sole runtime MCP owner. The adapter is pinned to `piclaw-bot/pi-mcp-adapter@41cf80e0d5a8ff8d963a37a9c742280649b3db1f`, which adds per-server runtime environments and restores `initializeOnLoad:false` for synchronous SDK hosts.

No native Earendil MCP/codemode/tool-search factory is activated. This change performs no live server/provider call, installation or restart.

## Bridge authority

At runtime bootstrap, Piclaw loads the adapter's four normal config layers and approved imports once through its public `pi-mcp-adapter/config` API. It produces an immutable revisioned snapshot containing:

- sanitized adapter config;
- server source provenance and source-file revisions;
- per-server quarantine diagnostics and disabled tombstones;
- a redacted `mapped` / `blocked` / `quarantined` dry-run;
- a native 0.99.1 preview only for semantics with exact public equivalents.

Malformed project overrides fail lower projections closed. Invalid optional servers are quarantined independently. Unknown/malformed fields, ambiguous transports and literal credentials never enter an exported snapshot.

The native preview is migration evidence only. Adapter-specific auth, sockets, lazy/idle lifecycle, filters, resources, request-header commands, named direct subsets, approvals and protocol settings remain explicitly blocked rather than approximated.

## Secret boundary

`bearerTokenKeychain` values are resolved into generation-owned in-memory maps, never global `process.env`. Each session leases its generation and supplies `resolveRuntimeEnv(serverName)` to the adapter. One eligible connection receives one frozen, minimal environment containing:

- required operational values such as PATH/HOME when available;
- referenced variables for that server;
- that server's keychain credential only.

URL/argument/path/header/bearer/OAuth interpolation and stdio/command-secret/request-header/npx subprocesses all use that snapshot. Concurrent and replacement sessions retain their generation until its final lease releases. Superseded hydrations cannot overwrite newer state; retired generations reject new leases and erase secrets after the final release.

## Writes and status

Piclaw status helpers consume the prepared snapshot and public adapter type/cache exports; they no longer reread raw MCP config. Authorized project override writes require the current snapshot revision and all source files unchanged, validate semantics and secrets, reject symlink path components, lock the Piclaw-owned directory, write a mode-0600 temporary file, fsync, rename, fsync the directory and reload the bridge. Failed/stale writes do not change the active snapshot.

## Validation

Focused tests cover:

- layer/provenance/quarantine/tombstones and malformed overrides;
- supported env/command/keychain references and missing-variable failures;
- sentinel-secret absence from snapshots/config/dry-runs/files;
- scoped stdio child expansion and cross-server isolation;
- generation concurrency/final release;
- atomic writes, revision conflicts, authorization and semantic rejection;
- adapter session ownership, delayed startup and tool policy;
- public status compatibility and 0.99.1 core pin contract.

Full typecheck/CI results are recorded on the PR. Deployment remains reserved for the final canary gate.
