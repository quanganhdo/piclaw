# Scheduled-task budget readiness (#1350)

Base: `0ea661493ef46cf24d5b03dbaa641a434e28a237`.

The candidate preserves opt-in budgets and makes task acceptance, budget readiness and blocked-run delivery distinct. No applicable enabled caps plus an omitted task cap permits execution without a synthetic allowance, positive cap or budget approval. No model/pricing/quota evidence is required by that uncapped budget path. Task/model/authority checks still apply.

## Fixes

1. Both `scheduled_tasks` and `schedule_task` share exact microdollar parsing. Unsupported precision is rejected before creating a task; small positive values cannot silently round to zero.
2. Explicit zero requires `confirm_zero_budget: true`. Without it creation returns a concrete explanation and creates nothing. Existing zero caps retain their meaning. Both Settings skins require one deliberate confirmation, and cancel writes nothing.
3. Creation returns `schedule_accepted` plus `budget_readiness`. Inspection and Settings show the same current check, modes, blockers and next steps. Omitted, disabled, zero and positive caps remain distinct.
4. Readiness reuses the evaluator for a fresh scheduled occurrence. It makes no provider calls and writes no work, window, decision, allowance or override rows. Unknown inherited providers produce `check_at_run`; explicit provider guards use matching-account cached evidence, with no account fingerprints exposed.
5. Creation and web mutation receipts are projected inside their immediate transaction. Injected inspection failures roll back task/cap/revision changes so a failure does not hide a committed schedule behind a retry invitation. This does not introduce exactly-once request creation after a lost network response.
6. Scheduled budget stops enter normal error run history before delivery. Pending decision rows retain the run's task/chat binding; notices go to that originating chat without an agent run or task replay.
7. The existing scheduler poll retries a bounded batch of pending notices. A rotating cursor prevents a failing first batch from starving later rows, and concurrent local drains share one actual in-flight attempt.
8. Notification authority/database checks run before and after sends. Timeline notices exclude prompts, raw provider errors and credentials. `muted`/`notify=false` for successful-output nudges do not hide a budget-failure timeline notice. No failure Pushover nudge is added.
9. Scheduling guidance explains no-cap execution, exact amounts, zero acknowledgement and advisory readiness. The existing Settings endpoint edits task caps/lifecycle; this PR adds no separate web task-creation API.

## Semantics and limits

Budget readiness is advisory at `checked_at`; actual admission reevaluates current budgets and model routing. A positive task cap never bypasses an exhausted instance/provider limit. Recurring invocations get fresh work identities while shared instance spend persists. Task-scoped interactive allowances/overrides are not inherited by scheduled readiness.

Notice delivery is at-least-once: confirmed send precedes the durable delivered marker. Lost acknowledgement or a failed marker can cause a duplicate notice; retries do not rerun the task or add another execution receipt. No exactly-once transport guarantee is claimed.

The scheduler waits at most five seconds on a notice drain, using an unref'd one-shot timer. A non-cancellable transport that never settles retains the actual drain lock until recovery/restart. That can delay other notices, but it cannot indefinitely block task completion or normal polling; dropping the lock would risk overlapping uncertain sends. The caller wait absorbs bounded internal delivery errors so notification failure cannot undo or misclassify the recorded task outcome.

## Validation

- Final focused backend group: **86 pass / 0 fail / 511 assertions** across eight existing/new suites.
- Both-skin Chromium/WebKit Settings matrix: **28 pass / 0 fail / 328 assertions**, including 390px layout, visible readiness, one zero confirmation, cancel/no-write, positive create/edit and disabled-cap payloads.
- New readiness coverage includes both aliases, no-cap creation without budget rows, SQLite serialise/reopen, durable due dispatch, fresh recurring runs, disabled/unrelated caps, precision/zero handling, account-bound provider evidence and transaction rollback.
- Notification coverage includes originating chat, log-before-send, send-fail → poll retry without paid work/replay, deleted task, muted success-nudge policy, overlapping drains, authority changes, bounded failed-head fairness, stuck sends and per-row read failures.
- Full final `make ci-fast`: **5,436 runtime pass / 4 skip / 0 fail**, **25 feature tests**, **9 build tests**.
- All repository typechecks pass. Targeted lint, environment inventory, pack hygiene, local-test entrypoints, circular dependencies, silent-catch, structured-logging and diff checks pass.
- The first broad gate found two integration failures: missing trace protection for the new confirmation field and an existing UI wording contract. Both were corrected without changing the tests; the final full gate passed.

## Review

Bounded independent source review found and resolved:

- cached provider evidence selected a newer foreign-account row;
- a post-commit advisory failure could hide successful task/cap creation;
- internal notification drain errors could reject the caller despite its bounded-wait contract.

The reviewer cleared the corrected source hold. Focused fault regressions cover each correction. Browser and scheduler tests use isolated fixtures/fake model boundaries; no production tasks, credentials, live providers, installation or restart were used.
