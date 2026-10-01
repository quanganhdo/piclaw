import { lstat, opendir, realpath } from "node:fs/promises";
import path from "node:path";

import { isWorkspaceIndexTextFile } from "../../../workspace-index-core.js";
import { workspaceIndexAccess, WorkspaceIndexAccessDenied } from "../../../core/workspace-index-access.js";
import {
  getWorkspaceIndexPolicy,
  saveWorkspaceIndexPolicy,
  validateWorkspaceIndexPolicy,
  workspaceIndexPathDecision,
  type WorkspaceIndexPolicy,
} from "../../../core/workspace-index-policy.js";
import {
  getWorkspaceIndexStatus,
  markWorkspaceIndexStale,
} from "../../../workspace-search.js";

export const WORKSPACE_INDEX_PREVIEW_LIMITS = Object.freeze({
  maxEntries: 2_000,
  maxDurationMs: 250,
  maxSamples: 100,
});

const WORKSPACE_INDEX_PREVIEW_MAX_BYTES = 512 * 1024;
export interface WorkspaceIndexPreviewSample {
  path: string;
  included: boolean;
  reason: string;
  rule?: string;
  type: "file" | "directory" | "symlink" | "other" | "error";
}

export interface WorkspaceIndexPreview {
  policy: WorkspaceIndexPolicy;
  scannedEntries: number;
  includedFiles: number;
  excludedEntries: number;
  truncated: boolean;
  elapsedMs: number;
  limits: typeof WORKSPACE_INDEX_PREVIEW_LIMITS;
  samples: WorkspaceIndexPreviewSample[];
}

function relativeWorkspacePath(workspace: string, absolutePath: string): string {
  const relative = path.relative(workspace, absolutePath);
  if (!relative || relative === ".") return ".";
  if (relative.startsWith("..") || path.isAbsolute(relative)) {
    throw new Error("Index roots must stay inside the workspace.");
  }
  return relative.split(path.sep).join("/");
}

function resolveIndexRoot(workspace: string, root: string): string {
  const resolved = path.resolve(workspace, root);
  relativeWorkspacePath(workspace, resolved);
  return resolved;
}

function entryType(stats: Awaited<ReturnType<typeof lstat>>): WorkspaceIndexPreviewSample["type"] {
  if (stats.isSymbolicLink()) return "symlink";
  if (stats.isDirectory()) return "directory";
  if (stats.isFile()) return "file";
  return "other";
}

/**
 * Inspect the paths selected by a draft policy without reading file contents.
 * The walk stays inside the real workspace, never follows symlinks, and stops
 * at fixed entry, sample and elapsed-time limits.
 */
