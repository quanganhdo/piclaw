CREATE TABLE chat_cursors (
      chat_jid            TEXT PRIMARY KEY,
      cursor_ts           TEXT NOT NULL DEFAULT '',
      inflight_prev_ts    TEXT,
      inflight_message_id TEXT,
      inflight_started_at TEXT,
      failed_prev_ts      TEXT,
      failed_ts           TEXT,
      failed_message_id   TEXT,
      failed_thread_root  INTEGER,
      failed_created_at   TEXT
    , queued_followups_json TEXT, preflight_prev_ts TEXT, preflight_message_id TEXT, preflight_started_at TEXT, compaction_failure_count INTEGER, compaction_last_failed_at TEXT, compaction_backoff_until TEXT, compaction_last_error TEXT, compaction_active_started_at TEXT, compaction_active_reason TEXT, auto_compaction_window_ordinal INTEGER, auto_compaction_baseline_tokens INTEGER, auto_compaction_prefill_tokens INTEGER, auto_compaction_success_count INTEGER, auto_compaction_warned_count INTEGER, auto_compaction_updated_at TEXT, operation_id TEXT, operation_source_seq INTEGER, operation_phase TEXT, operation_generation INTEGER, operation_cancel_cause TEXT, operation_cancel_requested_at TEXT, operation_settling_fence_id TEXT, operation_settling_fenced_at TEXT);
CREATE TRIGGER chat_cursors_legacy_owner_exclusion
    BEFORE UPDATE OF cursor_ts, preflight_prev_ts, preflight_message_id, preflight_started_at,
      inflight_prev_ts, inflight_message_id, inflight_started_at,
      failed_prev_ts, failed_ts, failed_message_id, failed_thread_root, failed_created_at,
      compaction_active_started_at, compaction_active_reason
    ON chat_cursors
    WHEN old.operation_id IS NOT NULL AND new.operation_id IS NOT NULL
    BEGIN
      SELECT RAISE(ABORT, 'active operation excludes legacy ownership mutation');
    END;
CREATE TRIGGER chat_cursors_active_owner_delete_exclusion
    BEFORE DELETE ON chat_cursors WHEN old.operation_id IS NOT NULL
    BEGIN
      SELECT RAISE(ABORT, 'active operation excludes cursor deletion');
    END;
