# Storage model

`piclaw` stores state in SQLite at `/workspace/.piclaw/store/messages.db`. The database is the source of truth for chat history, media, tasks, and token usage.

**Never delete this file.** Only repair or migrate it.

## Key tables

| Table | Purpose |
|-------|---------|
| `chats` | Known chat JIDs and metadata |
| `messages` | Message history |
| `messages_fts` | Full‑text search index |
| `media` | Attachment blobs |
| `message_media` | Message ↔ media join |
| `scheduled_tasks` | Task definitions |
| `task_run_logs` | Task run history |
| `token_usage` | Per‑assistant‑message token + cost usage (includes model/provider/api for per‑model tracking) |
| `tool_outputs` | Stored tool output summaries |
| `tool_outputs_fts` | Full‑text index for tool output |
| `workspace_files` | Indexed workspace files (path, size, mtime) |
| `workspace_fts` | Full‑text index for workspace content |
| `chat_cursors` | Per‑chat cursor + inflight/failed run tracking + deferred follow‑up queue |
| `router_state` | Misc router state (auto‑compaction + web status) |
| `keychain_entries` | Encrypted secrets for tool env injection |
| `webauthn_credentials` | Stored passkeys (credential public keys + counters) |
| `webauthn_enrollments` | One‑time enrolment tokens for passkey registration |
| `web_sessions` | Persistent web UI sessions (TOTP + passkey logins) |
| `chat_branches` | Branch/session registry for parallel web chat sessions |
| `remote_peers` | Cross-instance interop peer registry |
| `remote_pair_requests` | Pending pairing requests for cross-instance interop |
| `remote_requests` | Tracked cross-instance request state |
| `remote_audit_logs` | Audit trail for cross-instance operations |

Attachment binaries and metadata live in `media`, with message links in `message_media`. Message records use `content_blocks` for structured file/image metadata, Adaptive Cards, and `adaptive_card_submission` receipts; `link_previews` stores preview JSON separately. Token usage rows include `model`, `provider`, and `api` for per-model tracking.

The browser keeps local UI memory that should not become shared backend state out of SQLite. That includes dismissal and seen state for the context compaction affordance. The backend decides whether the underlying context condition currently applies; the browser stores only lightweight local UI state.

## Entity map

```mermaid
erDiagram
  CHATS ||--o{ MESSAGES : contains
  CHATS ||--o{ TOKEN_USAGE : tracks
  CHATS ||--|| CHAT_CURSORS : tracks
  MESSAGES ||--o{ MESSAGE_MEDIA : has
  MEDIA ||--o{ MESSAGE_MEDIA : linked
  SCHEDULED_TASKS ||--o{ TASK_RUN_LOGS : logs
  MESSAGES ||--|| MESSAGES_FTS : indexes
  TOOL_OUTPUTS ||--|| TOOL_OUTPUTS_FTS : indexes
  WORKSPACE_FILES ||--|| WORKSPACE_FTS : indexes

  CHATS {
    text jid
    text name
    text last_message_time
  }
  MESSAGES {
    text id
    text chat_jid
    text sender
    text sender_name
    text content
    text content_blocks
    text link_previews
    text timestamp
    int is_from_me
    int is_bot_message
  }
  MESSAGES_FTS {
    text content
    text chat_jid
    text sender
    text sender_name
    text timestamp
    int is_bot_message
  }
  MESSAGE_MEDIA {
    int message_rowid
    int media_id
  }
  MEDIA {
    int id
    text filename
    text content_type
    blob data
    blob thumbnail
    text metadata
    text created_at
  }
  SCHEDULED_TASKS {
    text id
    text chat_jid
    text prompt
    text model
    text schedule_type
    text schedule_value
    text next_run
    text last_run
    text last_result
    text status
    text created_at
  }
  TASK_RUN_LOGS {
    int id
    text task_id
    text run_at
    int duration_ms
    text status
    text result
    text error
  }
  TOKEN_USAGE {
    int id
    text chat_jid
    text run_at
    int input_tokens
    int output_tokens
    int cache_read_tokens
    int cache_write_tokens
    int cache_read_reported
    int cache_write_reported
    int total_tokens
    real cost_input
    real cost_output
    real cost_cache_read
    real cost_cache_write
    real cost_total
    real provider_cost_total
    real catalogue_cost_total
    text cost_provenance
    text model
    text provider
    text api
    int turns
  }
  CHAT_CURSORS {
    text chat_jid
    text cursor_ts
    text inflight_prev_ts
    text inflight_message_id
    text inflight_started_at
    text failed_prev_ts
    text failed_ts
    text failed_message_id
    int failed_thread_root
    text failed_created_at
    text queued_followups_json
  }
  TOOL_OUTPUTS {
    text id
    text created_at
    text source
    int size_bytes
    int line_count
    text summary
    text path
  }
  TOOL_OUTPUTS_FTS {
    text content
    text output_id
  }
  WORKSPACE_FILES {
    text path
    int mtime_ms
    int size_bytes
    text indexed_at
  }
  WORKSPACE_FTS {
    text content
    text path
    int mtime_ms
    int size_bytes
  }
  ROUTER_STATE {
    text key
    text value
  }
  KEYCHAIN_ENTRIES {
    int id
    text name
    text type
    blob ciphertext
    blob nonce
    blob salt
    text kdf
    int kdf_iterations
    text created_at
    text updated_at
  }
  WEBAUTHN_CREDENTIALS {
    int id
    text user_id
    text rp_id
    text credential_id
    text public_key
    int sign_count
    text transports
    text created_at
    text last_used_at
  }
  WEBAUTHN_ENROLLMENTS {
    text token
    text user_id
    text created_at
    text expires_at
  }
  WEB_SESSIONS {
    text token
    text user_id
    text auth_method
    text created_at
    text expires_at
  }
```

