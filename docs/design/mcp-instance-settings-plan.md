# Instance MCP policy persistence and compatibility planning

This prerequisite stores non-secret instance engine/codemode choices and checks whether the revisioned MCP bridge can represent them safely. It does not activate an engine, mutate server definitions, expose an endpoint or render a settings pane.

Defaults remain adapter/Auto. The policy is instance-wide, with no per-chat override. The agreed later application path aborts active turns and reloads all extensions through public SDK APIs while preserving chat identity/history; see [switch lifecycle](mcp-settings-engine-switch.md).

## Desired-policy persistence

`config-mcp.ts` registers the `mcp` domain (`engine`, `codemode`) and reads defaults or strict persisted values under `domains.mcp` in the existing instance JSON configuration. There are no environment overrides or secret values in this domain.

A policy snapshot includes the entire configuration file SHA-256, or `absent` for a missing file. Commit requires that revision, validates both the requested and current policy, preserves unrelated configuration, and rejects unknown fields or corrupt JSON/domain shapes. Reading uses one `O_NOFOLLOW` descriptor, with regular-file, owning-UID, single-link and private-permission checks. Existing group/world-accessible configuration requires permission repair before this API can use it; it is never silently reset or chmodded.

Writes create an exclusive random `0600` staging file, write complete JSON, file-sync, recheck the revision and rename. Return values describe the committed bytes without reopening the target and attributing a later writer's policy to this operation. Staging is removed on failure. The trusted owning parent and Bun POSIX layout are prerequisites. This is synchronous in-process revision fencing, not cross-process CAS, ancestor adversary protection or directory-fsync/power-loss durability qualification.

Commit is a low-level desired-state operation. A future authorised settings controller must validate the compatibility plan and coordinate fenced runtime switching before invoking it. These functions provide no HTTP or execution authority by themselves.

## Compatibility plan

`planMcpEnginePolicy` takes a trusted bridge snapshot plus explicit runtime readiness. An exported factory alone does not establish readiness. Output contains policy/revision, enabled server names, codemode activation and fixed issue messages; it returns no server values, secret references or raw diagnostics.

- Adapter-only settings remain valid with the adapter. A bridge row marked `blocked` means its native projection is blocked, not that the adapter configuration is invalid.
- Quarantined rows, failed configuration loading and uncertain sanitization prevent application.
- Native planning requires exact own-name projection parity, including disabled entries; rejects duplicate, extra, missing and enablement-drift projections; and respects native projection errors.
- Own-property lookup prevents inherited names such as `__proto__`, `constructor` and `toString` from masquerading as configured native servers.
- Native HTTP/credential settings, unresolved environment/command references and absolute timeout requirements remain blocked until the corresponding Piclaw lifecycle/policy integrations are qualified. Messages name incompatible fields without echoing their values.
- Codemode Auto is required only by enabled native codemode/codemode-deferred exposure or matching per-tool exposure. Adapter proxy access does not itself require native codemode. On activates independently when integration readiness permits; Off rejects required exposure. Disabled native servers do not activate codemode.

## Tests and limits

Focused tests cover persistence/defaults, unrelated-domain preservation, stale revisions, corrupt/unknown input, linked/non-private files, projection parity, inherited names, readiness, exposure and fixed diagnostic output. Fresh isolated child probes use the actual bridge for mapped, adapter-only and quarantined synthetic server definitions, awaiting hydration with live keychain access forbidden. The entire bridge and both plans are checked for a private sentinel; no real server connection or inference runs.

Initial bridge fixtures failed on incorrect app-export names and a missing cleanup argument; those errors were corrected and retained locally. A strict test check also found a readonly fixture tuple mismatch; it was corrected without weakening types. Review gaps in projection parity, property presence, descriptor reads, file permissions and sentinel checks were fixed and re-reviewed.

Combined focused set, including the already-merged switch foundation: 51 tests / 277 assertions. Scoped strict typing, Oxlint, silent-swallow, local-entrypoint and diff checks passed. At baseline `02c30e952ca825f0900375128224d58a18195e3d`, `make ci-fast` passed 6,045 runtime tests, eight existing/opt-in skips and no failures, plus 25 feature tests and nine web checks. Pack hygiene passed 24,747 files; all five typechecks passed with the unchanged 95-diagnostic compose baseline. Private Bun caches were used without shared-cache permission changes.

Runtime host admission/result fencing, real adapter/native teardown, owner/codemode factories, recovery from blocked transitions, privileged backend and consolidated pane remain unfinished. Native full parity, 0.99.2 admission, live auth and deployment approvals remain separate. No Node execution, live configuration/credential mutation, inference or service restart.
