/**
 * workspace-index-core.ts – Shared workspace index contracts and refresh logic.
 *
 * This lower-level module is intentionally independent from
 * workspace-index-process.ts. The public workspace-search surface can request a
 * background process, and the process runner can refresh the index, without an
 * import cycle between those two orchestration layers.
 */

import fs from "node:fs/promises";
import path from "node:path";

import { getDb } from "./db.js";
import { getWorkspaceDir, getWorkspaceSearchConfig } from "./core/config.js";
import { createLogger, debugSuppressedError } from "./utils/logger.js";
import { workspaceIndexAccess,WorkspaceIndexAccessDenied } from './core/workspace-index-access.js';
import { familyWorkspaceIndexStatus,familyWorkspaceScope,refreshFamilyWorkspaceIndex,staleFamilyWorkspaceIndex } from './family-workspace-index.js';

const log = createLogger("workspace-index-core");
export const AGGRESSIVE_WORKSPACE_INDEX_MEMORY_ENV = "PICLAW_AGGRESSIVE_WORKSPACE_INDEX_MEMORY";
const AGGRESSIVE_WORKSPACE_INDEX_GC_EVERY_FILES = 8;

import type { WorkspaceSearchScope,WorkspaceIndexState,WorkspaceIndexStatus } from './core/workspace-index-types.js';
export type { WorkspaceSearchScope,WorkspaceIndexState,WorkspaceIndexStatus } from './core/workspace-index-types.js';

export type WorkspaceIndexBackgroundRefreshParams = {
  scope?: WorkspaceSearchScope | string;
  max_kb?: number;
};

export type WorkspaceIndexProcessParams = WorkspaceIndexBackgroundRefreshParams;

type WorkspaceIndexStatusRow = {
  scope: WorkspaceSearchScope;
  state: Exclude<WorkspaceIndexState, "never_indexed">;
  last_indexed_at: string | null;
  last_error: string | null;
  indexed_file_count: number;
  roots_json: string;
  updated_at: string;
};

const DEFAULT_EXTS = new Set([
  ".md",
  ".txt",
  ".ts",
  ".tsx",
  ".js",
  ".jsx",
  ".json",
  ".yaml",
  ".yml",
  ".sh",
  ".csv",
  ".xml",
  ".toml",
  ".env",
]);

const activeIndexScopes = new Map<WorkspaceSearchScope, string[]>();

const clampNumber = (value: number | undefined, fallback: number, min: number, max: number): number => {
  if (!Number.isFinite(value)) return fallback;
  const num = Number(value);
  if (Number.isNaN(num)) return fallback;
  return Math.min(Math.max(num, min), max);
};

export const normalizeWorkspaceSearchScope = (scope: WorkspaceSearchScope | string | undefined): WorkspaceSearchScope => {
  if (scope === "notes" || scope === "skills") return scope;
  return "all";
};

const getWorkspaceRoot = (): string => getWorkspaceDir();

const getBuiltInRoots = (): string[] => {
  const root = getWorkspaceRoot();
  return [path.join(root, "notes"), path.join(root, ".pi", "skills")];
};

const getConfiguredRoots = (): string[] => getWorkspaceSearchConfig().roots;

const getDefaultRoots = (): string[] => {
  const root = getWorkspaceRoot();
  const configured = getConfiguredRoots();
  const resolved = configured.map((entry) => {
    const trimmed = entry.trim();
    if (!trimmed) return "";
    return path.isAbsolute(trimmed) ? path.resolve(trimmed) : path.join(root, trimmed);
  }).filter(Boolean);
  return resolved.length > 0 ? resolved : getBuiltInRoots();
};

const toRelative = (absPath: string): string => {
  const workspaceRoot = getWorkspaceRoot();
  if (absPath === workspaceRoot) return ".";
  if (absPath.startsWith(workspaceRoot + path.sep)) {
    return absPath.slice(workspaceRoot.length + 1);
  }
  return absPath;
};