## Token usage

`token_usage` stores per-assistant-message usage and cost tracking:

- `run_at` is the timestamp for the tool run (ISO 8601).
- Token counts are stored in `input_tokens`, `output_tokens`, `cache_read_tokens`, `cache_write_tokens`, and `total_tokens`.
- `cache_read_reported` and `cache_write_reported` preserve whether the provider explicitly sent each cache field. `1` includes an explicit zero, `0` means the field was omitted, and `NULL` marks a legacy or unknown state.
- `provider_cost_total` stores the provider's request charge. `catalogue_cost_total` stores Piclaw's price-catalogue calculation. `cost_total` selects the provider value when available.
- `cost_provenance` is `provider_reported`, `catalogue_estimate`, or `unavailable`. Legacy rows retain `NULL`.
- `model`, `response_model`, `provider`, and `api` identify the requested and concrete response models.

## Indexes

- `messages(timestamp)` for chronological queries
- `messages(chat_jid)` for timeline paging
- `messages(chat_jid, timestamp)` for per-chat time windows
- `messages(chat_jid, is_bot_message, timestamp)` for pollers and ingestion
- `token_usage(chat_jid)`, `token_usage(run_at)`, and `token_usage(chat_jid, run_at)` for usage summaries
- `chats(last_message_time)` for recent chat ordering
- `scheduled_tasks(next_run)`, `scheduled_tasks(status)`, `scheduled_tasks(created_at)`, and `scheduled_tasks(last_run)` for the scheduler
- `task_run_logs(task_id, run_at)` for audit history
- `tool_outputs(created_at)` for recent tool output
- `media(created_at)` for attachment timelines
- `message_media(message_rowid)` and `message_media(media_id)` for joins
- `messages_fts`, `tool_outputs_fts`, and `workspace_fts` for full-text search
- `keychain_entries(type)` for keychain lookups
- `webauthn_credentials(user_id)` and `webauthn_credentials(rp_id)` for passkey queries
- `webauthn_enrollments(expires_at)` for enrolment cleanup
- `web_sessions(expires_at)` for session cleanup

## Data paths

- `/workspace/.piclaw/store/messages.db` — SQLite database
- `/workspace/.piclaw/data/sessions/` — `pi` session JSONL history
- `/workspace/.piclaw/data/ipc/` — IPC messages and scheduled task files
- `/workspace/.piclaw/data/chats.json` — Known chat JIDs

## Backups

Restic snapshots are stored in the configured repository. The backup script lives at:

```
/workspace/.piclaw/restic/backup.sh
```

The container image ships a pinned official `restic` binary with Azure backend support. The pinned version is tracked in the repo root at:

```
RESTIC_VERSION
```
