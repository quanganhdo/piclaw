# Earendil 0.87.0 stable Harness candidate evidence

Evidence date: 21 September 2026. Published release: `0.87.0`, commit `16787ad5b2dc748047f314ca1bfe7708f30f54f3`.

Piclaw still installs the coordinated 0.85.1 package family. This record assesses a packed, disposable 0.87.0 consumer. It does not select 0.87.0 for the current loop or activate a Harness runtime.

## Package closure

The packed candidate contains six coherent packages. Every package reports Node `>=22.19.0` and the same `gitHead`.

| Package | Install role | npm shasum |
|---|---|---|
| `@earendil-works/chord` | transitive | `b033dc0d576114e2b36e95d3cb50f8301ddf7bfd` |
| `@earendil-works/pi-agent-core` | direct | `cd8ec116e33c38e2dd551030fb83654bf5ce33af` |
| `@earendil-works/pi-ai` | direct | `e81ec36ab4e9f44bafa2c980c7ec3cf8cda32f8d` |
| `@earendil-works/pi-coding-agent` | direct | `908417741052a4ef12d9b9a8c0acb98a51ce9d87` |
| `@earendil-works/pi-telemetry` | transitive | `3d63532659b3904f784c03daa8a3fb90be8f7746` |
| `@earendil-works/pi-tui` | transitive | `bdfa9b094b6d59628d92c55b485b01fd281c6284` |

The closed compatibility manifest stores each npm integrity, shasum, public export list, internal dependency range and 16 SHA-256 fingerprints for stable public runtime/declaration targets. The separate [`./experimental/pico3` assessment](earendil-0870-pico3-assessment.md) records its own packed-target hashes and does not change stable AgentHarness evidence.

The repository's existing package-admission checker passed against a standalone coding-agent-only 0.87.0 consumer under real Node 22.19.0 and Bun 1.4.1. It found all six packages, imported the three root runtime exports, made zero provider factory calls, inherited no secrets, requested offline operation, disabled telemetry and rejected `./client` plus `./experimental/plugin` at export resolution. The checker does not provide an OS-level network sandbox; the receipt records `networkSandboxed: false`.

## Stable public surface

- Package-root and stable Harness subpath imports succeeded in the disposable 0.87.0 consumer.
- `AgentHarness.watchSession()` still throws `SliceNotImplemented` with `watchSession is not implemented until its later AgentHarness slice`.
- The stable `harness/session` barrel exports neither `MemoryStorage` nor `JsonlStorage`; raw Storage conformance remains unavailable without deep/private imports.
- `harness/session/testing` exports streaming-fork conformance. Its 15 unique cases pass for Memory and JSONL: 30 executions with zero failures. SQLite streaming-fork support and cross-process host ownership remain unproved.
- Piclaw's `ExecutionEnv` direct assignment fails until #1378 implements `openTextLineReader`.
- Current-loop provider/compaction assignments require transcript-native migration in #1377.

## Candidate semantic receipt

A disposable clone installed the exact 0.87.0 package family and changed only candidate-version labels/assertions. The existing deterministic public cases for HC-001–HC-023 passed:

- 28 tests;
- 340 assertions;
- zero failures.

These executions retain `partial` status because each 0.85.1 unproved remainder still applies. HC-024 remains `unsupported`. HC-025 is `partial`: public streaming-fork conformance passes 15 Memory and 15 JSONL executions covering application-list pagination/copy/survivor/sequence cases, open/closed branch application state and malformed unrelated lanes. SQLite streaming-fork support and cross-process host ownership remain unproved. No candidate row is a full pass.

## Promotion boundary

Candidate promotion depends on:

- #1377 — transcript-native providers and compaction;
- #1378 — `ExecutionEnv.openTextLineReader`;
- #1379 — `usage` and `context_edit` session entries;
- #1380 — canonical orphan tool-result repair;
- #1381 — coordinated package-family update and full gates.

Production Harness activation remains separately blocked. `ServiceWorkStore`, `TerminalSettlementStore`, `ServiceOutboxStore`, `ScheduledRunStore` and `AgentProjectionSink` retain their current authority.
