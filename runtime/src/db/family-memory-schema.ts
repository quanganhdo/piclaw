import type Database from 'bun:sqlite';

/** Explicit publication copies only. Private source references never enter shared projections. */
export function initializeFamilyMemory(database: Database): void {
  database.exec(`CREATE TABLE IF NOT EXISTS family_memory_publications (
    publication_id TEXT PRIMARY KEY,
    owner_user_id TEXT NOT NULL REFERENCES users(id),
    request_id TEXT NOT NULL,
    login_session_id TEXT NOT NULL,
    publisher_username TEXT NOT NULL,
    publisher_display_name TEXT NOT NULL,
    source_chat_jid TEXT NOT NULL,
    source_message_rowid INTEGER NOT NULL,
    source_message_id TEXT NOT NULL,
    source_hash TEXT NOT NULL,
    text TEXT NOT NULL CHECK(length(CAST(text AS BLOB)) BETWEEN 1 AND 16384),
    text_hash TEXT NOT NULL,
    published_at TEXT NOT NULL,
    UNIQUE(owner_user_id,request_id)
  ) STRICT;
  CREATE TABLE IF NOT EXISTS family_memory_withdrawals (
    publication_id TEXT PRIMARY KEY REFERENCES family_memory_publications(publication_id),
    owner_user_id TEXT NOT NULL REFERENCES users(id),
    login_session_id TEXT NOT NULL,
    withdrawn_at TEXT NOT NULL
  ) STRICT;
  CREATE INDEX IF NOT EXISTS family_memory_owner ON family_memory_publications(owner_user_id,published_at,publication_id);
  CREATE INDEX IF NOT EXISTS family_memory_newest ON family_memory_publications(published_at,publication_id);
  CREATE TRIGGER IF NOT EXISTS family_memory_publication_immutable BEFORE UPDATE ON family_memory_publications
    BEGIN SELECT RAISE(ABORT,'Family memory publication is immutable'); END;
  CREATE TRIGGER IF NOT EXISTS family_memory_publication_no_delete BEFORE DELETE ON family_memory_publications
    BEGIN SELECT RAISE(ABORT,'Family memory publication history cannot be deleted'); END;
  CREATE TRIGGER IF NOT EXISTS family_memory_withdrawal_owner BEFORE INSERT ON family_memory_withdrawals
    WHEN NOT EXISTS (SELECT 1 FROM family_memory_publications p WHERE p.publication_id=NEW.publication_id AND p.owner_user_id=NEW.owner_user_id)
    BEGIN SELECT RAISE(ABORT,'Family memory withdrawal requires its publisher'); END;
  CREATE TRIGGER IF NOT EXISTS family_memory_withdrawal_immutable BEFORE UPDATE ON family_memory_withdrawals
    BEGIN SELECT RAISE(ABORT,'Family memory withdrawal is immutable'); END;
  CREATE TRIGGER IF NOT EXISTS family_memory_withdrawal_no_delete BEFORE DELETE ON family_memory_withdrawals
    BEGIN SELECT RAISE(ABORT,'Family memory withdrawal history cannot be deleted'); END;`);
}
