import type Database from 'bun:sqlite';

/** Separate shared-family index; never imports or deletes legacy single-user rows. */
export function initializeFamilyWorkspaceIndex(database:Database):void {
  database.exec(`CREATE TABLE IF NOT EXISTS family_workspace_files (
    path TEXT PRIMARY KEY,mtime_ms INTEGER NOT NULL,size_bytes INTEGER NOT NULL,indexed_at TEXT NOT NULL
  ) STRICT;
  CREATE VIRTUAL TABLE IF NOT EXISTS family_workspace_fts USING fts5(content,path UNINDEXED,mtime_ms UNINDEXED,size_bytes UNINDEXED);
  CREATE TABLE IF NOT EXISTS family_workspace_index_status (
    scope TEXT PRIMARY KEY,state TEXT NOT NULL,last_indexed_at TEXT,indexed_file_count INTEGER NOT NULL,updated_at TEXT NOT NULL
  ) STRICT;
  CREATE TABLE IF NOT EXISTS family_workspace_index_generation (
    id INTEGER PRIMARY KEY CHECK(id=1), revision INTEGER NOT NULL CHECK(revision>=0)
  ) STRICT;
  INSERT OR IGNORE INTO family_workspace_index_generation VALUES (1,0);`);
}
