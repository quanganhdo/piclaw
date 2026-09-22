---
name: schedule
description: Schedule a task to run later or on a recurring basis. Prefer the scheduled_tasks tool; use the schedule_task compatibility alias or IPC fallback only if needed.
distribution: public
---

# Schedule a Task

Prefer the built-in scheduling tool.

## Preferred method

Use `scheduled_tasks` with `action: "create"`.

Example:

```text
scheduled_tasks({
  action: "create",
  chat_jid: "web:default",
  schedule_type: "once",
  schedule_value: "2026-03-09T09:00:00Z",
  task_kind: "agent",
  prompt: "Post a reminder to review the deployment"
})
```

Compatibility note: `schedule_task(...)` is the older alias if the structured tool is unavailable.

## Budget policy

- Omit `budget_usd` for no task-specific cap. With no applicable enabled budgets, the task can run without a positive cap, special unbudgeted flag, pricing/quota evidence or budget approval.
- A positive cap applies independently to each run. Use at most six decimal places in USD; instance/provider limits still apply.
- Zero is a blocking cap, not unbudgeted. Creation requires deliberate `confirm_zero_budget: true`; otherwise no task is created. Never supply zero as a default.
- Read `schedule_accepted` and `budget_readiness` separately. Report known blockers and next steps as well as the next-run timestamp. `check_at_run` means an inherited model/provider is unresolved for this advisory check.
- Never invent a cap, allowance or override. Ordinary task/model/authority checks still apply. A later budget stop is recorded and reported to the task chat without another model run.

## Key fields

- `schedule_type`: `once` | `cron` | `interval`
- `schedule_value`:
  - `once`: ISO timestamp (UTC recommended)
  - `cron`: cron expression
  - `interval`: milliseconds
- `task_kind`: `agent` or `shell`
- `prompt` for agent tasks
- `command` for shell tasks
- optional `cwd`, `timeout_sec`, `model`

## IPC fallback

If tool access is unavailable, write an IPC JSON file to `$PICLAW_DATA/ipc/tasks/`:

```bash
cat > "$PICLAW_DATA/ipc/tasks/schedule_$(date +%s)_$$.json" <<EOF
{
  "type": "schedule_task",
  "chatJid": "$PICLAW_CHAT_JID",
  "task_kind": "agent",
  "prompt": "Describe what should happen when this task fires",
  "schedule_type": "once",
  "schedule_value": "2026-03-09T09:00:00Z"
}
EOF
```

For a shell task, keep the same envelope and change only the task-specific fields:

```json
{
  "task_kind": "shell",
  "command": "ls -la /workspace",
  "cwd": ".",
  "timeout_sec": 30,
  "schedule_type": "interval",
  "schedule_value": "3600000"
}
```

## Verify it was scheduled

```sql
SELECT id, chat_jid, task_kind, schedule_type, schedule_value, status, next_run
FROM scheduled_tasks
ORDER BY created_at DESC
LIMIT 5;
```

Execution history:

```sql
SELECT task_id, run_at, duration_ms, status
FROM task_run_logs
ORDER BY id DESC
LIMIT 10;
```

## Response requirements

After creating a schedule, respond with:

- task ID
- schedule type
- schedule value
- next run time in human-readable local time, if available

## Notes

- Shell tasks are pre-validated: no newlines, no destructive patterns, and `cwd` must stay inside `/workspace`.
- Use UTC for human-facing schedules unless the user asked for another timezone.

## Environment

- `PICLAW_DATA` — piclaw data directory (contains `ipc/`, `sessions/`)
- `PICLAW_CHAT_JID` — JID of the triggering chat
