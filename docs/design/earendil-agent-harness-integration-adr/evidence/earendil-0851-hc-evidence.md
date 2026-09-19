# Earendil 0.85.1 inactive Harness evidence

Evidence date: 18 September 2026. Selected release: `0.85.1`, release commit `d981de1229ef899957bbe968bc8dcda02a21f477`.

## Result

The selected-release catalogue now contains all **HC-001–HC-025** rows:

- **24 partial**;
- **1 unsupported** (`HC-024`);
- **0 full passes**;
- **0 production activation**.

Partial means the named public sub-boundary executed successfully. It does not satisfy the complete requirement. The manifest records the unproved remainder for every row.

## New deterministic evidence

The broader inactive suite adds public-only cases for:

- manual compaction plus unsummarized navigation result/entry/event behavior (`HC-010`);
- retry wait, public reattachment, captured policy and one later attempt (`HC-011`);
- deferred suspension/reopen and unavailable-model in-band failure (`HC-012`);
- accepted-operation restore and idempotent settled observation (`HC-013`);
- one deferred poll per resume across two reopens and exact deferred cancellation (`HC-020`);
- abort-first and admission-first cancellation ordering (`HC-021`);
- tool process-loss after awaited memos and a durable output checkpoint, with unknown-outcome replay/containment (`HC-022`);
- ordinary public lane-event reducer fold equivalence (`HC-018`);
- same-operation Drive observer joining (`HC-023`).

A closed test-only catalogue maps every selected manifest row and status to exact executing test names. The compatibility suite rejects missing links, status drift and unsupported-as-pass promotion.

## Existing evidence retained

PR B's existing selected-release tests remain unchanged evidence for:

- prompt admission/result and tool execution (`HC-001–HC-003`);
- JSONL safe/never process-loss replay (`HC-004/005`);
- lane queues and exact abort (`HC-006–HC-009`);
- corruption, lane isolation, close, direct drive, lane watch and usage (`HC-014–HC-019`);
- 17 Memory and 15 JSONL public `SessionRepo` cases.

Historical 0.84 negative compiler checks, fingerprints and 25 `HarnessNotImplemented` receipts remain separate and unchanged.

## Unsupported and unproved boundaries

### HC-024

Downstream open-operation storage-migration fault injection is unsupported. Published 0.85.1 exports the `Storage` type and `createStorageConformance()`, but no built-in `MemoryStorage`/`JsonlStorage` constructor or public fixture factory. Private session fields, deep imports, copied implementations and declaration tricks remain forbidden.

### HC-025

Memory and JSONL public repository cases pass. Raw Storage, SQLite, streaming-fork parity and host-process ownership remain unproved, so the row is partial.

### Session watch

`AgentHarness.watchSession()` advertises `Promise<WatchHandle<SessionSnapshot>>`, while the selected runtime declaration is `Promise<never>` and its implementation throws `SliceNotImplemented`. The suite uses lane watch only. Session watch and production Harness activation remain blocked.

### Other incomplete areas

The suite does not exhaust:

- threshold/overflow/declined compaction and every structural crash boundary;
- retry exhaustion, abort during delay and all structural retry variants;
- every provider/tool/hook/timer `Gate.admit()` site;
- provider and structural unknown-effect recovery;
- deferred cancellation and unknown-poll process loss;
- all corruption variants or exact internal read counts;
- cross-process writable host ownership;
- PC-001–PC-020 service-plane integration or the 26 golden regression fixtures.

## Non-interference

The new implementation is test-only except for selected manifest data. Repository AST and module-graph tests continue to prove:

- no production importer of the latent compatibility directory;
- no barrel, registration or activation flag;
- no `AgentHarness.create()` or `watchSession()` production caller;
- no private/deep Earendil import;
- no transfer of `ServiceWorkStore`, `TerminalSettlementStore`, `ServiceOutboxStore`, `ScheduledRunStore` or `AgentProjectionSink` authority.
