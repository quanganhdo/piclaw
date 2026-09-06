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

import { existsSync, mkdirSync, readFileSync, readdirSync, renameSync, statSync, unlinkSync, writeFileSync } from "fs";
import { basename, dirname, join, resolve } from "path";
import { getDataDir } from "./core/config.js";
import { canUseLegacyToolOutput, createToolOutputAccessGuard, ToolOutputAccessDenied } from "./core/tool-output-access.js";
import { createUuid } from "./utils/ids.js";
import { createLogger, debugSuppressedError } from "./utils/logger.js";
import {
  storeToolOutput,
  insertToolOutputChunk,
  getToolOutputById,
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

function buildToolOutputPath(id: string, createdAt: string): string {
  return getDateShardedPath(getToolOutputDir(), `${id}.log`, createdAt);
}

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
  createToolOutputAccessGuard();
  const id = options.id ?? createUuid("out");
  const createdAt = options.createdAt ?? new Date().toISOString();
  const path = buildToolOutputPath(id, createdAt);
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, text ?? "", "utf8");

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
  };

  storeToolOutput(record);

  // Index content in FTS5 in chunks for efficient full-text search.
  const chunks = chunkText(text ?? "");
  for (const chunk of chunks) {
    if (chunk.trim()) insertToolOutputChunk(id, chunk);
  }

  return { id, path, summary, sizeBytes, lineCount };
}

/** Retrieve a tool output record by its UUID handle. */
export function getToolOutput(handle: string): ToolOutputRecord | undefined {
  createToolOutputAccessGuard();
  return getToolOutputById(handle);
}

/** Search the FTS index for a tool output, returning snippet strings. */
export function searchToolOutput(handle: string, query: string, limit = 5): string[] {
  createToolOutputAccessGuard();
  const trimmed = query?.trim?.() ?? "";
  if (!trimmed) return [];
  return searchToolOutputSnippets(handle, trimmed, limit);
}

function listRegisteredToolOutputPaths(): Set<string> {
  try {
    const rows = getDb().prepare("SELECT path FROM tool_outputs WHERE path IS NOT NULL").all() as Array<{ path: string | null }>;
    return new Set(rows.map((row) => row.path).filter((path): path is string => Boolean(path)).map((path) => resolve(path)));
  } catch (error) {
    debugSuppressedError(log, "Failed to list registered tool-output paths during filesystem pruning.", error, {
      operation: "tool_output.prune.list_registered_paths",
    });
    return new Set();
  }
}

/** Remove unreferenced tool-output log files older than the retention window. */
export function pruneToolOutputFiles(maxAgeMs = DEFAULT_TOOL_OUTPUT_RETENTION_MS): number {
  createToolOutputAccessGuard();
  const toolOutputDir = getToolOutputDir();
  if (!existsSync(toolOutputDir)) return 0;
  const retentionMs = clampLogRetentionMs(maxAgeMs, DEFAULT_TOOL_OUTPUT_RETENTION_MS);
  const cutoffMs = Date.now() - retentionMs;
  const registeredPaths = listRegisteredToolOutputPaths();
  let removed = 0;

  const visit = (dir: string): void => {
    let entries: string[];
    try {
      entries = readdirSync(dir);
    } catch (error) {
      debugSuppressedError(log, "Failed to read a tool-output directory during pruning.", error, {
        operation: "tool_output.prune_files.read_dir",
        dir,
      });
      return;
    }

    for (const entry of entries) {
      const path = join(dir, entry);
      let stat;
      try {
        stat = statSync(path);
      } catch {
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
        unlinkSync(path);
        removed += 1;
        cleanupEmptyParentDirs(toolOutputDir, dirname(path));
      } catch (error) {
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
  createToolOutputAccessGuard();
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
  createToolOutputAccessGuard();
  const cutoff = buildToolOutputCutoff(maxAgeMs);
  const rows = deleteToolOutputsBefore(cutoff);
  for (const row of rows) {
    if (row.path && existsSync(row.path)) {
      try {
        unlinkSync(row.path);
        cleanupEmptyParentDirs(getToolOutputDir(), dirname(row.path));
      } catch (err) {
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
  createToolOutputAccessGuard();
  try {
    return readFileSync(path, "utf8");
  } catch {
    return null;
  }
}
