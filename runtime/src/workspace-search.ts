/**
 * workspace-search.ts – Public full-text search surface over workspace files.
 *
 * Indexing contracts and refresh/status implementation live in
 * workspace-index-core.ts. This module owns the user-facing search API and the
 * optional background-refresh request hook.
 */

import { getDb } from "./db.js";
import { getSearchMatchMode } from "./core/config.js";
import { extractFtsFallbackTerms, isFtsOperatorQuery, prepareFtsQuery } from "./utils/fts-query.js";
import { createLogger, debugSuppressedError } from "./utils/logger.js";
import { workspaceIndexAccess,WorkspaceIndexAccessDenied } from './core/workspace-index-access.js';
import { familyWorkspaceScope,searchFamilyWorkspaceIndex } from './family-workspace-index.js';
import {
  getWorkspaceIndexStatus,
  markWorkspaceIndexCoreStale,
  normalizeWorkspaceSearchScope,
  refreshWorkspaceIndex,
  type WorkspaceIndexBackgroundRefreshParams,
  type WorkspaceIndexState,
  type WorkspaceIndexStatus,
  type WorkspaceSearchScope,
} from "./workspace-index-core.js";

const log = createLogger("workspace-search");

export type {
  WorkspaceIndexBackgroundRefreshParams,
  WorkspaceIndexState,
  WorkspaceIndexStatus,
  WorkspaceSearchScope,
};
export { getWorkspaceIndexStatus, refreshWorkspaceIndex };

/** Parameters accepted by searchWorkspace(). */
export type WorkspaceSearchParams = {
  /** FTS5 query string. */
  query: string;
  /** Restrict results to a specific scope. */
  scope?: WorkspaceSearchScope | string;
  /** Maximum number of results to return (default 10, max 50). */
  limit?: number;
  /** Pagination offset (default 0). */
  offset?: number;
  /** Whether to re-index before searching (default false; true forces blocking refresh). */
  refresh?: boolean;
  /** Maximum file size in KB to index (default 512). */
  max_kb?: number;
};

import type { WorkspaceSearchRow,WorkspaceSearchResult } from './core/workspace-index-types.js';
export type { WorkspaceSearchRow,WorkspaceSearchResult } from './core/workspace-index-types.js';

let requestBackgroundWorkspaceIndexRefreshImpl = (params: WorkspaceIndexBackgroundRefreshParams = {}): void => {
  const access=workspaceIndexAccess();
  void import("./workspace-index-process.js")
    .then((mod) => {
      access.validate();
      mod.launchWorkspaceIndexProcess({ scope: params.scope, max_kb: params.max_kb });
    })
    .catch((error) => {
      debugSuppressedError(log, "Failed to request background workspace index refresh.", error, {
        operation: "workspace_search.background_refresh.import",
        scope: params.scope,
        maxKb: params.max_kb,
      });
    });
};

const clampNumber = (value: number | undefined, fallback: number, min: number, max: number): number => {
  if (!Number.isFinite(value)) return fallback;
  const num = Number(value);
  if (Number.isNaN(num)) return fallback;
  return Math.min(Math.max(num, min), max);
};

export function requestBackgroundWorkspaceIndexRefresh(params?: WorkspaceIndexBackgroundRefreshParams): void {
  workspaceIndexAccess();
  requestBackgroundWorkspaceIndexRefreshImpl(params || {});
}

export function setBackgroundWorkspaceIndexRefreshRequesterForTests(
  requester: ((params?: WorkspaceIndexBackgroundRefreshParams) => void) | null,
): void {
  requestBackgroundWorkspaceIndexRefreshImpl = requester ?? ((params: WorkspaceIndexBackgroundRefreshParams = {}) => {
    const access=workspaceIndexAccess();
    void import("./workspace-index-process.js")
      .then((mod) => {
        access.validate();
        mod.launchWorkspaceIndexProcess({ scope: params.scope, max_kb: params.max_kb });
      })
      .catch((error) => {
        debugSuppressedError(log, "Failed to request background workspace index refresh.", error, {
          operation: "workspace_search.background_refresh.import",
          scope: params.scope,
          maxKb: params.max_kb,
        });
      });
  });
}

