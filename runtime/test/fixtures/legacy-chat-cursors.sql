-- Frozen source: 781638a545b638588caab3e666e52774e081c522 connection.ts plus its four legacy ALTERs.
CREATE TABLE IF NOT EXISTS chat_cursors (
      chat_jid             TEXT PRIMARY KEY,
      cursor_ts            TEXT NOT NULL DEFAULT '',
      preflight_prev_ts    TEXT,
      preflight_message_id TEXT,
      preflight_started_at TEXT,
      inflight_prev_ts     TEXT,
      inflight_message_id  TEXT,
      inflight_started_at  TEXT,
      failed_prev_ts       TEXT,
      failed_ts            TEXT,
      failed_message_id    TEXT,
      failed_thread_root   INTEGER,
      failed_created_at    TEXT,
      queued_followups_json TEXT,
      compaction_active_started_at TEXT,
      compaction_active_reason TEXT,
      auto_compaction_window_ordinal INTEGER,
      auto_compaction_baseline_tokens INTEGER,
      auto_compaction_prefill_tokens INTEGER,
      auto_compaction_success_count INTEGER,
      auto_compaction_warned_count INTEGER,
      auto_compaction_updated_at TEXT
    );
ALTER TABLE chat_cursors ADD COLUMN compaction_failure_count INTEGER;
ALTER TABLE chat_cursors ADD COLUMN compaction_last_failed_at TEXT;
ALTER TABLE chat_cursors ADD COLUMN compaction_backoff_until TEXT;
ALTER TABLE chat_cursors ADD COLUMN compaction_last_error TEXT;
