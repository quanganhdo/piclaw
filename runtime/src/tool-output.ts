/**
 * tool-output.ts – High-level API for persisting and querying large tool outputs.
 *
 * When a tool call (bash, read, etc.) produces output too large to include
 * inline in the conversation, this module:
 *   1. Writes the full content to a log file on disk.
 *   2. Stores metadata in the `tool_outputs` DB table.
 *   3. Indexes the content in FTS5 for later searching.
 *   4. Returns a short preview/summary for the agent's context window.
 *
 * Also manages automatic retention cleanup (pruneToolOutputs).
 *
 * Consumers:
 *   - tools/tracked-bash.ts calls saveToolOutput() for large bash outputs.
 *   - tools/context-tools.ts calls getToolOutput() / searchToolOutput().
 *   - runtime.ts calls startToolOutputCleanup() at startup.
 *   - agent-pool.ts may call readToolOutputFile() to fetch full content.
 */

import { closeSync, constants, existsSync, fstatSync, lstatSync, mkdirSync, openSync, readFileSync, readdirSync, readSync, realpathSync, renameSync, statSync, unlinkSync, writeFileSync } from "fs";
import { basename, dirname, join, relative, resolve } from "path";
import { createHash } from 'node:crypto';
import { getDataDir } from "./core/config.js";
import { canUseLegacyToolOutput, createToolOutputAccessGuard, ToolOutputAccessDenied, type ToolOutputScope } from "./core/tool-output-access.js";
import { createUuid } from "./utils/ids.js";
import { createLogger, debugSuppressedError } from "./utils/logger.js";
import {
  storeToolOutput,
  storeToolOutputWithChunks,
  getToolOutputById,
  deleteToolOutputById,
  deleteToolOutputsBefore,
  searchToolOutputSnippets,
  getDb,
  type ToolOutputRecord,
} from "./db.js";
import { buildPreviewLines } from "./utils/preview.js";
import {
  DEFAULT_LOG_RETENTION_CAP_MS,
  cleanupEmptyParentDirs,
  clampLogRetentionMs,
  getDateShardedPath,
} from "./utils/log-layout.js";

/** Directory where tool output log files are stored on disk. */
function getToolOutputDir(): string {
  return join(getDataDir(), "tool-output");
}
const log = createLogger("tool-output");
const DEFAULT_TOOL_OUTPUT_RETENTION_MS = DEFAULT_LOG_RETENTION_CAP_MS;
const DEFAULT_TOOL_OUTPUT_CLEANUP_INTERVAL_MS = 15 * 60 * 1000;
/** Default chunk size (characters) for FTS indexing. */
const DEFAULT_CHUNK_SIZE = 4000;

/**
 * Convert a retention interval in milliseconds to an ISO cutoff timestamp.
 */
function buildToolOutputCutoff(maxAgeMs: number): string {
  const retentionMs = clampLogRetentionMs(maxAgeMs, DEFAULT_TOOL_OUTPUT_RETENTION_MS);
  return new Date(Date.now() - retentionMs).toISOString();
}

