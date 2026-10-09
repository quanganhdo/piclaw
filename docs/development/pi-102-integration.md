# Pi 1.0.2 integration

This source change selects released Pi 1.0.2 and retains the standard MCP wrapper shipped by Piclaw. Native MCP parity and wrapper removal are future work, not prerequisites for this integration. No installation, restart or real-account testing follows this source change.

Release: `cd32f7725fdbddbaecdff5b1e68491563394e0ca`, published 4 October 2026. Piclaw base: `62a71d139ff12acb17c53195e6e71beae1d4c86d`. Qualification uses Bun 1.4.2 on Smith LXC and disposable state. Pi-durable work is excluded.

## Changes from 1.0.1

The released chat integration adds `samplingParamsByThinkingLevel` to model configuration. Model defaults, effective thinking-level overrides and request overrides merge in that order. Public OpenAI-compatible payload tests verify this precedence without sending a request.

The provider-session persistence changes in the release belong to pi-durable and are outside this task. The later upstream OAuth fix `bde882c7471c` preserves rotated credentials when refresh is cancelled; it is **not in the 1.0.2 release** and is not claimed as qualified here. The public raw-auth/provider completion request remains separate from ordinary wrapper integration.

## Dependency and evidence boundaries

- Four direct package pins and all eight family overrides select exactly 1.0.2. The installed source dependency closure contains one coherent family. The standard wrapper dependency remains available and unchanged in this branch; the separately owned Settings branch adopts its approved public preview update.
- Package admission supports 1.0.2 additively. Its release commit, registry SHA-1/SHA-512 values and provider-receipt fingerprint are exact. Older admission constants remain unchanged.
- All eight release archives match registry hashes. A standalone single-dependency consumer passes archive/installed-payload comparison, guarded public imports, source-only/private import rejection and the removed durable/Harness boundary.
- Active version-specific tests use fresh 1.0.2 sources and measured receipts. Replaced 1.0.1 executable test registrations are retired; Git retains their source. Eleven immutable 1.0.1 artifact/receipt JSON files remain byte-for-byte unchanged and have a new SHA-256 guard.
- Historical validators check recorded version/outcome/fingerprint data. They do not compare old evidence to installed 1.0.2 bytes. Fresh validators compare the actual 1.0.2 package, CLI bundle and OAuth implementations to newly measured evidence.
- Native positive/negative public API probes still report ten missing seams. Their negative result documents future scope; it does not fail supported-wrapper integration. Unsupported Native selection remains rejected.

## Executed qualification

- Guarded public ModelRuntime smoke: 42 built-in providers, nine OAuth owners, no model/auth requests and zero guarded I/O attempts.
- Fresh SDK/bridge/lifecycle/OAuth/callback/project-override/codemode/package slice: 39 tests / 291 assertions passed.
- Fresh public thinking-level sampling tests: 2 tests / 12 assertions passed; no network sends.
- Device authentication: 22 Copilot/Kimi cases and six Codex cases passed with intercepted synthetic endpoints. These fixtures use fetch interception, not an OS network sandbox.
- Browser/copy-code methods: 20 browser and 17 Anthropic copy-code cases passed inside distinct loopback-only network namespaces.
- Exact packaged CLI: ten OpenAI/Codex cases passed inside separate network namespaces with disposable profiles and no inference. CLI bundle has 74 JavaScript files; package payloads and OAuth fingerprints were measured for this release.
- Anthropic private UI: ten Chromium/WebKit cases / 1,342 assertions passed. Stored cards, chat rows, recordings and exports omit synthetic credential input. Family gateway and real accounts are not exercised.
- Current combined slice: 104 passed, one existing opt-in cross-process crash case skipped, zero failed, 1,666 assertions across 20 files. Five type projects pass; the compose project retains 95 unchanged transitive diagnostics.

These are source/synthetic results. A frozen full repository gate, final review and exact-head hosted verification are required before merge. Installed production remains on its prior separately authorised version until a later rollout decision.

## Retained failed attempts

The first metadata runner used unversioned archive filenames; the admission checker correctly rejected them. The first new smoke used an absolute package subpath that bypassed exports resolution; a normal public import in an isolated source-local temporary script passed. Auth collection mistakes (wrong fixture mode list, expecting a top-level status, missing required Codex modes and mismatched CLI fingerprint fields) were corrected against the existing fixture contract and rerun.

Initial historical-validator conversion left an out-of-scope receipt expression and an installed-version assertion; those failures were retained and fixed. The fresh private-UI receipt gained the exact scope/field names expected by its unchanged assertions. No failed attempt counts as a passing receipt, and no test timeout, assertion or security policy was weakened.

## Work and permissions

Core issues 1442, 1449, 1450, 1451, 1454, 1455, 1456, 1458 and 1495, plus add-ons issue 160, now identify released Pi 1.0.2 as the integration target. Their earlier criteria are preserved as history and completed source slices are checked separately. Retained-wrapper policy and credential/cleanup protections remain requirements; Native replacement is no longer a prerequisite.

Startup/contention and runner corrections, final Settings integration, supported core/Delegate qualification and any approved live canary have separate receipts. This update neither activates the inactive provider host/shared installer nor pretends terminal delivery acknowledges raw cleanup. Installation, restart, live account/provider operations and any broader scope change require their own approval.
