/** Archive/migration tooling: preserves imported JSONL bytes, search and export.
 * Native execution belongs to Harness; this store is never an AgentPool backend. */
import { createHash } from "node:crypto";
import Database from "bun:sqlite";
import { statSync } from "node:fs";
import { resolve } from "node:path";

import { applyOwnedMigrations, type OwnedSchemaMigration } from "../../src/db/migrations.js";

export const SQLITE_SESSION_SCHEMA_OWNER = "piclaw-agent-sessions";
export const EARENDIL_SQLITE_COMPATIBILITY_COMMIT = "583f153d502aa8e958eefdb9af0fbd3344e68f95";

const SESSION_SCHEMA_MIGRATIONS: readonly OwnedSchemaMigration[] = [{
  owner: SQLITE_SESSION_SCHEMA_OWNER,
  id: "001-namespaced-session-import",
  order: 1,
  sql: `
    CREATE TABLE IF NOT EXISTS piclaw_agent_sessions (
      import_id TEXT PRIMARY KEY,
      session_id TEXT NOT NULL,
      source_path TEXT NOT NULL UNIQUE,
      source_sha256 TEXT NOT NULL,
      source_bytes INTEGER NOT NULL,
      source_trailing_lf INTEGER NOT NULL CHECK(source_trailing_lf IN (0, 1)),
      header_json TEXT NOT NULL,
      cwd TEXT,
      parent_session TEXT,
      created_at TEXT,
      imported_at TEXT NOT NULL,
      entry_count INTEGER NOT NULL,
      active_leaf_id TEXT
    ) WITHOUT ROWID;
    CREATE INDEX IF NOT EXISTS idx_piclaw_agent_sessions_session_id
      ON piclaw_agent_sessions(session_id);
    CREATE INDEX IF NOT EXISTS idx_piclaw_agent_sessions_created_at
      ON piclaw_agent_sessions(created_at DESC);

    CREATE TABLE IF NOT EXISTS piclaw_agent_entries (
      import_id TEXT NOT NULL,
      entry_seq INTEGER NOT NULL,
      entry_id TEXT,
      parent_id TEXT,
      type TEXT NOT NULL,
      timestamp TEXT,
      raw_json TEXT NOT NULL,
      search_text TEXT NOT NULL,
      PRIMARY KEY(import_id, entry_seq),
      FOREIGN KEY(import_id) REFERENCES piclaw_agent_sessions(import_id) ON DELETE CASCADE
    );
    CREATE INDEX IF NOT EXISTS idx_piclaw_agent_entries_parent
      ON piclaw_agent_entries(import_id, parent_id);
    CREATE UNIQUE INDEX IF NOT EXISTS idx_piclaw_agent_entries_id
      ON piclaw_agent_entries(import_id, entry_id)
      WHERE entry_id IS NOT NULL;
    CREATE INDEX IF NOT EXISTS idx_piclaw_agent_entries_type
      ON piclaw_agent_entries(import_id, type, entry_seq);

    CREATE VIRTUAL TABLE IF NOT EXISTS piclaw_agent_entries_fts USING fts5(
      search_text,
      content='piclaw_agent_entries',
      content_rowid='rowid',
      tokenize='trigram remove_diacritics 1'
    );
    CREATE TRIGGER IF NOT EXISTS piclaw_agent_entries_ai AFTER INSERT ON piclaw_agent_entries BEGIN
      INSERT INTO piclaw_agent_entries_fts(rowid, search_text) VALUES (new.rowid, new.search_text);
    END;
    CREATE TRIGGER IF NOT EXISTS piclaw_agent_entries_ad AFTER DELETE ON piclaw_agent_entries BEGIN
      INSERT INTO piclaw_agent_entries_fts(piclaw_agent_entries_fts, rowid, search_text)
      VALUES ('delete', old.rowid, old.search_text);
    END;
    CREATE TRIGGER IF NOT EXISTS piclaw_agent_entries_au AFTER UPDATE OF search_text ON piclaw_agent_entries BEGIN
      INSERT INTO piclaw_agent_entries_fts(piclaw_agent_entries_fts, rowid, search_text)
      VALUES ('delete', old.rowid, old.search_text);
      INSERT INTO piclaw_agent_entries_fts(rowid, search_text) VALUES (new.rowid, new.search_text);
    END;
  `,
}];