function buildToolOutputPath(id: string, createdAt: string,scope:ToolOutputScope|null=null): string {
  return getDateShardedPath(scopeOutputDir(scope), `${id}.log`, createdAt);
}
function scopeOutputDir(scope:ToolOutputScope|null):string {if(!scope)return getToolOutputDir();const digest=createHash('sha256').update(`${scope.ownerUserId}\0${scope.rootBranchId}\0${scope.sourceBranchId}\0${scope.executionKind}`).digest('hex');return join(getToolOutputDir(),'users',digest.slice(0,16),digest.slice(16,32));}
function ensureOutputParent(path:string,scope:ToolOutputScope|null):void {if(!scope){mkdirSync(dirname(path),{recursive:true});return;}const root=resolve(getToolOutputDir()),target=resolve(dirname(path));mkdirSync(root,{recursive:true,mode:0o700});const rel=relative(root,target);if(!rel||rel.startsWith('..'))throw new ToolOutputAccessDenied();let current=root;for(const part of rel.split('/')){current=join(current,part);try{const stat=lstatSync(current);if(!stat.isDirectory()||stat.isSymbolicLink()||realpathSync(current)!==resolve(current))throw new ToolOutputAccessDenied();}catch(error){if(error instanceof ToolOutputAccessDenied)throw error;if((error as NodeJS.ErrnoException).code!=='ENOENT')throw new ToolOutputAccessDenied();mkdirSync(current,{mode:0o700});const stat=lstatSync(current);if(!stat.isDirectory()||stat.isSymbolicLink()||realpathSync(current)!==resolve(current))throw new ToolOutputAccessDenied();}}}
function scopedRecordPath(record:ToolOutputRecord,scope:ToolOutputScope):string {const expected=resolve(buildToolOutputPath(record.id,record.created_at,scope));if(!record.path||resolve(record.path)!==expected)throw new ToolOutputAccessDenied();return expected;}
function readStableFile(path:string):string {const before=lstatSync(path);if(!before.isFile()||before.isSymbolicLink()||before.nlink!==1||realpathSync(path)!==resolve(path))throw new ToolOutputAccessDenied();const fd=openSync(path,constants.O_RDONLY|constants.O_NOFOLLOW);try{const opened=fstatSync(fd);if(!opened.isFile()||opened.nlink!==1||opened.dev!==before.dev||opened.ino!==before.ino||opened.size!==before.size)throw new ToolOutputAccessDenied();const bytes=Buffer.alloc(opened.size);let offset=0;while(offset<bytes.length){const n=readSync(fd,bytes,offset,bytes.length-offset,offset);if(!n)throw new ToolOutputAccessDenied();offset+=n;}const after=fstatSync(fd);if(after.dev!==opened.dev||after.ino!==opened.ino||after.size!==opened.size||after.mtimeMs!==opened.mtimeMs||realpathSync(path)!==resolve(path))throw new ToolOutputAccessDenied();return bytes.toString('utf8');}finally{closeSync(fd);}}
function validateScopedPathForDelete(record:ToolOutputRecord,scope:ToolOutputScope):void {const path=scopedRecordPath(record,scope);if(!existsSync(path))return;const stat=lstatSync(path);if(!stat.isFile()||stat.isSymbolicLink()||stat.nlink!==1||realpathSync(path)!==path)throw new ToolOutputAccessDenied();}

/** Options for saveToolOutput(). */
export interface ToolOutputSaveOptions {
  /** Override the generated UUID. */
  id?: string;
  /** Tool name that produced this output (e.g. "bash", "read"). */
  source?: string | null;
  /** Pre-computed summary (if not provided, one is generated). */
  summary?: string | null;
  /** Override the created_at timestamp. */
  createdAt?: string;
}

/** Result returned after successfully saving a tool output. */
export interface ToolOutputSaveResult {
  /** UUID of the stored output. */
  id: string;
  /** Filesystem path to the full log file. */
  path: string;
  /** Short preview/summary of the output content. */
  summary: string;
  /** Total size of the output in bytes. */
  sizeBytes: number;
  /** Total number of lines in the output. */
  lineCount: number;
}

/**
 * Generate a short text preview of the first N lines of content.
 * Used as the default summary when none is provided.
 */
export function buildPreview(text: string, maxLines = 12, maxLineLength = 200): string {
  const { preview } = buildPreviewLines(text, {
    maxLines,
    maxLineLength,
    includeOmittedLine: true,
  });
  return preview;
}

/**
 * Split text into line-aware chunks for FTS indexing.
 * Avoids splitting mid-line when possible.
 */
export function chunkText(text: string, chunkSize = DEFAULT_CHUNK_SIZE): string[] {
  const normalized = text.replace(/\r\n/g, "\n");
  if (!normalized) return [];

  const rawLines = normalized.split("\n");
  const lines = rawLines.map((line, index) => {
    const hasTrailingNewline = index < rawLines.length - 1;
    return hasTrailingNewline ? `${line}\n` : line;
  });
  const chunks: string[] = [];
  let buffer = "";

  const flushChunk = (chunk: string) => {
    for (let index = 0; index < chunk.length; index += chunkSize) {
      chunks.push(chunk.slice(index, index + chunkSize));
    }
  };

  for (const line of lines) {
    if (line.length > chunkSize) {
      if (buffer) {
        chunks.push(buffer);
        buffer = "";
      }
      flushChunk(line);
      continue;
    }

    if (!buffer) {
      buffer = line;
      continue;
    }

    const next = `${buffer}${line}`;
    if (next.length > chunkSize) {
      chunks.push(buffer);
      buffer = line;
      continue;
    }

    buffer = next;
  }

  if (buffer) chunks.push(buffer);
  return chunks;
}

