# Standalone add-on package-root imports on 0.85.1

**46 packages checked: 42 package-root imports pass and four no-main skill packages have their declared paths present.** This is Linux x64/Bun 1.4.1 import evidence, not functional, activation, prepack-asset or cross-platform readiness.

[Machine-readable receipt](earendil-0851-addon-matrix.json) records each package, archive SHA-256, entry paths, installed/nested family versions and ESM peer-resolution provenance.

## Method

- Source: add-ons revision `6374ed3c85627c590794e44828d13b08587ba46b`; all 3,350 files under its `addons/` tree were compared byte-for-byte with the extracted disposable source tree after the run. This verifies that source tree against the Git revision; individual package archive hashes are separate receipts.
- Each package was packed with `bun pm pack --ignore-scripts`, installed into its own fresh consumer with lifecycle scripts disabled, then removed after its receipt was captured. No live add-on installation changed.
- Consumers pin the three runtime packages and pi-tui to 0.85.1, with matching family overrides and typebox 1.3.16. All six root family packages and recursively discovered family packages must be 0.85.1. pi-server is rejected.
- Declared Earendil peers are resolved with ESM conditions from each installed package entry point and must resolve within that consumer. The initial CommonJS-resolution attempt failed on ESM-only exports; it was corrected and the full matrix rerun. Those resolver failures are not add-on regressions.
- Only `import(packageName)` is executed and its function-valued default export checked. Package resolution may use `exports` rather than `main`. The harness never invokes default factories, registered handlers, separate runtime entries or browser entries. Imported top-level code still executes.
- Declared extension, skill, main, web and runtime entry paths are checked for existence in the archive. This does not check every file referenced by code or skills; prepack scripts and browser/native functionality are not executed.
- Import processes use explicit secret-free environment variables and owned HOME/Piclaw/XDG paths. A Linux seccomp wrapper denies internet socket creation and connect/send syscalls; fetch is also replaced by a throwing trap. A loopback-denial control returned `FailedToOpenSocket`. This is a bounded process-local policy, not a general hostile-code sandbox. Packing and dependency downloads occur outside that filter.

The four no-main packages are `diagram-tools`, `export-timeline-pdf`, `settings-dialog-screenshot` and `yolochat`. Their scripts were not run.

## Coherent compatibility rerun

The earlier disposable compatibility tree still had a direct pi-tui 0.84.4 development peer. It was corrected to 0.85.1 without changing the source repository. The compatibility suite then passed again: **125 tests across ten files**, plus the general compatibility, M365 and Remote Peer typechecks. This corrected result supersedes the earlier mixed development-peer evidence.

## Remaining limits

This completes the 46-package **package-root import/path smoke matrix**: 42 imports and four no-main path checks. Runtime-startup modules such as Remote Peer transport activation, provider interaction, browser panes, platform-native libraries, full add-on tests and non-Linux execution still need their relevant approvals and environments. No merge, deployment, service restart, live-provider request or production migration occurred.
