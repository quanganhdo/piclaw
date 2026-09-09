/**
 * db/tool-outputs.ts – Storage and retrieval of large tool invocation outputs.
 *
 * When a tool call (bash, read, etc.) produces output that is too large to
 * inline in the conversation, tool-output.ts stores the full content here
 * and places only a summary/reference in the interaction.
 *
 * The FTS5 virtual table `tool_outputs_fts` allows the agent to search
 * through previously stored outputs (used by extensions/workspace-search.ts
 * and context-tools.ts).
 *
 * Automatic cleanup of old records is driven by the retention settings in
 * core/config.ts (`TOOL_OUTPUT_CONFIG` / `getToolOutputConfig()`).
 *
 * Consumers:
 *   - tool-output.ts calls storeToolOutput() + insertToolOutputChunk().
 *   - tools/context-tools.ts calls getToolOutputById() / searchToolOutputSnippets().
 *   - runtime.ts schedules periodic deleteToolOutputsBefore() calls.
 */

import { getDb } from "./connection.js";
import type { ToolOutputRecord } from "./types.js";
import { prepareFtsQuery } from "../utils/fts-query.js";
import { getSearchMatchMode } from "../core/config.js";
import type { ToolOutputScope } from '../core/tool-output-access.js';

function scopeWhere(scope:ToolOutputScope|null):{sql:string;params:string[]} {
  return scope?{sql:'owner_user_id=? AND root_branch_id=? AND source_branch_id=? AND execution_kind=?',params:[scope.ownerUserId,scope.rootBranchId,scope.sourceBranchId,scope.executionKind]}
    :{sql:'owner_user_id IS NULL AND root_branch_id IS NULL AND source_branch_id IS NULL AND chat_jid IS NULL AND execution_kind IS NULL',params:[]};
}

/** Insert or replace a tool output metadata record (without FTS content). */
export function storeToolOutput(record: ToolOutputRecord): void {
  const db = getDb();
  db.prepare(
    `INSERT INTO tool_outputs (id, created_at, source, size_bytes, line_count, summary, path,owner_user_id,root_branch_id,source_branch_id,chat_jid,execution_kind)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(
    record.id,
    record.created_at,
    record.source ?? null,
    record.size_bytes ?? null,
    record.line_count ?? null,
    record.summary ?? null,
    record.path ?? null,record.owner_user_id??null,record.root_branch_id??null,record.source_branch_id??null,record.chat_jid??null,record.execution_kind??null
  );
}

/** Store metadata and all indexed chunks atomically. */
export function storeToolOutputWithChunks(record:ToolOutputRecord,chunks:string[],validate?:()=>void):void {
  const scope=record.owner_user_id?{ownerUserId:record.owner_user_id,rootBranchId:record.root_branch_id!,sourceBranchId:record.source_branch_id!,chatJid:record.chat_jid!,executionKind:record.execution_kind!}:null;
  getDb().transaction(()=>{validate?.();storeToolOutput(record);for(const chunk of chunks)if(chunk.trim())insertToolOutputChunk(record.id,chunk,scope);validate?.();}).immediate();
}

/**
 * Insert a chunk of tool output content into the FTS5 index.
 * Large outputs are split into chunks so FTS can index them incrementally.
 */
export function insertToolOutputChunk(outputId: string, content: string,scope:ToolOutputScope|null=null): void {
  const db = getDb();
  if(!getToolOutputById(outputId,scope))throw new Error('Tool output scope mismatch.');
  db.prepare("INSERT INTO tool_outputs_fts (content, output_id) VALUES (?, ?)")
    .run(content, outputId);
}

/** Retrieve a tool output metadata record by its UUID. */
export function getToolOutputById(id: string,scope:ToolOutputScope|null=null): ToolOutputRecord | undefined {
  const db = getDb();
  const where=scopeWhere(scope);return db.prepare(`SELECT * FROM tool_outputs WHERE id=? AND ${where.sql}`).get(id,...where.params) as ToolOutputRecord|null ?? undefined;
}

/** Delete a tool output and its FTS entries by ID. */
export function deleteToolOutputById(id: string,scope:ToolOutputScope|null=null): void {
  const db = getDb();
  const remove=()=>{const where=scopeWhere(scope);if(db.prepare(`DELETE FROM tool_outputs WHERE id=? AND ${where.sql}`).run(id,...where.params).changes!==1)return;db.prepare("DELETE FROM tool_outputs_fts WHERE output_id = ?").run(id);};
  if(db.inTransaction)remove();else db.transaction(remove).immediate();
}

/**
 * Delete all tool outputs created before `cutoffIso` (ISO-8601 timestamp).
 * Returns the deleted records. Used by the periodic retention cleanup.
 */
export function deleteToolOutputsBefore(cutoffIso: string,scope:ToolOutputScope|null=null,validate?:()=>void,validateRecord?:(record:ToolOutputRecord)=>void): ToolOutputRecord[] {
  const db=getDb(),where=scopeWhere(scope);return db.transaction(()=>{validate?.();const rows=db.prepare(`SELECT * FROM tool_outputs WHERE created_at<? AND ${where.sql}`).all(cutoffIso,...where.params) as ToolOutputRecord[];for(const row of rows)validateRecord?.(row);for(const row of rows)deleteToolOutputById(row.id,scope);validate?.();return rows;}).immediate();
}

/**
 * Search the FTS index for a specific tool output, returning highlighted
 * snippet strings. Used by context-tools.ts to locate relevant sections
 * of a large output for the agent.
 */
export function searchToolOutputSnippets(outputId: string, query: string, limit = 5,scope:ToolOutputScope|null=null): string[] {
  const db = getDb();
  if(!getToolOutputById(outputId,scope))return [];
  const ftsQuery = prepareFtsQuery(query, getSearchMatchMode());
  if (!ftsQuery) return [];
  try {
    const stmt = db.prepare(
      "SELECT snippet(tool_outputs_fts, 0, '[', ']', '…', 12) as snippet FROM tool_outputs_fts WHERE tool_outputs_fts MATCH ? AND output_id = ? LIMIT ?"
    );
    const rows = stmt.all(ftsQuery, outputId, limit) as Array<{ snippet: string }>;
    return rows.map((row) => row.snippet);
  } catch {
    // FTS query still failed after sanitization — fall back to LIKE
    try {
      const pattern = `%${query.replace(/%/g, "").trim()}%`;
      const stmt = db.prepare(
        "SELECT substr(content, 1, 400) as snippet FROM tool_outputs_fts WHERE content LIKE ? AND output_id = ? LIMIT ?"
      );
      const rows = stmt.all(pattern, outputId, limit) as Array<{ snippet: string }>;
      return rows.map((row) => row.snippet);
    } catch (error) {
      if(scope)throw new Error('Scoped tool output search failed.');
      return [];
    }
  }
}