export async function previewWorkspaceIndexPolicy(input: unknown): Promise<WorkspaceIndexPreview> {
  const access = workspaceIndexAccess();
  if (access.mode !== "single-user") throw new WorkspaceIndexAccessDenied();
  const policy = validateWorkspaceIndexPolicy(input);
  const workspace = path.resolve(access.workspace);
  const realWorkspace = await realpath(workspace);
  access.validate();
  const seen = new Set<string>();
  const startedAt = Date.now();
  const samples: WorkspaceIndexPreviewSample[] = [];
  let scannedEntries = 0;
  let includedFiles = 0;
  let excludedEntries = 0;
  let truncated = false;

  const outOfTime = () => Date.now() - startedAt >= WORKSPACE_INDEX_PREVIEW_LIMITS.maxDurationMs;
  const atLimit = () => scannedEntries >= WORKSPACE_INDEX_PREVIEW_LIMITS.maxEntries || outOfTime();
  const addSample = (sample: WorkspaceIndexPreviewSample) => {
    if (samples.length < WORKSPACE_INDEX_PREVIEW_LIMITS.maxSamples) samples.push(sample);
  };
  const exclude = (sample: Omit<WorkspaceIndexPreviewSample, "included">) => {
    excludedEntries += 1;
    addSample({ ...sample, included: false });
  };

  const walk = async (absolutePath: string, isRoot = false): Promise<void> => {
    if (atLimit()) {
      truncated = true;
      return;
    }

    access.validate();
    const relative = relativeWorkspacePath(workspace, absolutePath);
    if (seen.has(relative)) return;
    seen.add(relative);
    if (!isRoot) scannedEntries += 1;

    const decision = workspaceIndexPathDecision(relative, policy);
    if (!decision.included) {
      exclude({ path: relative, reason: decision.reason, rule: decision.rule, type: "other" });
      return;
    }

    let stats: Awaited<ReturnType<typeof lstat>>;
    try {
      stats = await lstat(absolutePath);
      access.validate();
    } catch (error) {
      if (error instanceof WorkspaceIndexAccessDenied) throw error;
      const code = (error as NodeJS.ErrnoException).code;
      exclude({
        path: relative,
        reason: code === "ENOENT" ? "Path does not exist." : "Path is not readable with current permissions.",
        type: "error",
      });
      return;
    }

    const type = entryType(stats);
    if (type === "symlink") {
      exclude({ path: relative, reason: "Symbolic links are not followed.", type });
      return;
    }
    if (type === "other") {
      exclude({ path: relative, reason: "Only regular files and directories can be indexed.", type });
      return;
    }

    // A symlink in any parent component changes the canonical path. Refuse it
    // even when its target happens to remain under the workspace.
    try {
      const canonical = await realpath(absolutePath);
      access.validate();
      const expected = relative === "." ? realWorkspace : path.resolve(realWorkspace, relative);
      if (canonical !== expected) {
        exclude({ path: relative, reason: "Paths reached through symbolic links are not followed.", type });
        return;
      }
    } catch (error) {
      if (error instanceof WorkspaceIndexAccessDenied) throw error;
      exclude({ path: relative, reason: "Path is not readable with current permissions.", type: "error" });
      return;
    }

    if (type === "file") {
      if (stats.nlink !== 1) {
        exclude({ path: relative, reason: "Files with multiple hard links are not indexed.", type });
        return;
      }
      if (!isWorkspaceIndexTextFile(relative)) {
        exclude({ path: relative, reason: "File type is not supported by workspace indexing.", type });
        return;
      }
      if (stats.size > WORKSPACE_INDEX_PREVIEW_MAX_BYTES) {
        exclude({ path: relative, reason: "File exceeds the 512 KiB indexing limit.", type });
        return;
      }
      includedFiles += 1;
      addSample({ path: relative, included: true, reason: decision.reason, rule: decision.rule, type });
      return;
    }

    let directory: Awaited<ReturnType<typeof opendir>>;
    try {
      directory = await opendir(absolutePath);
    } catch (error) {
      if (error instanceof WorkspaceIndexAccessDenied) throw error;
      exclude({ path: relative, reason: "Directory is not readable with current permissions.", type: "error" });
      return;
    }
    try {
      access.validate();
      const checkDirectory = async () => {
        const now=await lstat(absolutePath);access.validate();
        const canonical=await realpath(absolutePath);access.validate();
        if(!now.isDirectory()||now.isSymbolicLink()||now.dev!==stats.dev||now.ino!==stats.ino||canonical!==path.resolve(realWorkspace,relative))throw new Error('Preview directory changed; retry.');
      };
      await checkDirectory();
      for await (const entry of directory) {
        access.validate();
        if (atLimit()) {
          truncated = true;
          return;
        }
        await checkDirectory();
        await walk(path.join(absolutePath, entry.name));
        await checkDirectory();
        access.validate();
        if (truncated) return;
      }
    } finally {
      try {
        await directory.close();
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== "ERR_DIR_CLOSED") throw error;
      } finally {
        access.validate();
      }
    }
  };

  for (const root of policy.roots) {
    if (atLimit()) {
      truncated = true;
      break;
    }
    await walk(resolveIndexRoot(workspace, root), true);
    access.validate();
    if (truncated) break;
  }

  access.validate();
  return {
    policy,
    scannedEntries,
    includedFiles,
    excludedEntries,
    truncated,
    elapsedMs: Date.now() - startedAt,
    limits: WORKSPACE_INDEX_PREVIEW_LIMITS,
    samples,
  };
}

export function getWorkspaceIndexingData() {
  return {
    policy: getWorkspaceIndexPolicy(),
    status: getWorkspaceIndexStatus({ scope: "all" }),
  };
}

export function saveWorkspaceIndexingPolicy(input: unknown) {
  const policy = saveWorkspaceIndexPolicy(input);
  // Policy checks are live, so exclusions apply before the asynchronous index
  // reconciliation starts. The stale marker also queues the existing refresh
  // coordinator rather than doing a blocking index rebuild in the HTTP turn.
  markWorkspaceIndexStale({ scope: "all" });
  return { policy, status: getWorkspaceIndexStatus({ scope: "all" }) };
}

export function refreshWorkspaceIndexing() {
  markWorkspaceIndexStale({ scope: "all" });
  return { queued: true, status: getWorkspaceIndexStatus({ scope: "all" }) };
}