function getIndexedExtensions(): Set<string> {
  const extras = getWorkspaceSearchConfig().extraExtensions;
  if (!extras || extras.length === 0) return DEFAULT_EXTS;
  const merged = new Set(DEFAULT_EXTS);
  for (const ext of extras) {
    const normalized = ext.startsWith(".") ? ext.toLowerCase() : `.${ext.toLowerCase()}`;
    merged.add(normalized);
  }
  return merged;
}

const isTextFile = (filePath: string): boolean => {
  const ext = path.extname(filePath).toLowerCase();
  return getIndexedExtensions().has(ext);
};

function shouldAggressivelyReleaseWorkspaceIndexMemory(): boolean {
  return process.env[AGGRESSIVE_WORKSPACE_INDEX_MEMORY_ENV] === "1";
}

function aggressivelyReleaseWorkspaceIndexMemory(): void {
  if (!shouldAggressivelyReleaseWorkspaceIndexMemory()) return;

  try {
    getDb().exec("PRAGMA shrink_memory;");
  } catch (error) {
    debugSuppressedError(log, "Failed to shrink SQLite memory during aggressive workspace indexing.", error, {
      operation: "workspace_search.refresh.shrink_memory",
    });
  }

  try {
    const gc = (globalThis as typeof globalThis & { gc?: () => void }).gc;
    if (typeof gc === "function") gc();
  } catch (error) {
    debugSuppressedError(log, "Failed to trigger runtime GC during aggressive workspace indexing.", error, {
      operation: "workspace_search.refresh.gc.global",
    });
  }

  try {
    const bunGc = (globalThis as typeof globalThis & { Bun?: { gc?: (force?: boolean) => void } }).Bun?.gc;
    if (typeof bunGc === "function") bunGc(true);
  } catch (error) {
    debugSuppressedError(log, "Failed to trigger Bun GC during aggressive workspace indexing.", error, {
      operation: "workspace_search.refresh.gc.bun",
    });
  }
}

async function walkFiles(root: string, validate: () => void, allowMissingRoot = true): Promise<string[]> {
  const files: string[] = [];
  let entries;
  try {
    validate(); entries = await fs.readdir(root, { withFileTypes: true }); validate();
  } catch (error) {
    validate();
    if (allowMissingRoot && (error as NodeJS.ErrnoException).code === "ENOENT") return [];
    throw error;
  }
  // Do not catch descendant failures at an optional-root boundary: a subtree
  // disappearing mid-walk is not evidence that the entire root is absent.
  for (const entry of entries) {
    const full = path.join(root, entry.name);
    if (entry.isDirectory()) {
      if (["node_modules", ".git", ".cache", "generated"].includes(entry.name)) continue;
      files.push(...await walkFiles(full, validate, false)); validate();
    } else if (entry.isFile()) files.push(full);
  }
  return files;
}

export function normalizeWorkspaceIndexRoots(scope: string | undefined): string[] {
  const access=workspaceIndexAccess();
  if(access.mode==='family-shared'){const selected=familyWorkspaceScope(scope);return (selected==='notes'?['notes/family']:selected==='skills'?['.pi/skills']:['notes/family','.pi/skills']).map(root=>path.resolve(access.workspace,root));}
  const configuredRoots = getDefaultRoots();
  const builtInRoots = getBuiltInRoots();
  if (!scope || scope === "all") return configuredRoots;
  if (scope === "notes") return [builtInRoots[0]];
  if (scope === "skills") return [builtInRoots[1]];
  return configuredRoots;
}

function rootsToStatusRoots(roots: string[]): string[] {
  return roots.map((root) => toRelative(path.resolve(root)));
}

function rootsToPrefixes(roots: string[]): string[] {
  return rootsToStatusRoots(roots).map((root) => {
    if (!root || root === ".") return "";
    return root.endsWith(path.sep) ? root : `${root}${path.sep}`;
  });
}

export function workspacePathMatchesRoots(relativePath: string, roots: string[]): boolean {
  const prefixes = rootsToPrefixes(roots);
  return prefixes.some((prefix) => prefix === "" || relativePath.startsWith(prefix));
}

function parseRootsJson(raw: string | null | undefined, fallback: string[]): string[] {
  if (!raw) return fallback;
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.filter((entry) => typeof entry === "string") : fallback;
  } catch {
    return fallback;
  }
}