export interface ImportedJsonlSession {
  importId: string;
  sessionId: string;
  sourcePath: string;
  sourceSha256: string;
  sourceBytes: number;
  entryCount: number;
  activeLeafId: string | null;
  imported: boolean;
}

export interface SessionEntryRow {
  entry_seq: number;
  entry_id: string | null;
  parent_id: string | null;
  type: string;
  timestamp: string | null;
  raw_json: string;
}

export interface SessionSearchRow extends SessionEntryRow {
  import_id: string;
  session_id: string;
  source_path: string;
}

interface ParsedSessionFile {
  header: Record<string, unknown>;
  headerJson: string;
  entryLines: string[];
  sourceText: string;
  sourceSha256: string;
  sourceBytes: number;
  trailingLf: boolean;
  activeLeafId: string | null;
}

function textValue(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value : null;
}

const SEARCH_TEXT_MAX_CHARS = 16_000;
const SEARCH_TEXT_KEYS = new Set(["text", "summary", "content", "name", "toolName"]);

function searchText(value: unknown): string {
  const parts: string[] = [];
  const visit = (current: unknown, key = "") => {
    if (parts.reduce((total, part) => total + part.length, 0) >= SEARCH_TEXT_MAX_CHARS) return;
    if (typeof current === "string") {
      if (SEARCH_TEXT_KEYS.has(key)) parts.push(current);
      return;
    }
    if (Array.isArray(current)) {
      for (const item of current) visit(item, key);
      return;
    }
    if (current && typeof current === "object") {
      for (const [childKey, child] of Object.entries(current as Record<string, unknown>)) visit(child, childKey);
    }
  };
  visit(value);
  const joined = parts.join("\n");
  if (joined.length <= SEARCH_TEXT_MAX_CHARS) return joined;
  const half = Math.floor(SEARCH_TEXT_MAX_CHARS / 2);
  return `${joined.slice(0, half)}\n${joined.slice(-half)}`;
}

async function readSessionFile(sourcePath: string): Promise<ParsedSessionFile> {
  const sourceText = await Bun.file(sourcePath).text();
  if (sourceText.includes("\r\n")) throw new Error(`CRLF JSONL is not supported by the exact round-trip importer: ${sourcePath}`);
  const trailingLf = sourceText.endsWith("\n");
  const lines = sourceText.split("\n");
  if (trailingLf) lines.pop();
  if (lines.length === 0 || !lines[0]) throw new Error(`Session JSONL is empty: ${sourcePath}`);
  const header = JSON.parse(lines[0]) as Record<string, unknown>;
  if (header.type !== "session" || !textValue(header.id)) throw new Error(`Session JSONL has no valid header: ${sourcePath}`);
  let activeLeafId: string | null = null;
  for (let index = 1; index < lines.length; index += 1) {
    const entry = JSON.parse(lines[index]) as Record<string, unknown>;
    activeLeafId = entry.type === "leaf" ? textValue(entry.targetId) : textValue(entry.id);
  }
  return {
    header,
    headerJson: lines[0],
    entryLines: lines.slice(1),
    sourceText,
    sourceSha256: createHash("sha256").update(sourceText).digest("hex"),
    sourceBytes: Buffer.byteLength(sourceText),
    trailingLf,
    activeLeafId,
  };
}

export class SqliteSessionStore {
  readonly database: Database;
  private closed = false;

