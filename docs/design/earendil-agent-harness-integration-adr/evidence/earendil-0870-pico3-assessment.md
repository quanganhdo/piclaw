# Earendil 0.87.0 Pico3 assessment

Assessment date: 22 September 2026. Release: `0.87.0`, commit `16787ad5b2dc748047f314ca1bfe7708f30f54f3`.

Pico3 is a substantial experimental execution kernel with durable tasks, atomic storage batches, Memory/JSONL persistence, conversation watches and a Chord view bridge. It is suitable for a disposable fake-provider spike. Piclaw should not adopt it in production from 0.87.0.

## Published surface

The supported package subpath is:

```ts
@earendil-works/pi-agent-core/experimental/pico3
```

The package requires Node `>=22.19.0`. Its packed runtime and declaration targets have these SHA-256 digests:

| Target | SHA-256 |
|---|---|
| `dist/harness/pico3/index.js` | `ce575fbbbd66e9bcb67ff0b6be483c5baefd1750cb10adaa1d73aedb9d66eafe` |
| `dist/harness/pico3/index.d.ts` | `1ef74b8615a31ec9eed49cfd9fa657b68958af82f1b6c480dfb40d65703a6d72` |

The runtime barrel exports 30 values, including `Harness`, `MemoryStorage`, `JsonlStorage`, task/entry definition helpers, built-in task witnesses, bounded output support, watch-envelope reduction and Chord services.

A minimal packed consumer imported the subpath under real Node 22.19.0 and Bun 1.4.1 with the same 30 runtime exports. The public TypeScript probe compiled strictly after installing `@google/genai`'s declared optional `@modelcontextprotocol/sdk` peer. Without that peer, whole-dependency checking fails in `@google/genai/dist/node/node.d.ts`; the Pico3 declaration probe passes with dependency-library checks skipped. The failure comes from transitive package closure. This assessment assigns no new Piclaw dependency.

## Executable kernel

The 0.87 implementation provides:

- conversations with immutable entries, fork inheritance and context edits;
- durable tasks, dependencies, checkpoints, abort marks and terminal outcomes;
- one serialized `Session` command line and atomic `Storage.commit()` batches;
- automatic task dispatch after `Harness.resume()`;
- generation, tool, post-tools, collapse, job and plugin task kinds;
- provider retries, deferred handles and best-effort deferred cancellation;
- safe/unsafe tool replay, durable effective arguments, memos and bounded streaming output;
- Memory and JSONL storage;
- snapshot-first conversation watches with binding-local revisions and a 256-envelope pre-start buffer;
- a bounded Pico-to-Chord view bridge;
- one in-process owner per `Storage` object.

The exact v0.87 source plus the published 0.87 `pi-ai` distribution passed the Pico3 Vitest suite:

- 22 test files;
- 191 tests;
- zero failures;
- Vitest 4.1.9.

Discarded runs: `bun test` lacked Vitest timer semantics, and the initial source-only Vitest run lacked built `pi-ai/utils/*` exports. Neither run contributes to the receipt.

## Design document versus shipped API

`packages/agent/docs/pico-v3.md` is still marked as a design under discussion and says the shapes are not package exports. The 0.87 package now exports an implementation, but the document also contains later proposed APIs that do not match that implementation.

| Design text | Published 0.87 implementation |
|---|---|
| Explicit `drive()` outcomes and scoped permits | Automatic scheduler after `resume()`; `send()` creates work |
| General state value/list API | Three Chord-tracked document classes and namespace slices |
| SQLite backend and shared database | Memory and JSONL only |
| General historical commit-boundary API | Entry/fork-aware context and rewindable document history |
| Durable schedule task design | `pi.job` supports optional recurrence through `every` |
| Session-level bounded watch API sketch | Per-conversation `Watch` with binding-local revisions |

The assessment uses exported declarations and implementation as evidence. Proposed text is useful for future direction but does not expand the 0.87 contract.

## Piclaw authority mapping

Pico3 can own execution state in a future experiment. It cannot replace Piclaw's service-plane stores.

