# Add-on operation foundation validation

Validated 17 September 2026 on Bun 1.4.1/Linux in the isolated `feat/addon-operations` worktree, initially based on `ad922bdaa`, then merged with `a1a8bdcac` (Earendil 0.85.1) for the final review. No credentials, live runtime configuration, production services or model providers were used.

| Gate | Result |
|---|---|
| Runtime/scripts/settings/pane typechecks | Passed |
| Focused operation, orchestration, resource, startup and add-on regression suite | 140 passed, 3 existing skips |
| Actual SDK session construction | Passed: fixed prompt, only granted `read`, no ambient extension factories/context |
| Two-process SQLite restart fixture | Passed: uncertain active work is not replayed; duplicate admission recovers same ID |
| Complete `make ci-fast` rerun | Passed: 5,382 runtime tests, 4 skips; 25 feature checks; 9 build tests |
| Environment inventory, circular dependencies, entrypoint preloads, silent catches, pack hygiene, whitespace | Passed |
| New operation modules and tests lint | Passed |

The final review also fixes input replay: a continuation submits only the new input while preserving cumulative byte limits, and a budget-blocked model boundary marks input already committed to the SDK session. Resume uses a bounded continuation instruction instead of repeating the prior request. Targeted tests verify both behaviours; full CI passes on Earendil 0.85.1.

The first fast-CI run had a pre-existing token-usage migration subprocess exceed its five-second timeout; its focused rerun and the complete gate rerun passed. Changed-file lint also reports two pre-existing diagnostics in untouched lines of the modified orchestrator/recovery files (`no-unused-vars` catch parameter and `no-useless-assignment`). Their bytes match the base; no unrelated cleanup is included.

## Executable evidence

- `runtime/test/addons/operation-service.test.ts`: concurrent idempotency, scoped receipts/results, budget linkage, wrong-principal rejection, truthful cancellation/terminal immutability, output redaction, unknown-execution reconciliation and retention.
- `runtime/test/addons/operation-lifecycle.test.ts`: caller list pagination, snapshot/event subscription, disconnect-independent persistence, revocation, continuation, budget resume, replay bounds and concurrent active quota.
- `runtime/test/addons/operation-host.test.ts`: disabled configuration, strict grants, host-enforced target/principal, operation-owned execution IDs, tool/model/budget options, startup-owned ABI registration.
- `runtime/test/addons/operation-restart.test.ts`: real file-backed database used across separate processes; no in-memory substitute for the restart check.
- `runtime/test/agent-pool/operation-session-profile.test.ts`: actual resource loader and SDK session reject ambient instructions/skills/extensions and expose only approved built-ins.
- `runtime/test/agent-pool/run-operation-boundary.test.ts`: every model request rechecks live host admission and budgets, with owner restoration and abort handling.
- Existing tool-ceiling/attempt-budget/orchestrator tests extended for mandatory controls, revocation, parallel hard-cap admission, exact caller abort ownership and pre-aborted no-hydration.

## Scope and remaining work

The core exports protocol-neutral admission, status, results, list/event subscription, cancel and continuation. It stores bounded public final text; it does not expose private attachment paths or hidden reasoning. A2A message/part/artifact conversion and independently authenticated retrieval remain add-on work. Subscriptions poll durable state at 100 ms and require the caller's AbortSignal for prompt idle cleanup. This is single-process operation ownership, not distributed leasing.

Grants are operator-configured capabilities. Tool allowlisting does not sandbox filesystem/process access; text-only is the initial safe profile. Actual model/tool execution is provider-free in these tests. The separately recorded A2A deployment canary on 18 September exercised this packaged core through actual HTTP, operations, AgentPool and a loopback-only deterministic model; dedup, cancel, crash/restart and persisted results passed. VM900 was restored stopped; Smith production was not changed. The add-on PR includes the detailed receipt and actual-host captures.