  constructor(pathOrDatabase: string | Database) {
    this.database = typeof pathOrDatabase === "string"
      ? new Database(pathOrDatabase, { create: true, strict: true })
      : pathOrDatabase;
    this.database.exec("PRAGMA foreign_keys=ON; PRAGMA journal_mode=WAL; PRAGMA synchronous=FULL; PRAGMA busy_timeout=5000;");
    this.assertNoUnownedSchemaObjects();
    applyOwnedMigrations(this.database, SESSION_SCHEMA_MIGRATIONS);
    this.assertSchemaShape();
  }

  private assertNoUnownedSchemaObjects(): void {
    const applied = this.database.prepare(`
      SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'piclaw_schema_migrations'
    `).get() && this.database.prepare(`
      SELECT 1 FROM piclaw_schema_migrations WHERE owner = ? AND id = ?
    `).get(SQLITE_SESSION_SCHEMA_OWNER, SESSION_SCHEMA_MIGRATIONS[0].id);
    if (applied) return;
    const ownedNames = [
      "piclaw_agent_sessions", "piclaw_agent_entries", "piclaw_agent_entries_fts",
      "piclaw_agent_entries_ai", "piclaw_agent_entries_ad", "piclaw_agent_entries_au",
    ];
    const placeholders = ownedNames.map(() => "?").join(", ");
    const existing = this.database.prepare(`
      SELECT name FROM sqlite_master WHERE name IN (${placeholders}) ORDER BY name
    `).all(...ownedNames) as Array<{ name: string }>;
    if (existing.length > 0) {
      throw new Error(`Unowned session schema objects already exist: ${existing.map((row) => row.name).join(", ")}`);
    }
  }

  private assertSchemaShape(): void {
    const columns = (this.database.prepare("PRAGMA table_info(piclaw_agent_entries)").all() as Array<{ name: string }>).map((row) => row.name);
    const expected = ["import_id", "entry_seq", "entry_id", "parent_id", "type", "timestamp", "raw_json", "search_text"];
    if (columns.join("\0") !== expected.join("\0")) throw new Error("Session schema shape does not match the recorded migration.");
    const triggerCount = Number((this.database.prepare(`
      SELECT COUNT(*) AS count FROM sqlite_master
      WHERE type = 'trigger' AND name IN ('piclaw_agent_entries_ai', 'piclaw_agent_entries_ad', 'piclaw_agent_entries_au')
    `).get() as { count: number }).count);
    if (triggerCount !== 3) throw new Error("Session schema is missing required FTS triggers.");
  }