| Piclaw contract | Pico3 alignment | Authority decision |
|---|---|---|
| EF-S01 `ServiceWorkStore` | `Input.requestId`, queued inputs and task IDs help correlate accepted work | Piclaw retains authenticated source order, operation owner/version, provenance, exact cancellation and frontier |
| EF-S02 `TerminalSettlementStore` | task/input outcomes provide execution evidence | Piclaw retains the atomic disposition, timeline/media, source, frontier and outbox transaction |
| EF-S05 `ServiceOutboxStore` | no external delivery lease/reconciliation store | Piclaw retains all delivery/notification/wake authority |
| EF-S07 `ScheduledRunStore` | `pi.job` can run/reconcile host processes and recur | Piclaw retains scheduled occurrence identity, task revision, leases, run logs, notification policy and next-run authority |
| EF-S08 `AgentProjectionSink` | watches and Chord publish conversation execution views | Piclaw retains owner/generation/receipt fencing, redaction and committed-terminal checks |

Pico3's Chord service has no Piclaw principal or service-operation identity. It must sit behind Piclaw authorisation and projection if a spike exposes it at all.

## Harness capability assessment

Pico3 self-tests provide partial evidence for 21 harness cases. They cover prompt/task settlement, tools, parallel joins, safe/unsafe replay, steer/follow-up queues, abort, compaction, retry, deferred recovery, reopen, corruption checks, conversation scoping, close/suspend, hooks/watch, usage entries, unknown-effect handling and in-process task claims.

Four HC rows are unsupported for the required contract:

- `HC-008`: the exported input modes are steer, follow-up and reject; no next-run queue exists;
- `HC-017`: no explicit gated/manual drive API exists in the published implementation;
- `HC-021`: no `Gate.admit()` primitive or site-completeness evidence exists;
- `HC-024`: no storage migration surface, SQLite backend or open-operation migration fault suite exists.

`HC-025` is partial. Memory and JSONL are implemented and tested. SQLite and cross-process writable host ownership are absent.

All `PC-001`–`PC-020` rows remain unverified. The Pico3 suite does not execute Piclaw's service work, terminal settlement, outbox, scheduled-run or projection contracts.

## Gaps and operational risks

- JSONL loads all history and supports one owning process per directory.
- There is no SQLite backend or cross-process ownership lease/fence.
- JSONL `fsync: true` does not fsync parent directories after file creation, rename or unlink.
- external effects remain at-least-once/unknown across the checkpoint-to-settlement window;
- the scheduler starts automatically after `resume()`, which does not match the ADR's explicit host drive/permit model;
- close is cooperative and can wait on an uncooperative integration;
- watch revisions are binding-local and are not Piclaw delivery receipts;
- watches stop on listener failure or buffer overflow and require a fresh binding;
- process adoption quality depends entirely on the injected `ProcessHost` identity and status contract;
- hooks may repeat after a crash and require their own idempotence;
- telemetry, provider-option/cache parity, full usage-ledger parity and installed browser/service behavior were not assessed;
- the experimental API may change without source compatibility.

## Recommendation

### Disposable spike: go

A later, separately approved spike should use only temporary Memory/JSONL state and fake providers. Its scope should be:

1. one ordinary prompt and final answer;
2. parallel safe/unsafe tools with crash/reopen at the durable `started` checkpoint;
3. queued steer/follow-up and exact input-result correlation;
4. abort racing provider/tool completion;
5. context collapse and historical fork;
6. snapshot-first watch reduction into a fake `AgentProjectionSink` DTO;
7. a thin test-only correlation record mapping Piclaw operation ID to Pico conversation/input/task IDs;
8. explicit proof that EF-S01/02/05/07/08 fakes remain authoritative.

The spike must not import existing Piclaw agent-pool/recovery/compaction orchestration. It must not add a production barrel, feature flag, schema, current-loop caller or global package pin.

### Production adoption: no-go

Production adoption requires a later coherent release and new approval after:

- stable API/document alignment;
- SQLite or another queryable durable backend;
- cross-process ownership and replacement fencing;
- selected migration/rollback semantics;
- explicit host drive/supervision compatible with Piclaw service authority;
- PC-001–PC-020 execution and golden replay fixtures;
- projection redaction/receipt integration;
- provider, resource, telemetry, compaction, usage and installed-service parity evidence.

Installed Piclaw remains on Earendil 0.85.1. Stable AgentHarness candidate evidence, Pico3 assessment and any future activation remain separate decisions.