function getStatusRow(scope: WorkspaceSearchScope): WorkspaceIndexStatusRow | undefined {
  const db = getDb();
  return db.prepare(
    "SELECT scope, state, last_indexed_at, last_error, indexed_file_count, roots_json, updated_at FROM workspace_index_status WHERE scope = ?",
  ).get(scope) as WorkspaceIndexStatusRow | undefined;
}

function countIndexedFilesForRoots(roots: string[]): number {
  const db = getDb();
  const rows = db.prepare("SELECT path FROM workspace_files").all() as Array<{ path: string }>;
  return rows.reduce((count, row) => count + (workspacePathMatchesRoots(row.path, roots) ? 1 : 0), 0);
}

function buildStatusSnapshot(scope: WorkspaceSearchScope, roots: string[], row?: WorkspaceIndexStatusRow): WorkspaceIndexStatus {
  const fallbackRoots = rootsToStatusRoots(roots);
  return {
    scope,
    state: activeIndexScopes.has(scope) ? "indexing" : (row?.state ?? "never_indexed"),
    last_indexed_at: row?.last_indexed_at ?? null,
    last_error: row?.last_error ?? null,
    indexed_file_count: row?.indexed_file_count ?? 0,
    roots: parseRootsJson(row?.roots_json, fallbackRoots),
    updated_at: row?.updated_at ?? null,
  };
}

function upsertStatus(
  scope: WorkspaceSearchScope,
  state: Exclude<WorkspaceIndexState, "never_indexed">,
  roots: string[],
  options?: {
    lastIndexedAt?: string | null;
    lastError?: string | null;
    indexedFileCount?: number;
  },
): void {
  const db = getDb();
  const now = new Date().toISOString();
  const rootsJson = JSON.stringify(rootsToStatusRoots(roots));
  db.prepare(`
    INSERT INTO workspace_index_status (
      scope,
      state,
      last_indexed_at,
      last_error,
      indexed_file_count,
      roots_json,
      updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(scope) DO UPDATE SET
      state = excluded.state,
      last_indexed_at = excluded.last_indexed_at,
      last_error = excluded.last_error,
      indexed_file_count = excluded.indexed_file_count,
      roots_json = excluded.roots_json,
      updated_at = excluded.updated_at
  `).run(
    scope,
    state,
    options?.lastIndexedAt ?? null,
    options?.lastError ?? null,
    options?.indexedFileCount ?? 0,
    rootsJson,
    now,
  );
}

