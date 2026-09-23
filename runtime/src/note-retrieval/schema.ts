import type { Database } from 'bun:sqlite';
import { applyOwnedMigrations } from '../db/migrations.js';
export const NOTE_INDEX_FORMAT = 'nr1';
export function ensureNoteSchema(db: Database): void {
  applyOwnedMigrations(db, [{ owner: 'note-retrieval', id: '001-versioned-chunks', order: 1, sql: `
    CREATE TABLE note_retrieval_state (
      id INTEGER PRIMARY KEY CHECK(id=1), namespace TEXT, binding TEXT, format TEXT,
      published INTEGER, staging INTEGER, sequence INTEGER NOT NULL DEFAULT 0,
      dirty INTEGER NOT NULL DEFAULT 0, coverage INTEGER NOT NULL DEFAULT 0,
      state TEXT NOT NULL DEFAULT 'never_indexed', last_complete INTEGER,
      reason TEXT, exclusions INTEGER NOT NULL DEFAULT 0, writer_pid INTEGER
    );
    INSERT INTO note_retrieval_state(id) VALUES(1);
    CREATE TABLE note_retrieval_sources (
      generation INTEGER NOT NULL, path TEXT NOT NULL, revision TEXT NOT NULL,
      bytes INTEGER NOT NULL, validated_at INTEGER NOT NULL, dirty INTEGER NOT NULL,
      PRIMARY KEY(generation,path)
    );
    CREATE TABLE note_retrieval_chunks (
      row_id INTEGER PRIMARY KEY, generation INTEGER NOT NULL, path TEXT NOT NULL,
      chunk_id TEXT NOT NULL, revision TEXT NOT NULL, chunker TEXT NOT NULL,
      first_byte INTEGER NOT NULL, after_last_byte INTEGER NOT NULL,
      line_start INTEGER NOT NULL, line_end INTEGER NOT NULL, heading TEXT NOT NULL,
      kind TEXT NOT NULL, content TEXT NOT NULL,
      UNIQUE(generation,chunk_id)
    );
    CREATE INDEX note_retrieval_chunks_source ON note_retrieval_chunks(generation,path);
    CREATE VIRTUAL TABLE note_retrieval_fts USING fts5(content,heading,path UNINDEXED,generation UNINDEXED,chunk_id UNINDEXED);
    CREATE TABLE note_retrieval_dirty (path TEXT PRIMARY KEY, revision INTEGER NOT NULL, reason TEXT NOT NULL);
  ` }]);
}