/**
 * Persist a tool output: write to disk, store metadata in SQLite, and
 * index content chunks in FTS5. Returns a summary result.
 */
export function saveToolOutput(text: string, options: ToolOutputSaveOptions = {}): ToolOutputSaveResult {
  const access=createToolOutputAccessGuard(),scope=access.scope;
  const id = options.id ?? createUuid("out");
  if(!/^[A-Za-z0-9_-]{1,128}$/.test(id))throw new ToolOutputAccessDenied();
  const createdAt = options.createdAt ?? new Date().toISOString();
  const path = buildToolOutputPath(id, createdAt,scope);
  ensureOutputParent(path,scope);
  writeFileSync(path, text ?? "", {encoding:"utf8",mode:0o600,flag:"wx"});

  const sizeBytes = Buffer.byteLength(text ?? "", "utf8");
  const lineCount = text ? text.replace(/\r\n/g, "\n").split("\n").length : 0;
  const summary = options.summary ?? buildPreview(text ?? "");

  const record: ToolOutputRecord = {
    id,
    created_at: createdAt,
    source: options.source ?? null,
    size_bytes: sizeBytes,
    line_count: lineCount,
    summary,
    path,
    owner_user_id:scope?.ownerUserId??null,root_branch_id:scope?.rootBranchId??null,source_branch_id:scope?.sourceBranchId??null,chat_jid:scope?.chatJid??null,execution_kind:scope?.executionKind??null,
  };

  let committed=false;try {access();storeToolOutputWithChunks(record,chunkText(text??""),access);committed=true;access();}
  catch(error){if(committed)try{deleteToolOutputById(id,scope);}catch(deleteError){debugSuppressedError(log,"Failed to remove rejected tool-output metadata.",deleteError,{operation:"tool_output.save.rollback_metadata",id});}try{unlinkSync(path);}catch(unlinkError){debugSuppressedError(log,"Failed to remove rejected tool-output file.",unlinkError,{operation:"tool_output.save.rollback",id});}throw error;}

  return { id, path, summary, sizeBytes, lineCount };
}

/** Retrieve a tool output record by its UUID handle. */
export function getToolOutput(handle: string): ToolOutputRecord | undefined {
  const access=createToolOutputAccessGuard(),record=getToolOutputById(handle,access.scope);if(record&&access.scope)scopedRecordPath(record,access.scope);access();return record;
}

/** Search the FTS index for a tool output, returning snippet strings. */
export function searchToolOutput(handle: string, query: string, limit = 5): string[] {
  const access=createToolOutputAccessGuard();
  const trimmed = query?.trim?.() ?? "";
  if (!trimmed) return [];
  const result=searchToolOutputSnippets(handle,trimmed,limit,access.scope);access();return result;
}

function listRegisteredToolOutputPaths(scope:ToolOutputScope|null): Set<string> {
  try {
    const rows = scope?getDb().prepare("SELECT path FROM tool_outputs WHERE path IS NOT NULL AND owner_user_id=? AND root_branch_id=? AND source_branch_id=? AND execution_kind=?").all(scope.ownerUserId,scope.rootBranchId,scope.sourceBranchId,scope.executionKind) as Array<{path:string|null}>
      :getDb().prepare("SELECT path FROM tool_outputs WHERE path IS NOT NULL AND owner_user_id IS NULL").all() as Array<{path:string|null}>;
    return new Set(rows.map((row) => row.path).filter((path): path is string => Boolean(path)).map((path) => resolve(path)));
  } catch (error) {
    if(scope)throw new ToolOutputAccessDenied();
    debugSuppressedError(log, "Failed to list registered tool-output paths during filesystem pruning.", error, {
      operation: "tool_output.prune.list_registered_paths",
    });
    return new Set();
  }
}

