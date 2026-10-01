# Earendil 0.99.1 Pico3 assessment (#1453)

Pico3 remains suitable for bounded fake-provider experiments. Production adoption is no-go: the experimental API has no SQLite backend or cross-process host authority and cannot replace Piclaw's service-effect stores.

This assessment targets `0.99.1`, gitHead `d86654abb8862e201933517d6f1fce9f88dd117f`. The historical [0.87.0 assessment](earendil-0870-pico3-assessment.md) retains its original 191-test upstream-source receipt and classifications. Those tests are not counted as new 0.99.1 executions.

## Exact public surface and internal changes

The public `@earendil-works/pi-agent-core/experimental/pico3` barrel still exports 30 runtime values. Its runtime/declaration hashes are unchanged from 0.87.0. This does not make the implementation unchanged: tagged-source comparison identifies three modified files, 75 added lines and 17 deleted lines.

| File | 0.99.1 change |
|---|---|
| `legacy-tracker.ts` | Adapts Chord's beginChange/prepare/adopt tracker to Pico3's flush/rebase document API |
| `session.ts` | Uses transaction document state for snapshots and config reads, retaining same-transaction updates |
| `view.ts` | Accumulates entry/document mutations into the tracker and flushes one envelope operation batch |

The [gzip archived tagged-source delta](receipts/earendil-0870-to-0991-pico3.patch.gz) has decompressed SHA-256 `107beb119c5e48b8dc804187f4783b594488ebf1fab990ee8a49745729358feb`. The [versioned assessment](../../../../runtime/test/fixtures/earendil-pico3-0991-assessment.json) pins both barrel and changed implementation fingerprints. Fingerprint reads are provenance checks. Behavioral fixtures import only the public experimental export and public Chord/pi-ai helpers.

## New bounded executions

Public-only Memory and JSONL fixtures test:

- accepted `send()` and duplicate `requestId` before `resume()` produce no fake-provider execution; resuming settles exactly once;
- config and snapshot reads observe same-transaction changes; a rejected transaction preserves published state;
- public watch envelopes fold into the same view as a fresh snapshot across config and entry writes;
- cancelling one queued input preserves the active turn;
- active abort signals the controlled provider and drains without a successor call;
- JSONL close/reopen preserves an undriven input identity, then runs once after resume.

Close/reopen is cooperative. It is not a SIGKILL, machine-failure, refresh-token rollback or external-effect replay receipt. Watches are binding-local execution views, not durable delivery receipts. No process-host invocation or process adoption was tested.

## Design and authority limits

| Requirement | Exact 0.99.1 disposition |
|---|---|
| Explicit permit/manual drive | Unsupported. Published `send()` admits work and `resume()` starts the scheduler |
| Next-run queue (HC-008) | Unsupported. `whenBusy` exposes steer/followUp/reject |
| Gate admission sites (HC-021) | Unsupported. No public Gate primitive or full site coverage |
| Open-operation storage migration (HC-024) | Unsupported. No public migration contract |
| SQLite/backend parity (HC-025) | Partial historical capability; no SQLite backend receipt |
| Cross-process ownership | Unsupported. One process owns a JSONL directory; in-process checks are not host replacement fencing |
| ProcessHost quality | Unverified; injected process identity/adoption remains an integration obligation |
| PC-001–PC-020 Piclaw service cases | Unverified; these fixtures do not exercise their acceptance criteria |

`ServiceWorkStore` (EF-S01), `TerminalSettlementStore` (EF-S02), `ServiceOutboxStore` (EF-S05), `ScheduledRunStore` (EF-S07) and `AgentProjectionSink` (EF-S08) keep Piclaw-owned source order, settlement, delivery leases, occurrence identity and projection fences. No production importer, registration, feature flag, schema or authority transfer is added.

## Validation

The final focused suite passed 60 tests and 1,002 assertions, including the merged #1452 Harness and production-import boundary regressions. Active-abort fixtures assert both observed provider cancellation and iterator settlement before teardown. All five typechecks passed, with the unchanged 95-diagnostic compose baseline. Independent final source review found no blocker.

`make ci-fast` passed 5,886 runtime tests (seven existing skips), 25 feature tests and nine web-build/static checks against baseline `8bee16968`.

Plain Node 26.7.0 and Bun 1.4.2 both imported the exact public surface and completed a disposable MemoryStorage commit/read roundtrip. Neither public-import probe constructs a model provider; the fake-provider execution counts belong only to the behavioral test suite.

| Public-import receipt | SHA-256 |
|---|---|
| [Node](receipts/earendil-0991-pico3-node.json) | `30a228ed293d4f6e1bc4b68bb7e7501b6f435e209bb2e9b1a7800bf2b7b3b297` |
| [Bun](receipts/earendil-0991-pico3-bun.json) | `de4c586320aed357dc4304ead8d957c7008650778c44a4d42e67a474f22d53d3` |

Reproduction commands from the repository root:

```sh
node runtime/test/service-effects/fixtures/earendil-0991-pico3-public-probe.mjs
bun runtime/test/service-effects/fixtures/earendil-0991-pico3-public-probe.mjs
bun run test:local --cwd runtime -- bun test test/service-effects/earendil-0991-pico3-evidence.test.ts
bun run typecheck
make ci-fast
```

Use real Node >=22.19.0 rather than Bun's Node shim. Offline fixture evidence does not establish live provider, OS network sandbox, deployed behavior or production adoption.
