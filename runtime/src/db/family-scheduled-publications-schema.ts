import type Database from "bun:sqlite";

export function initializeFamilyScheduledPublications(database: Database): void {
  database.exec(`CREATE TABLE IF NOT EXISTS family_scheduled_publications (
    execution_id TEXT PRIMARY KEY REFERENCES family_scheduled_results(execution_id),
    owner_user_id TEXT NOT NULL REFERENCES users(id),
    login_session_id TEXT NOT NULL,
    message_rowid INTEGER NOT NULL,
    message_id TEXT NOT NULL UNIQUE,
    chat_jid TEXT NOT NULL,
    content_hash TEXT NOT NULL,
    published_at TEXT NOT NULL
  ) STRICT;
  CREATE TRIGGER IF NOT EXISTS family_scheduled_publication_immutable BEFORE UPDATE ON family_scheduled_publications
    BEGIN SELECT RAISE(ABORT,'Scheduled publication is immutable'); END;
  CREATE TRIGGER IF NOT EXISTS family_scheduled_publication_no_delete BEFORE DELETE ON family_scheduled_publications
    BEGIN SELECT RAISE(ABORT,'Scheduled publication history cannot be deleted'); END;`);
}