/** Remove unreferenced tool-output log files older than the retention window. */
export function pruneToolOutputFiles(maxAgeMs = DEFAULT_TOOL_OUTPUT_RETENTION_MS): number {
  const access=createToolOutputAccessGuard(),scope=access.scope;
  const toolOutputDir = scopeOutputDir(scope);
  if (!existsSync(toolOutputDir)) return 0;
  const retentionMs = clampLogRetentionMs(maxAgeMs, DEFAULT_TOOL_OUTPUT_RETENTION_MS);
  const cutoffMs = Date.now() - retentionMs;
  const registeredPaths = listRegisteredToolOutputPaths(scope);access();
  let removed = 0;

  const visit = (dir: string): void => {
    let entries: string[];
    try {
      entries = readdirSync(dir);
    } catch (error) {
      if(scope||error instanceof ToolOutputAccessDenied)throw new ToolOutputAccessDenied();
      debugSuppressedError(log, "Failed to read a tool-output directory during pruning.", error, {
        operation: "tool_output.prune_files.read_dir",
        dir,
      });
      return;
    }

    for (const entry of entries) {
      access();
      const path = join(dir, entry);
      if(!scope&&resolve(path)===resolve(getToolOutputDir(),"users"))continue;
      let stat;
      try {
        stat = lstatSync(path);
        if(stat.isSymbolicLink()||(scope&&realpathSync(path)!==resolve(path)))throw new ToolOutputAccessDenied();
      } catch(error) {
        if(scope||error instanceof ToolOutputAccessDenied)throw new ToolOutputAccessDenied();
        continue;
      }

      if (stat.isDirectory()) {
        visit(path);
        cleanupEmptyParentDirs(toolOutputDir, path);
        continue;
      }
      if (!stat.isFile() || !entry.endsWith(".log")) continue;
      if (stat.mtimeMs >= cutoffMs || registeredPaths.has(resolve(path))) continue;

      try {
        access();
        unlinkSync(path);
        removed += 1;
        cleanupEmptyParentDirs(toolOutputDir, dirname(path));
      } catch (error) {
        if(scope||error instanceof ToolOutputAccessDenied)throw new ToolOutputAccessDenied();
        debugSuppressedError(log, "Failed to unlink an orphaned tool-output file during pruning.", error, {
          operation: "tool_output.prune_files.unlink",
          path,
        });
      }
    }
  };

  visit(toolOutputDir);
  return removed;
}

/**
 * Move legacy flat tool-output files into date shards and update DB paths.
 * Existing flat DB paths remain readable if migration cannot move a file.
 */
export function migrateFlatToolOutputsToDateShards(): number {
  const access=createToolOutputAccessGuard();if(access.scope)return 0;
  const toolOutputDir = getToolOutputDir();
  mkdirSync(toolOutputDir, { recursive: true });
  const root = resolve(toolOutputDir);
  let rows: ToolOutputRecord[];
  try {
    rows = getDb().prepare("SELECT * FROM tool_outputs WHERE path IS NOT NULL").all() as ToolOutputRecord[];
  } catch (error) {
    debugSuppressedError(log, "Failed to list tool-output records for path migration.", error, {
      operation: "tool_output.migrate_flat_paths.list",
    });
    return 0;
  }

  const db = getDb();
  const updatePath = db.prepare("UPDATE tool_outputs SET path = ? WHERE id = ?");
  const updatePathTransaction = db.transaction((nextPath: string, id: string) => {
    updatePath.run(nextPath, id);
  });
  let migrated = 0;

  for (const row of rows) {
    if (!row.path) continue;
    const currentPath = resolve(row.path);
    const expectedName = `${row.id}.log`;
    if (dirname(currentPath) !== root || basename(currentPath) !== expectedName) continue;

    const nextPath = buildToolOutputPath(row.id, row.created_at);
    if (resolve(nextPath) === currentPath) continue;

    try {
      mkdirSync(dirname(nextPath), { recursive: true });
      if (!existsSync(nextPath)) {
        if (!existsSync(currentPath)) continue;
        renameSync(currentPath, nextPath);
      } else if (existsSync(currentPath)) {
        unlinkSync(currentPath);
      }
      updatePathTransaction(nextPath, row.id);
      migrated += 1;
    } catch (error) {
      debugSuppressedError(log, "Failed to migrate a flat tool-output path into the date-sharded layout.", error, {
        operation: "tool_output.migrate_flat_paths.move",
        id: row.id,
        currentPath,
        nextPath,
      });
    }
  }

  return migrated;
}

