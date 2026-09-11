# Budget limits

Piclaw budget limits are opt-in. A new or upgraded installation has no cap, and unavailable pricing does not stop uncapped work.

## Accounting model

Piclaw records each reported billable invocation once against a durable work ID. Retries, side prompts and delegated work retain their owning task lineage. Scheduled runs receive a fresh run identity while daily and monthly instance spend continues across runs.

API-equivalent USD is an estimate of the token workload at the recorded model route. It is not an invoice, subscription charge or provider credit balance. Input, output, cache-read and cache-write values remain separate; reasoning already included in output is not charged twice. Unknown pricing remains unknown. A zero value is accepted only for a route explicitly reported as free.

Amounts are stored as integer millionths of the native unit. For USD, `1000000` means USD 1.00. Accumulation uses these integers rather than rounded display values.

## Create and inspect caps

Use **Settings → Budget**, `/budget status`, or the read-only `budget_status` tool to inspect limits. The tool cannot approve more spending. Settings and `/budget` read the same durable caps, accounting windows, work state and provider evidence.

The Budget pane is available to the authenticated single-user owner. It shows enabled and disabled caps, current known usage and remaining value, unknown-pricing states, local windows and provider evidence freshness. Provider credential/account references are derived and bound on the server; they are never returned to the browser.

Settings uses authenticated direct budget endpoints rather than forwarding browser requests through slash commands:

```text
GET  /agent/settings/budget?chat_jid=<chat>
POST /agent/settings/budget/action?chat_jid=<chat>
```

Mutations remain disabled in multi-user modes until owner-bound policy controls exist. Existing caps can only be revised or enabled/disabled after explicit confirmation of their current revision. Every change retains current-window spend, prior revisions, accounting and audit history.

The equivalent single-user command forms remain available:

```text
/budget cap set task 2.50 id=task-cap
/budget cap set daily 10 id=daily-cap timezone=Europe/Lisbon
/budget cap set monthly 100 id=monthly-cap timezone=Europe/Lisbon
/budget cap set scheduled 0.50 id=schedule-cap task=<scheduled-task-id>
/budget cap set provider 80 id=codex-5h provider=openai-codex dimension=primary.percent_used metric=percent
/budget cap disable daily-cap
```

Task caps bind to the current active work unless `work=<work-id>` is supplied. Provider account references are derived from the active credential and are never shown in status. Revising an existing cap requires `confirm=true`; it retains the current window and existing spend.

The `schedule_task` and `scheduled_tasks` tools also accept `budget_usd` when creating an agent task. This creates an opt-in per-run cap. **Settings → Scheduled Tasks** is the single UI source of truth for inspecting, setting, revising and disabling that per-run cap; the Budget pane links there instead of duplicating the editor. Shell tasks reject `budget_usd` because Piclaw does not invent model spend for shell execution.

## Pauses and approvals

Interactive work pauses before the next controllable model or tool boundary. Scheduled and background work stops instead of waiting for approval. Piclaw never selects a cheaper model automatically.

For paused work, use Settings → Budget or the equivalent commands:

```text
/budget allow <cap-id> <extra-amount> [expires=<ISO timestamp>]
/budget warnings-only [expires=<ISO timestamp>]
/budget resume
/budget cancel [work-id]
```

An allowance is positive, bound to one work ID, cap revision and window, and expires at its timestamp or when work closes. It cannot resolve unknown pricing or quota evidence. Warnings-only is bound to the active work and its descendants; unrelated chats and independent background runs remain enforced. Completion or cancellation revokes both controls.

Selecting another model uses the normal model control. The existing work ID and spend remain, and every cap is checked again before the next call.

## Windows and provider evidence

Local daily and monthly caps use persisted UTC boundaries calculated from the configured IANA timezone. Local days can therefore be 23 or 25 hours around daylight-saving changes.

Provider guards use provider-native dimensions and reset times. Supported shared-account evidence is:

| Provider | Dimensions |
|---|---|
| Codex | primary/secondary percentage used; credits remaining |
| GitHub Copilot | primary/secondary percentage used |
| OpenRouter | key USD used |
| Z.ai | primary/secondary percentage used |

Evidence must match the active credential/account, configured dimension and unexpired provider window. Stale data retained after a failed refresh is diagnostic only and cannot authorise work. Shared-account usage may include other clients; Piclaw does not infer per-task provider-credit spend from before/after snapshots.

## Persistence and migration

The migration is additive. It adds budget tables and valuation/identity columns without deleting or rewriting existing token-usage rows. First activation of an instance cap includes existing attributable spend in the current window. Every cap create, revision, enablement and disablement appends an immutable `budget_cap_revisions` row; current-window spend, prior windows, decisions and accounting history remain intact.

Paused work, cap/window revisions, accounting identities, allowances, overrides and pending stop notifications are stored in `messages.db`. Restart does not reset counters or extend expiry. Cancellation closes permission records but retains charges.

## Enforcement limits

Enforcement is best effort at boundaries Piclaw controls. Calls already in flight can overshoot, and concurrent callers can both pass admission before either reports usage. Piclaw records each eventual charge and blocks at the next boundary; v1 has no reservations or reserved-balance field.

Internal compaction and branch-summary usage is charged when the SDK reports it. Where an SDK or external add-on exposes no pre-call hook, Piclaw can enforce only at the enclosing boundary and after reported usage. Remote peers and independent processes are not governed by a fleet-wide authority.

Persistence, Settings reads, status delivery and safe cleanup do not require another paid model call. The Budget pane loads on demand and adds no startup provider request. Provider-side authentication, rate limits and quota remain authoritative even in warnings-only mode.

After an allowance, warnings-only override or explicit resume, Settings reports that the work is ready but does not synthesize a prompt: send a continuation message in the owning chat. This preserves the durable work identity and rechecks every cap before the next model call.

## Verification matrix

| IDs | Evidence |
|---|---|
| A01–A03 | `runtime/test/budget/budget-policy.test.ts`: uncapped unknown pricing, independent dollar and quota checks |
| A04–A05 | `runtime/test/budget/budget-accounting.test.ts`: work lineage and idempotent usage events |
| A06–A07 | `runtime/test/budget/budget-accounting.test.ts`: category valuation, reasoning exclusion, free/unknown/fallback provenance |
| A08–A10 | `runtime/test/budget/budget-policy.test.ts`, `budget-admission-status.test.ts`: complete blockers, persisted pause and bounded allowance |
| A11 | Existing model-switch persistence tests plus model-call admission recheck in `run-agent-orchestrator.ts` |
| A12–A15 | Budget policy/admission tests and `runtime/test/extensions/extensions-scheduled-tasks.test.ts` |
| A16–A18 | Budget policy and provider-usage tests: provider resets, DST, stale/wrong-account/expired evidence |
| A19–A20 | Persisted allowance/work fixtures, replay idempotency and concurrent-overshoot policy test |
| A21–A22 | Usage and admission/status tests: compaction/summary identities and stable-prefix invariance |
| A23–A24 | Budget policy tests: legacy current-window spend, revisions and capability validation |
| A25–A26 | Read-only status/authorised command tests and deterministic background-stop notification identity |
