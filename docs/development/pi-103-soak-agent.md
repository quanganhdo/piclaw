# Pi 1.0.3 bounded retention and scheduler-agent qualification

Six 60-second history soaks and three scheduler runs exercise longer natural reclamation, varied history shapes and actual AgentPool/SDK execution on Smith Linux with Bun 1.4.2. The [measurement receipt](receipts/pi-103-soak-agent.json) records source identities, fixture/log hashes, profiles and retained failures. Production Delegate, external provider behaviour, live accounts and rollout are unqualified.

Base: `80ec14fff50b01708892880c7309ccfb544b9929`. Runtime source, dependency pins and database schema are unchanged. All files and databases are isolated synthetic state; scheduler responses come from a native deterministic zero-cost provider without credentials. The series uses a clean environment allowlist, `--no-env-file` and the low-priority filesystem-isolation launcher. No installation or restart occurred.

## History shapes and retained controls

Each shape has one plain and one whole-child CPU-profile run. Three SessionManager controls stay strongly referenced. Each work cycle opens, validates and drops three more managers, then waits up to one second. Every selected context message has its exact payload and order checked; tool-call/result IDs and pairing are checked too. Cadence includes work time and supplies no fixed throughput guarantee.

| Shape | Stored entries | Selected context messages | Dropped managers/run | Observed natural finalizations | Event-loop maximum, ms |
| --- | --- | --- | --- | --- | --- |
| Linear | 5,000 | 5,000 | 174 | 171, 171 | 74.0, 76.1 |
| Ten independent branch chains | 5,000 | 500 in the latest chain | 174 | 174, 173 | 48.6, 47.2 |
| User/tool-call/tool-result triples | 4,998 | 4,998 | 174 | 172, 171 | 100.9, 96.8 |

Windows lasted 60,000.6–60,069.9 ms. No explicit GC call is made by the fixture. The reported zero is a static declaration; SDK/engine GC entrypoints are not instrumented. At the final boundary, no held control appears in the finalizer IDs and all held histories remain usable. End-of-window process heaps span about 32–65 MB. They include runtime/code, histories and fixture telemetry; manager-specific retained bytes were not measured.

The callbacks establish observed natural reclamation in these bounded workloads. Missing or delayed callbacks do not prove leaks. Observed reclamation does not prove leak absence. CPU/event-loop samples cannot attribute every stall to GC. Reported CPU deltas exclude setup; whole-child profiles include fixture setup and cleanup. Longer soaks, other architectures/runtimes, broader allocation distributions and concurrent live work are separate scope.

## Actual scheduler and session restoration

The fixture constructs the actual AgentPool with `createSessionInDir`, the public ModelRuntime/native Provider and Pi SDK session. It first runs a baseline conversation, then creates a due interval task and starts the real scheduler and AgentQueue. The provider emits deterministic assistant messages; `runAgent`, session persistence and tree navigation are not stubbed.

Each run verifies:

- exactly two provider calls: baseline and scheduled;
- one observed outbound result in a delivery sink;
- the live pooled session returns to its original non-null leaf;
- the scheduled prompt stays in full entries and is absent from the active branch;
- SDK reopen finds the scheduled prompt and the same entry count;
- occurrence completion, consumed source and terminal operation are joined by durable identifiers;
- the successor is exactly `settled_at + 1 hour`;
- database integrity and zero network/child-process attempts under the offline guard.

The three fixture windows take 1,326.8–1,758.2 ms. Event-loop maxima are 75.0, 101.8 and 490.2 ms; the large observation is retained. The public session tree grows from five to seven entries. SDK reopen checks prompt presence and count only. It does not establish a complete persisted topology, assistant-response persistence or restored leaf selection after reopen. Real external delivery, live provider/authentication, raw cleanup settlement and account-generation authority remain untested.

Three scheduler rows retain launch head `943e1e0b98b87c225afdf19ecb8a89d3689e153c`. The corrected history rows use `ba4da661c95f8a3556e7ed242f00ea544b946a8b`. The scheduler fixture and its imported runtime/scripts/extensions/helper/guard/dependency paths have no diff between those heads. Each run records before/after source snapshots; the top-level binding covers the corrected-soak invocation only. The generator verifies the expected run set, raw-log/result equality, committed fixture hashes, source snapshots and scheduler/soak assertions. The aggregate does not claim one source head for every process.

## Retained corrections and acceptance scope

The first scheduler smoke failed because its synthetic configuration file was not private mode 0600; the corrected fixture passes the same MCP ownership check. A broad independent review timed out and supplies no approval. Narrow reviews qualified the real scheduler path and then found/corrected history proof gaps: length-only branch checks, the final held-reference observation, cadence wording and CPU boundaries. Six preliminary soaks remain preserved locally and excluded from corrected qualification. The three unaffected scheduler measurements were retained after verifying fixture-byte identity.

Historical fixture smoke passes four tests / 18 assertions with a retained log hash, without an execution-time source attestation. The [final qualification receipt](receipts/pi-103-soak-agent-qualification.json) binds frozen head `654600355caa9a560852f6aeb9e6d3c2317a2b45`, tree `1f8bc756eb2a4305c22748846255f5362220a530`, clean before/after every gate. Types, scoped lint and diff checks pass; 95 unchanged compose diagnostics are retained. Focused qualification passes 45 tests / 2,659 assertions. The full gate passes 6,531 tests / eight existing skips / zero failures / 42,751 assertions in 656.8 s, plus 25 feature and nine web tests. Actual descendant CPU/RSS/niceness samples are coarse observations; the test process runs at nice 10. The final receipt is a documentation-only overlay, with unchanged runtime/tests/scripts/dependencies and a regenerated environment catalog checked separately before publication. The prior PR1560/1561 hosted stale-catalog failure is historical evidence, not a passing hosted result.

This extends the [earlier deeper workload audit](pi-103-deeper-performance.md). It closes the bounded deterministic scheduler-agent and 60-second history-shape test scope. Whole-system performance, multi-hour/cross-platform retention, real provider/account canary and production Delegate activation need further evidence. Public raw provider/auth settlement and account-generation contracts are unavailable; deployment, restart, live calls, soak/stop rules and rollback need separate approval.
