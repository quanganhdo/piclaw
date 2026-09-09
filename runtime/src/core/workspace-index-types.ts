/** Shared type-only contracts for legacy and family workspace indexes. */
export type WorkspaceSearchScope = 'notes' | 'skills' | 'all';
export type WorkspaceIndexState = 'never_indexed' | 'indexing' | 'ready' | 'stale' | 'failed';
export type WorkspaceIndexStatus = {
  scope:WorkspaceSearchScope; state:WorkspaceIndexState; last_indexed_at:string|null;
  last_error:string|null; indexed_file_count:number; roots:string[]; updated_at:string|null;
};
/** A single search result row with snippet and file metadata. */
export type WorkspaceSearchRow = {
  /** Relative path from workspace root. */
  path:string;
  /** FTS5-highlighted snippet around matching terms. */
  snippet:string;
  /** File size in bytes. */
  size_bytes:number;
  /** File modification time in epoch milliseconds. */
  mtime_ms:number;
};
export type WorkspaceSearchResult = {rows:WorkspaceSearchRow[];limit:number;offset:number;error?:string};
