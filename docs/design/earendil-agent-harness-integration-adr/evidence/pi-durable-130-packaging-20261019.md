# Native package boundary — 19 October 2026

Base: `2555cd628aee2c002d319cf489da4222c3b706be`.

## Changes

- Ship the native engine source, manifest, frozen lock and installer.
- Install the private production dependency graph during postinstall, including
  explicit postinstall calls in scripts-disabled Docker and portable builds.
- Require all five private SDK packages at exactly `1.3.0` before native import.
  Missing or incompatible dependencies reject startup; no ancestor fallback.
- Keep the host SDK at `1.2.0`, declare MCP directly, and replace literal
  dependency-directory imports with a host-anchored public-export module.
- Refresh the genuine published seven-core catalogue, archives, checksums and
  frozen seed lock. Goal `0.1.49` and Delegate `0.2.20` match native source policy.
- Remove the obsolete side-cache argument and unused map from the offline Plan
  qualifier. Classify the host module's 22 explicit cross-project exports without
  exempting other exports or changing the existing unused-export baseline.

## Evidence

| Check | Result |
| --- | --- |
| Actual package | 25,578 files; 47.29 MB compressed; pack exit 0 |
| Isolated global layout | Fresh `/tmp` prefix, private HOME/workspace, cleared environment; install and explicit packaged postinstall succeeded |
| Host/native boundary | Host `1.2.0`, native `1.3.0`; actual Read and MCP bindings identical to host exports |
| Native behaviour | Packaged application factory imported; public Harness opened and closed native SQLite; paused, zero tasks and provider requests |
| Engine and candidate types | Both passed |
| Packaging, dependency, policy and portable regressions | 16 pass, 0 fail; 42 assertions |
| Scripts types | Passed after removing obsolete side-cache argument |
| Offline Plan qualifier | 22 cases, 111 rows; zero fetch attempts |
| Dependency pins, circular imports and silent catches | Passed |
| Import-boundary policy | Existing 21 findings byte-identical to frozen base |
| Unused-export policy | Existing findings compared separately; engine-only exports have explicit closed retention reasons |

The fresh layout has no ancestor workspace dependency tree. The probe resolves
published ESM entries, not CommonJS-only `require.resolve` conditions. An initial
probe using those conditions failed; correcting the probe passed without changing
or reinstalling the tested package.

## Actual first-workspace admission remains blocked

A separate probe used the packaged **production seeder**, including its host-peer
links, and a private file-backed application database. All seven bundled add-ons
loaded without errors. Plan, Delegate, Code Review and Goal passed exact installed
source qualification. The unmodified native admission guard then rejected:

- Observability: `resources_discover`, `session_start`, `before_agent_start`.
- Restic: configuration tool has no operation-owned host effect port.

Therefore this is dependency/package evidence, **not** successful default startup.
Do not merge the source-default runtime as ready by suppressing these handlers,
removing bundled capabilities, weakening admission or fabricating session context.
Adopt the remaining consumers through native hooks and existing domain services.

The frozen base's root CI and browser results remain separate receipts. The
candidate log printed 646 passes but has no numeric completion receipt; it is not
claimed as a completed current-source gate. Whole-real-history compatibility,
pending authority/reopen and public-API acceptance gaps remain open. No managed
runtime installation, service restart, live capture or migration was performed.