/**
 * Delete tool outputs older than `maxAgeMs`. Removes both the DB records
 * and the on-disk log files. Returns the number of records pruned.
 */
export function pruneToolOutputs(maxAgeMs = DEFAULT_TOOL_OUTPUT_RETENTION_MS): number {
  const access=createToolOutputAccessGuard();
  const cutoff = buildToolOutputCutoff(maxAgeMs);
  const rows = deleteToolOutputsBefore(cutoff,access.scope,access,record=>{if(access.scope)validateScopedPathForDelete(record,access.scope);});
  for (const row of rows) {
    if (row.path && existsSync(row.path)) {
      try {
        access();
        const path=access.scope?scopedRecordPath(row,access.scope):row.path;
        const stat=lstatSync(path);if(stat.isSymbolicLink()||!stat.isFile()||(access.scope&&(stat.nlink!==1||realpathSync(path)!==resolve(path))))throw new ToolOutputAccessDenied();
        unlinkSync(path);
        cleanupEmptyParentDirs(access.scope?scopeOutputDir(access.scope):getToolOutputDir(), dirname(path));
      } catch (err) {
        if(access.scope||err instanceof ToolOutputAccessDenied)throw new ToolOutputAccessDenied();
        debugSuppressedError(log, "Failed to unlink a pruned tool-output file; it may already be gone.", err, {
          operation: "tool_output.prune.unlink",
          path: row.path,
          id: row.id,
        });
      }
    }
  }
  pruneToolOutputFiles(maxAgeMs);
  return rows.length;
}

/** Guard to ensure the cleanup interval is only started once. */
let cleanupTimer: ReturnType<typeof setInterval> | null = null;

/**
 * Start a periodic timer that prunes old tool outputs.
 * Called once by runtime.ts during startup.
 */
export function startToolOutputCleanup(
  maxAgeMs = DEFAULT_TOOL_OUTPUT_RETENTION_MS,
  intervalMs = DEFAULT_TOOL_OUTPUT_CLEANUP_INTERVAL_MS,
): void {
  if (!canUseLegacyToolOutput() || cleanupTimer) return;
  try {
    migrateFlatToolOutputsToDateShards();
    // Run an initial prune immediately, then on a recurring interval.
    pruneToolOutputs(maxAgeMs);
  } catch (error) {
    if (error instanceof ToolOutputAccessDenied) return;
    throw error;
  }
  cleanupTimer = setInterval(() => {
    if (!canUseLegacyToolOutput()) {
      if (cleanupTimer) clearInterval(cleanupTimer);
      cleanupTimer = null;
      return;
    }
    try { pruneToolOutputs(maxAgeMs); } catch (error) {
      if (!(error instanceof ToolOutputAccessDenied)) throw error;
      if (cleanupTimer) clearInterval(cleanupTimer);
      cleanupTimer = null;
    }
  }, intervalMs);
  cleanupTimer.unref();
}

/**
 * Read the full content of a tool output log file from disk.
 * Returns null if the file doesn't exist or is unreadable.
 */
export function readToolOutputFile(path: string): string | null {
  const access=createToolOutputAccessGuard();
  if(access.scope){const record=getDb().prepare('SELECT * FROM tool_outputs WHERE path=? AND owner_user_id=? AND root_branch_id=? AND source_branch_id=? AND execution_kind=?').get(path,access.scope.ownerUserId,access.scope.rootBranchId,access.scope.sourceBranchId,access.scope.executionKind) as ToolOutputRecord|null;if(!record)return null;scopedRecordPath(record,access.scope);}
  try {
    const value=access.scope?readStableFile(path):readFileSync(path,"utf8");access();return value;
  } catch(error) {
    if(access.scope||error instanceof ToolOutputAccessDenied)throw new ToolOutputAccessDenied();
    return null;
  }
}