  async importJsonl(sourcePath: string): Promise<ImportedJsonlSession> {
    const absolutePath = resolve(sourcePath);
    const parsed = await readSessionFile(absolutePath);
    const importId = createHash("sha256").update(absolutePath).digest("hex");
    const existing = this.database.prepare(`
      SELECT source_sha256, entry_count, active_leaf_id, session_id, source_bytes
      FROM piclaw_agent_sessions WHERE source_path = ?
    `).get(absolutePath) as {
      source_sha256: string;
      entry_count: number;
      active_leaf_id: string | null;
      session_id: string;
      source_bytes: number;
    } | undefined;
    if (existing) {
      if (existing.source_sha256 !== parsed.sourceSha256) {
        throw new Error(`Imported source changed; existing rows were preserved: ${absolutePath}`);
      }
      return {
        importId,
        sessionId: existing.session_id,
        sourcePath: absolutePath,
        sourceSha256: existing.source_sha256,
        sourceBytes: existing.source_bytes,
        entryCount: existing.entry_count,
        activeLeafId: existing.active_leaf_id,
        imported: false,
      };
    }

    const insertSession = this.database.prepare(`
      INSERT INTO piclaw_agent_sessions(
        import_id, session_id, source_path, source_sha256, source_bytes,
        source_trailing_lf, header_json, cwd, parent_session, created_at,
        imported_at, entry_count, active_leaf_id
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);
    const insertEntry = this.database.prepare(`
      INSERT INTO piclaw_agent_entries(import_id, entry_seq, entry_id, parent_id, type, timestamp, raw_json, search_text)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `);

    this.database.transaction(() => {
      insertSession.run(
        importId,
        textValue(parsed.header.id),
        absolutePath,
        parsed.sourceSha256,
        parsed.sourceBytes,
        parsed.trailingLf ? 1 : 0,
        parsed.headerJson,
        textValue(parsed.header.cwd),
        textValue(parsed.header.parentSession),
        textValue(parsed.header.timestamp),
        new Date().toISOString(),
        parsed.entryLines.length,
        parsed.activeLeafId,
      );
      parsed.entryLines.forEach((rawJson, index) => {
        const entry = JSON.parse(rawJson) as Record<string, unknown>;
        insertEntry.run(
          importId,
          index + 1,
          textValue(entry.id),
          textValue(entry.parentId),
          textValue(entry.type) ?? "unknown",
          textValue(entry.timestamp),
          rawJson,
          searchText(entry),
        );
      });
    }).immediate();

    return {
      importId,
      sessionId: textValue(parsed.header.id)!,
      sourcePath: absolutePath,
      sourceSha256: parsed.sourceSha256,
      sourceBytes: parsed.sourceBytes,
      entryCount: parsed.entryLines.length,
      activeLeafId: parsed.activeLeafId,
      imported: true,
    };
  }

  appendRawEntry(importId: string, rawJson: string): SessionEntryRow {
    const entry = JSON.parse(rawJson) as Record<string, unknown>;
    const type = textValue(entry.type);
    if (!type || type === "session") throw new Error("Session entries require a non-header type.");
    const entryId = textValue(entry.id);
    const parentId = textValue(entry.parentId);
    const activeLeafId = type === "leaf" ? textValue(entry.targetId) : entryId;
    return this.database.transaction(() => {
      const session = this.database.prepare(`
        SELECT entry_count FROM piclaw_agent_sessions WHERE import_id = ?
      `).get(importId) as { entry_count: number } | undefined;
      if (!session) throw new Error(`Imported session not found: ${importId}`);
      const entrySeq = session.entry_count + 1;
      this.database.prepare(`
        INSERT INTO piclaw_agent_entries(import_id, entry_seq, entry_id, parent_id, type, timestamp, raw_json, search_text)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      `).run(importId, entrySeq, entryId, parentId, type, textValue(entry.timestamp), rawJson, searchText(entry));
      this.database.prepare(`
        UPDATE piclaw_agent_sessions
        SET entry_count = ?, active_leaf_id = COALESCE(?, active_leaf_id)
        WHERE import_id = ?
      `).run(entrySeq, activeLeafId, importId);
      return {
        entry_seq: entrySeq,
        entry_id: entryId,
        parent_id: parentId,
        type,
        timestamp: textValue(entry.timestamp),
        raw_json: rawJson,
      };
    }).immediate();
  }

  listEntries(importId: string): SessionEntryRow[] {
    return this.database.prepare(`
      SELECT entry_seq, entry_id, parent_id, type, timestamp, raw_json
      FROM piclaw_agent_entries WHERE import_id = ? ORDER BY entry_seq
    `).all(importId) as SessionEntryRow[];
  }

  readBranch(importId: string, leafId?: string | null): SessionEntryRow[] {
    const target = leafId ?? (this.database.prepare(`
      SELECT active_leaf_id FROM piclaw_agent_sessions WHERE import_id = ?
    `).get(importId) as { active_leaf_id?: string | null } | undefined)?.active_leaf_id ?? null;
    if (!target) return [];
    const readEntry = this.database.prepare(`
      SELECT entry_seq, entry_id, parent_id, type, timestamp, raw_json
      FROM piclaw_agent_entries WHERE import_id = ? AND entry_id = ?
    `);
    const reversed: SessionEntryRow[] = [];
    const visited = new Set<string>();
    let entryId: string | null = target;
    while (entryId && !visited.has(entryId)) {
      visited.add(entryId);
      const entry = readEntry.get(importId, entryId) as SessionEntryRow | undefined;
      if (!entry) break;
      reversed.push(entry);
      entryId = entry.parent_id;
    }
    return reversed.reverse();
  }

  readCompactedBranch(importId: string, leafId?: string | null): SessionEntryRow[] {
    const branch = this.readBranch(importId, leafId);
    for (let index = branch.length - 1; index >= 0; index -= 1) {
      if (branch[index].type !== "compaction") continue;
      const entry = JSON.parse(branch[index].raw_json) as { firstKeptEntryId?: unknown };
      const firstKeptId = textValue(entry.firstKeptEntryId);
      if (!firstKeptId) continue;
      const firstKeptIndex = branch.findIndex((candidate) => candidate.entry_id === firstKeptId);
      if (firstKeptIndex >= 0) return branch.slice(firstKeptIndex);
    }
    return branch;
  }

  search(text: string, limit = 50): SessionSearchRow[] {
    const terms = text.trim().split(/\s+/).filter(Boolean);
    if (terms.length === 0) return [];
    const query = terms.map((term) => `"${term.replaceAll('"', '""')}"`).join(" AND ");
    return this.database.prepare(`
      SELECT entry.import_id, session.session_id, session.source_path,
             entry.entry_seq, entry.entry_id, entry.parent_id, entry.type, entry.timestamp, entry.raw_json
      FROM piclaw_agent_entries_fts fts
      JOIN piclaw_agent_entries entry ON entry.rowid = fts.rowid
      JOIN piclaw_agent_sessions session ON session.import_id = entry.import_id
      WHERE piclaw_agent_entries_fts MATCH ?
      ORDER BY bm25(piclaw_agent_entries_fts)
      LIMIT ?
    `).all(query, limit) as SessionSearchRow[];
  }

  exportJsonl(importId: string): string {
    const session = this.database.prepare(`
      SELECT header_json, source_trailing_lf FROM piclaw_agent_sessions WHERE import_id = ?
    `).get(importId) as { header_json: string; source_trailing_lf: number } | undefined;
    if (!session) throw new Error(`Imported session not found: ${importId}`);
    const lines = [session.header_json, ...this.listEntries(importId).map((entry) => entry.raw_json)];
    return `${lines.join("\n")}${session.source_trailing_lf ? "\n" : ""}`;
  }

  verifyRoundTrip(importId: string): { sha256: string; bytes: number; matches: boolean } {
    const session = this.database.prepare(`
      SELECT source_sha256, source_bytes FROM piclaw_agent_sessions WHERE import_id = ?
    `).get(importId) as { source_sha256: string; source_bytes: number } | undefined;
    if (!session) throw new Error(`Imported session not found: ${importId}`);
    const exported = this.exportJsonl(importId);
    const sha256 = createHash("sha256").update(exported).digest("hex");
    const bytes = Buffer.byteLength(exported);
    return { sha256, bytes, matches: sha256 === session.source_sha256 && bytes === session.source_bytes };
  }

  drain(): void {
    this.database.exec("PRAGMA wal_checkpoint(PASSIVE); PRAGMA shrink_memory");
  }

  close(): void {
    if (this.closed) return;
    this.closed = true;
    this.drain();
    this.database.close();
  }
}

export function inspectSessionStore(path: string): { bytes: number; sessions: number; entries: number; integrity: string } {
  const database = new Database(path, { readonly: true, strict: true });
  try {
    const integrity = String((database.prepare("PRAGMA integrity_check").get() as { integrity_check?: unknown } | undefined)?.integrity_check ?? "");
    const sessions = Number((database.prepare("SELECT COUNT(*) AS count FROM piclaw_agent_sessions").get() as { count: number }).count);
    const entries = Number((database.prepare("SELECT COUNT(*) AS count FROM piclaw_agent_entries").get() as { count: number }).count);
    return { bytes: statSync(path).size, sessions, entries, integrity };
  } finally {
    database.close();
  }
}
