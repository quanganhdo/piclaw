# Earendil 0.99.1 inactive Harness assessment (#1452)

Piclaw retains its service-effect authority and does not activate the upstream Harness. This assessment targets published `0.99.1`, gitHead `d86654abb8862e201933517d6f1fce9f88dd117f`, admitted by [the eight-package publication gate](earendil-0991-package-admission.md).

## Versioned evidence

Compatibility manifest schema 6 adds `currentRuntime` for 0.99.1. Its `selected` 0.87.1, `publishedCandidate` 0.87.0 and historical 0.84.x records retain their original contents and outcomes. Ten SHA-256 fingerprints pin the root, Harness declaration/runtime and session/testing export files of the installed package. Fingerprint reads are provenance checks; executable fixtures import only public package exports.

The public declaration probes and direct Piclaw model, credential and execution-environment assignments remain compile-time checks. The existing selected/broader public Harness cases and JSONL process-loss fixtures execute against exact 0.99.1 using faux providers. Their covered HC-001–HC-023 behaviours retain `partial` classifications because the recorded crash, migration, storage-instrumentation and host-ownership remainders still apply.

## Repository and streaming-fork coverage

| Suite | Unique case identities | Memory executions | JSONL executions |
|---|---:|---:|---:|
| Public SessionRepo conformance | 17 | 17 | 15 |
| Public streaming-fork conformance | 15 | 15 | 15 |

Unique cases count catalogue identities once across backends. Backend executions count each run. The ordinary repository suite excludes two destination-reservation cases from JSONL, matching its admitted suite. Streaming forks exercise open/closed application lists, pagination cursors, survivor/sequence retention, branch application state and malformed unrelated lanes. The standalone public-import consumer uses disposable repositories and an execution environment under real Node and Bun; it performs no provider request.

## Unsupported boundaries

- `AgentHarness.watchSession()` has a public watch-handle declaration but its runtime throws `SliceNotImplemented`. The regression executes that public method and checks zero faux-provider calls.
- Root and `harness/session` exports provide no `MemoryStorage` or `JsonlStorage` constructors. HC-024 open-operation storage-migration fault injection remains unsupported. Public conformance suite exports alone do not supply those constructors.
- Upstream marks SQLite streaming-fork implementation as pending. No SQLite or cross-process writable host-authority receipt is admitted here, so HC-025 stays partial.
- Piclaw's `ServiceWorkStore`, `TerminalSettlementStore`, `ServiceOutboxStore`, `ScheduledRunStore` and `AgentProjectionSink` continue to own their effects. The existing AST import-graph boundary rejects production Harness/Pico3 imports and activation.

## Validation

The final exact-target focused suite passed 128 tests and 2,096 assertions. All five typecheck stages passed, including the unchanged 95-diagnostic compose baseline. The positive public declaration probe, AST production boundary, fake-provider semantics, JSONL process-loss and Memory/JSONL conformance checks execute independently of the historical [0.87.0 stable Harness](earendil-0870-harness-candidate.md) and [streaming-fork](earendil-0870-streaming-fork.md) receipts. Historical manifest records are also checked against JSON digests from baseline `e27f6401f`.

The standalone consumer passed under Node 26.7.0 and Bun 1.4.2. Each run executed 15 Memory and 15 JSONL streaming cases across the same 15 catalogue identities. Catalogue SHA-256: `44763999b7db2e5322975172f7e54cdbac999ec32a0634085831e8ff90abdfbf`.

| Receipt | SHA-256 |
|---|---|
| [Node public exports and streaming forks](receipts/earendil-0991-harness-node.json) | `201db2a7bbcea91c018ed40ce42c86de5e097a7dc3f91f88a23d1302da781417` |
| [Bun public exports and streaming forks](receipts/earendil-0991-harness-bun.json) | `263624312a85586fc0add408cc98e526621b1d8ecab8403ed16983984afe7f11` |

Reproduction commands from the repository root:

```sh
node runtime/test/service-effects/fixtures/earendil-0991-public-probe.mjs
bun runtime/test/service-effects/fixtures/earendil-0991-public-probe.mjs
bun run test:local --cwd runtime -- bun test test/service-effects/earendil-0991-harness-evidence.test.ts
bun run typecheck
```

Use real Node >=22.19.0 rather than Bun's Node shim. The consumers import installed package exports, create only disposable repositories, and do not instantiate a model provider. The receipt records this source-derived scope as `providerExecution`, not a measured provider-call counter. These are offline fixture receipts, with no OS-level network sandbox claim.

`make ci-fast` passed 5,872 runtime tests (seven existing skips), 25 feature tests and nine web-build/static tests before the final receipt-only review corrections. The corrected receipt/probe/archive tests and all affected suites then passed the final 128-test focused run, both standalone runtimes and typechecks. No production file changed in those corrections.
