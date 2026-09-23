import type Database from 'bun:sqlite';

export function initializeChatProjects(database: Database): void {
  database.exec(`CREATE TABLE IF NOT EXISTS chat_projects (
    branch_id TEXT PRIMARY KEY REFERENCES chat_branches(branch_id) ON DELETE CASCADE,
    mode TEXT NOT NULL CHECK(mode IN ('set','disabled','inherit')),
    repository_url TEXT,
    revision INTEGER NOT NULL CHECK(revision > 0),
    updated_at TEXT NOT NULL
  );
  CREATE TRIGGER IF NOT EXISTS trg_chat_projects_branch_delete
    AFTER DELETE ON chat_branches BEGIN
      DELETE FROM chat_projects WHERE branch_id = OLD.branch_id;
    END;`);
}