export function markWorkspaceIndexStale(params?: { scope?: WorkspaceSearchScope | string; paths?: string[] }): void {
  for (const scope of markWorkspaceIndexCoreStale(params)) {
    requestBackgroundWorkspaceIndexRefresh({ scope });
  }
}

/** Full-text search across indexed workspace files. */
export async function searchWorkspace(params: WorkspaceSearchParams): Promise<WorkspaceSearchResult> {
  const access=workspaceIndexAccess();
  const query = params.query.trim();
  const limit = clampNumber(params.limit, 10, 1, 50);
  const offset = clampNumber(params.offset, 0, 0, 1_000_000);
  const refresh = params.refresh === true;
  const scope = access.mode==='family-shared'?familyWorkspaceScope(params.scope):normalizeWorkspaceSearchScope(params.scope);

  if (!query) {
    return { rows: [], limit, offset, error: "Provide a query." };
  }

  if (refresh) {
    await refreshWorkspaceIndex({ scope, max_kb: params.max_kb });
  } else {
    const status = getWorkspaceIndexStatus({ scope });
    if (status.state !== "ready") {
      requestBackgroundWorkspaceIndexRefresh({ scope, max_kb: params.max_kb });
    }
  }

  access.validate();
  if(access.mode==='family-shared')return searchFamilyWorkspaceIndex(query,scope,limit,offset);

  const operatorQuery = isFtsOperatorQuery(query);
  const ftsQuery = prepareFtsQuery(query, getSearchMatchMode());
  if (!ftsQuery) {
    return { rows: [], limit, offset, error: "Query is empty after sanitization." };
  }

  const db = getDb();
  try {
    const prefix = scope === "notes" ? "notes/%" : scope === "skills" ? ".pi/skills/%" : null;

    const stmt = prefix
      ? "SELECT path, size_bytes, mtime_ms, snippet(workspace_fts, 0, '[', ']', '…', 12) as snippet FROM workspace_fts WHERE workspace_fts MATCH ? AND path LIKE ? ORDER BY bm25(workspace_fts) LIMIT ? OFFSET ?"
      : "SELECT path, size_bytes, mtime_ms, snippet(workspace_fts, 0, '[', ']', '…', 12) as snippet FROM workspace_fts WHERE workspace_fts MATCH ? ORDER BY bm25(workspace_fts) LIMIT ? OFFSET ?";

    const rows = prefix
      ? (db.prepare(stmt).all(ftsQuery, prefix, limit, offset) as WorkspaceSearchRow[])
      : (db.prepare(stmt).all(ftsQuery, limit, offset) as WorkspaceSearchRow[]);

    access.validate();return { rows, limit, offset };
  } catch (error) {
    access.validate();if(error instanceof WorkspaceIndexAccessDenied)throw error;
    // FTS query failed even after sanitization — fall back to LIKE.
    try {
      const prefix = scope === "notes" ? "notes/%" : scope === "skills" ? ".pi/skills/%" : null;
      const terms = extractFtsFallbackTerms(query, { dropFtsKeywords: operatorQuery }).map((term) => `%${term}%`);
      if (terms.length === 0) return { rows: [], limit, offset, error: "No searchable terms." };

      const likeClauses = terms.map(() => "workspace_fts.content LIKE ? COLLATE NOCASE").join(" AND ");
      const conditions = prefix ? `${likeClauses} AND workspace_files.path LIKE ?` : likeClauses;
      const params_arr = prefix ? [...terms, prefix] : terms;

      const sql = `SELECT workspace_files.path AS path, workspace_files.size_bytes AS size_bytes, workspace_files.mtime_ms AS mtime_ms, substr(workspace_fts.content, 1, 200) as snippet FROM workspace_files JOIN workspace_fts ON workspace_fts.path = workspace_files.path WHERE ${conditions} LIMIT ? OFFSET ?`;
      const rows = db.prepare(sql).all(...params_arr, limit, offset) as WorkspaceSearchRow[];
      access.validate();return { rows, limit, offset };
    } catch (error) {
      access.validate();if(error instanceof WorkspaceIndexAccessDenied)throw error;
      return { rows: [], limit, offset, error: "Workspace search failed (invalid query?)." };
    }
  }
}