async function indexWorkspace(roots: string[], maxBytes: number,validate:()=>void): Promise<void> {
  validate();
  const db = getDb();
  const seen = new Set<string>();
  const now = new Date().toISOString();
  const rootPrefixes = rootsToPrefixes(roots);
  // FTS path is UNINDEXED. Resolve rowids once rather than scanning the whole
  // virtual table for every unchanged file during content verification.
  const indexedRows = new Map<string, { rowid: number; count: number }>();
  for (const row of db.prepare("SELECT rowid, path FROM workspace_fts").all() as Array<{ rowid: number; path: string }>) {
    const existing = indexedRows.get(row.path);
    indexedRows.set(row.path, { rowid: row.rowid, count: (existing?.count ?? 0) + 1 });
  }
  const removeFile = db.transaction((relativePath: string) => {
    validate();
    db.prepare("DELETE FROM workspace_fts WHERE path = ?").run(relativePath);
    db.prepare("DELETE FROM workspace_files WHERE path = ?").run(relativePath);
  });
  let processedFileCount = 0;

  for (const root of roots) {
    const absRoot = path.resolve(root);
    const files = await walkFiles(absRoot,validate);validate();
    for (const file of files) {
      if (!isTextFile(file)) continue;
      const rel = toRelative(file);
      try {
        validate();const stat = await fs.stat(file);validate();
        if (stat.size > maxBytes) {
          removeFile(rel);
          continue;
        }

        seen.add(rel);
        const existing = db.prepare("SELECT mtime_ms, size_bytes FROM workspace_files WHERE path = ?").get(rel) as { mtime_ms: number; size_bytes: number } | undefined;
        const mtimeMs = Math.round(stat.mtimeMs);
        // Metadata is a hint, not content identity: editors can restore mtime
        // after an equal-length rewrite. Verify against the text already in FTS
        // so existing databases need no hash backfill or schema migration.
        const handle = await fs.open(file, 'r');
        let content: string;
        try {
          validate();
          // Read at most the admitted size plus a growth sentinel. A file that
          // grows after stat cannot allocate an unbounded readFile buffer.
          const buffer = Buffer.alloc(stat.size + 1);
          let size = 0;
          while (size < buffer.length) {
            const read = await handle.read(buffer, size, buffer.length - size, null);validate();
            if (!read.bytesRead) break;
            size += read.bytesRead;
          }
          const after = await handle.stat();validate();
          const current = await fs.stat(file);validate();
          if (size !== stat.size || after.size !== stat.size || after.mtimeMs !== stat.mtimeMs || after.ctimeMs !== stat.ctimeMs || after.ino !== stat.ino || after.dev !== stat.dev || current.ino !== after.ino || current.dev !== after.dev || current.size !== after.size || current.mtimeMs !== after.mtimeMs || current.ctimeMs !== after.ctimeMs) {
            throw new Error('Workspace source changed during refresh.');
          }
          content = buffer.subarray(0, size).toString('utf8');
        } finally { await handle.close(); }
        validate();
        if (existing && existing.mtime_ms === mtimeMs && existing.size_bytes === stat.size) {
          const row = indexedRows.get(rel);
          const indexed = row?.count !== 1 ? undefined : db.prepare("SELECT content FROM workspace_fts WHERE rowid = ?").get(row.rowid) as { content: string } | undefined;
          if (indexed?.content === content) continue;
        }
        db.transaction(() => {
          validate();
          db.prepare("DELETE FROM workspace_fts WHERE path = ?").run(rel);
          db.prepare("INSERT INTO workspace_fts (content, path, mtime_ms, size_bytes) VALUES (?, ?, ?, ?)").run(content, rel, mtimeMs, stat.size);
          db.prepare(
            "INSERT INTO workspace_files (path, mtime_ms, size_bytes, indexed_at) VALUES (?, ?, ?, ?) ON CONFLICT(path) DO UPDATE SET mtime_ms = excluded.mtime_ms, size_bytes = excluded.size_bytes, indexed_at = excluded.indexed_at",
          ).run(rel, mtimeMs, stat.size, now);
        })();
        content = "";
        processedFileCount += 1;
        if (processedFileCount % AGGRESSIVE_WORKSPACE_INDEX_GC_EVERY_FILES === 0) {
          aggressivelyReleaseWorkspaceIndexMemory();
        }
      } catch (err) {
        validate();if(err instanceof WorkspaceIndexAccessDenied)throw err;
        log.warn("Workspace index could not verify a file; refresh failed.", {
          err,
          operation: "workspace_search.refresh.read_file",
          path: rel,
        });
        throw err;
      }
    }
  }

  validate();const existingPaths = db.prepare("SELECT path FROM workspace_files UNION SELECT path FROM workspace_fts").all() as Array<{ path: string }>;
  for (const row of existingPaths) {
    const inScope = rootPrefixes.some((prefix) => prefix === "" || row.path.startsWith(prefix));
    if (!inScope) continue;
    if (!seen.has(row.path)) {
      removeFile(row.path);
    }
  }

  aggressivelyReleaseWorkspaceIndexMemory();
}

export function getAffectedWorkspaceIndexScopes(paths: string[]): WorkspaceSearchScope[] {
  const relativePaths = paths
    .map((entry) => String(entry || "").trim())
    .filter(Boolean)
    .map((entry) => entry.startsWith(getWorkspaceRoot()) ? toRelative(path.resolve(entry)) : entry);

  const scopes = new Set<WorkspaceSearchScope>();
  for (const scope of ["notes", "skills", "all"] as const) {
    const roots = normalizeWorkspaceIndexRoots(scope);
    if (relativePaths.some((entry) => workspacePathMatchesRoots(entry, roots))) {
      scopes.add(scope);
    }
  }
  return Array.from(scopes);
}

export function getWorkspaceIndexStatus(params?: { scope?: WorkspaceSearchScope | string }): WorkspaceIndexStatus {
  const access=workspaceIndexAccess();if(access.mode==='family-shared')return familyWorkspaceIndexStatus(params?.scope);
  const scope = normalizeWorkspaceSearchScope(params?.scope);
  const roots = normalizeWorkspaceIndexRoots(scope);
  return buildStatusSnapshot(scope, roots, getStatusRow(scope));
}

export function markWorkspaceIndexCoreStale(params?: { scope?: WorkspaceSearchScope | string; paths?: string[] }): WorkspaceSearchScope[] {
  const access=workspaceIndexAccess();if(access.mode==='family-shared')return staleFamilyWorkspaceIndex(params);
  const explicitScope = params?.paths?.length ? null : normalizeWorkspaceSearchScope(params?.scope);
  const scopes = explicitScope ? [explicitScope] : getAffectedWorkspaceIndexScopes(params?.paths || []);

  for (const scope of scopes) {
    const roots = normalizeWorkspaceIndexRoots(scope);
    const row = getStatusRow(scope);
    if (row) {
      if (row.state === "failed") continue;
      upsertStatus(scope, "stale", roots, {
        lastIndexedAt: row.last_indexed_at,
        lastError: row.last_error,
        indexedFileCount: row.indexed_file_count,
      });
    }
  }
  return scopes;
}

export async function refreshWorkspaceIndex(params?: { scope?: WorkspaceSearchScope | string; max_kb?: number }): Promise<WorkspaceIndexStatus> {
  const access=workspaceIndexAccess();if(access.mode==='family-shared')return refreshFamilyWorkspaceIndex(params);
  const database=getDb();let denied=false;
  const validate=()=>{access.validate();if(denied||getDb()!==database){denied=true;throw new WorkspaceIndexAccessDenied();}};
  const scope = normalizeWorkspaceSearchScope(params?.scope);
  const roots = normalizeWorkspaceIndexRoots(scope);
  const maxBytes = clampNumber(params?.max_kb, 512, 16, 2048) * 1024;
  const previous = getStatusRow(scope);

  // Guard actual root overlap, not every active scope: notes and skills can
  // refresh independently, and configured all-roots need not contain either.
  // Separate processes retain the existing SQLite concurrency contract.
  const overlaps = (left: string, right: string) => {
    const contains = (parent: string, child: string) => {
      const relative = path.relative(parent, child);
      return !relative || (relative !== '..' && !relative.startsWith('..' + path.sep) && !path.isAbsolute(relative));
    };
    return contains(path.resolve(left), path.resolve(right)) || contains(path.resolve(right), path.resolve(left));
  };
  if (activeIndexScopes.has(scope) || [...activeIndexScopes.values()].some(activeRoots => activeRoots.some(activeRoot => roots.some(root => overlaps(activeRoot, root))))) {
    throw new Error("Workspace index refresh already active for overlapping roots.");
  }
  activeIndexScopes.set(scope, roots);
  try {
    upsertStatus(scope, "indexing", roots, {
      lastIndexedAt: previous?.last_indexed_at ?? null,
      lastError: null,
      indexedFileCount: previous?.indexed_file_count ?? 0,
    });
    await indexWorkspace(roots, maxBytes,validate);validate();
    const indexedAt = new Date().toISOString();
    upsertStatus(scope, "ready", roots, {
      lastIndexedAt: indexedAt,
      lastError: null,
      indexedFileCount: countIndexedFilesForRoots(roots),
    });
    activeIndexScopes.delete(scope);
    return buildStatusSnapshot(scope, roots, getStatusRow(scope));
  } catch (error) {
    validate();if(error instanceof WorkspaceIndexAccessDenied)throw error;
    upsertStatus(scope, "failed", roots, {
      lastIndexedAt: previous?.last_indexed_at ?? null,
      lastError: error instanceof Error ? error.message : String(error),
      indexedFileCount: previous?.indexed_file_count ?? 0,
    });
    throw error;
  } finally {
    activeIndexScopes.delete(scope);
  }
}
