/**
 * test/channels/web/workspace-service.test.ts – Tests for the workspace explorer service.
 *
 * Verifies tree cache TTL, update throttling, file read/write, and
 * directory creation through the WorkspaceService.
 */

import { afterEach, expect, test } from "bun:test";
import { rmSync } from "node:fs";
import fs from "node:fs/promises";
import path from "node:path";

import { getTestWorkspace, importFresh, setEnv } from "../../helpers.js";

let restoreEnv: (() => void) | null = null;
let cleanupWorkspace: (() => void) | null = null;

afterEach(() => {
  restoreEnv?.();
  restoreEnv = null;
  cleanupWorkspace?.();
  cleanupWorkspace = null;
});

test("workspace tree cache reuses responses briefly", async () => {
  const ws = getTestWorkspace();
  restoreEnv = setEnv({ PICLAW_WORKSPACE: ws.workspace, PICLAW_STORE: ws.store, PICLAW_DATA: ws.data });

  const [{ WorkspaceService }, { WORKSPACE_DIR }] = await Promise.all([
    importFresh<typeof import("../src/channels/web/workspace/service.js")>("../src/channels/web/workspace/service.js"),
    import("../../../src/core/config.js"),
  ]);
  await fs.mkdir(WORKSPACE_DIR, { recursive: true });

  const service = new WorkspaceService();
  const originalNow = Date.now;
  try {
    Date.now = () => 1_000_000;
    const first = service.getTree("", "2", false);
    const second = service.getTree("", "2", false);
    expect(first.status).toBe(200);
    expect(second.status).toBe(200);
    expect(second.body).toBe(first.body);

    Date.now = () => 1_001_101;
    const third = service.getTree("", "2", false);
    expect(third.status).toBe(200);
    expect(third.body).not.toBe(first.body);
  } finally {
    Date.now = originalNow;
  }
});

test("workspace update throttle delays bursts", async () => {
  const { createWorkspaceUpdateThrottle } = await import(
    "../../../src/channels/web/workspace/watcher.js"
  );

  const updates: Array<Array<{ path: string }>> = [];
  const throttler = createWorkspaceUpdateThrottle((batch) => {
    updates.push(batch as Array<{ path: string }>);
  }, 50);

  throttler.schedule([{ path: "a", root: {}, truncated: false }]);
  throttler.schedule([{ path: "b", root: {}, truncated: false }]);

  expect(updates.length).toBe(1);
  expect(updates[0][0].path).toBe("a");

  await new Promise((resolve) => setTimeout(resolve, 80));
  expect(updates.length).toBe(2);
  expect(updates[1][0].path).toBe("b");

  throttler.clear();
});

// --- New coverage: tree depth clamp, hidden files, and truncation ---

test("workspace tree clamps depth and respects hidden files", async () => {
  const { WorkspaceService } = await importFresh<typeof import("../src/channels/web/workspace/service.js")>(
    "../src/channels/web/workspace/service.js"
  );
  const { resolveWorkspacePath } = await import("../../../src/channels/web/workspace/paths.js");
  const fs = await import("node:fs/promises");
  const path = await import("node:path");

  const rootPath = resolveWorkspacePath("")!;
  const testDirName = `web-tree-test-${Math.random().toString(36).slice(2, 8)}`;
  const base = path.join(rootPath, testDirName);
  cleanupWorkspace = () => {
    void fs.rm(base, { recursive: true, force: true });
  };

  await fs.mkdir(path.join(base, "deep", "child"), { recursive: true });
  await fs.writeFile(path.join(base, "deep", "child", "file.txt"), "hello");
  await fs.writeFile(path.join(base, ".hidden.txt"), "hidden");

  const service = new WorkspaceService();

  // depth 0 should clamp to 1 → root children exist, but no grandchildren
  const depth0 = service.getTree(testDirName, "0", false);
  expect(depth0.status).toBe(200);
  const root0 = (depth0.body as any).root;
  expect(Array.isArray(root0.children)).toBe(true);
  expect(root0.children.length).toBeGreaterThan(0);
  expect(root0.children.every((c: any) => c.children === undefined)).toBe(true);
  expect(root0.children.filter((c: any) => c.type === "dir").every((c: any) => Number.isInteger(c.child_count))).toBe(true);

  // includeHidden=false should not include hidden files
  const names0 = root0.children?.map((c: any) => c.name) || [];
  expect(names0).not.toContain(".hidden.txt");

  // includeHidden=true should include hidden files
  const withHidden = service.getTree(testDirName, "1", true);
  const rootHidden = (withHidden.body as any).root;
  const namesHidden = rootHidden.children?.map((c: any) => c.name) || [];
  expect(namesHidden).toContain(".hidden.txt");
});

test("workspace watch path filtering excludes internal runtime state by default", async () => {
  const ws = getTestWorkspace();
  restoreEnv = setEnv({ PICLAW_WORKSPACE: ws.workspace, PICLAW_STORE: ws.store, PICLAW_DATA: ws.data });

  const { shouldIgnoreWatchPath, resolveWorkspacePath } = await importFresh<typeof import("../src/channels/web/workspace/paths.js")>(
    "../src/channels/web/workspace/paths.js"
  );
  const path = await import("node:path");
  const rootPath = resolveWorkspacePath("")!;

  expect(shouldIgnoreWatchPath(path.join(rootPath, ".piclaw", "data"), false)).toBe(true);
  expect(shouldIgnoreWatchPath(path.join(rootPath, ".pi", "skills"), true)).toBe(true);
  expect(shouldIgnoreWatchPath(path.join(rootPath, "exports", "report.csv"), false)).toBe(true);
  expect(shouldIgnoreWatchPath(path.join(rootPath, ".github", "workflows"), false)).toBe(true);
  expect(shouldIgnoreWatchPath(path.join(rootPath, ".github", "workflows"), true)).toBe(false);
  expect(shouldIgnoreWatchPath(path.join(rootPath, "src", "index.ts"), false)).toBe(false);
});

test("workspace tree truncates when entry cap is reached", async () => {
  const ws = getTestWorkspace();
  restoreEnv = setEnv({ PICLAW_WORKSPACE: ws.workspace, PICLAW_STORE: ws.store, PICLAW_DATA: ws.data });

  const { buildTree } = await import("../../../src/channels/web/workspace/tree.js");
  const { MAX_TREE_ENTRIES } = await import("../../../src/channels/web/workspace/constants.js");
  const { resolveWorkspacePath } = await import("../../../src/channels/web/workspace/paths.js");

  const rootPath = resolveWorkspacePath("")!;
  const state = { count: MAX_TREE_ENTRIES, truncated: false };

  const tree = buildTree(rootPath, 1, state, { includeHidden: false });
  expect(state.truncated).toBe(true);
  expect(tree.children).toBeUndefined();
});

test("workspace service exposes index status and marks it stale after file writes", async () => {
  const ws = getTestWorkspace();
  restoreEnv = setEnv({ PICLAW_WORKSPACE: ws.workspace, PICLAW_STORE: ws.store, PICLAW_DATA: ws.data });

  const db = await importFresh<typeof import("../src/db.js")>("../src/db.js");
  db.initDatabase();
  const { WorkspaceService } = await importFresh<typeof import("../src/channels/web/workspace/service.js")>(
    "../src/channels/web/workspace/service.js"
  );
  const { resolveWorkspacePath } = await importFresh<typeof import("../src/channels/web/workspace/paths.js")>(
    "../src/channels/web/workspace/paths.js"
  );
  const { DATA_DIR } = await importFresh<typeof import("../src/core/config.js")>("../src/core/config.js");

  const workspaceRoot = resolveWorkspacePath("")!;
  const notesDir = path.join(workspaceRoot, "notes");
  const workspaceSearchDir = path.join(DATA_DIR, "workspace-search");
  rmSync(notesDir, { recursive: true, force: true });
  rmSync(workspaceSearchDir, { recursive: true, force: true });
  await fs.mkdir(notesDir, { recursive: true });
  await fs.writeFile(path.join(notesDir, "alpha.md"), "alpha workspace status");

  const service = new WorkspaceService();
  const initial = service.getIndexStatus("notes");
  expect((initial.body as any).state).toBe("never_indexed");

  const reindexed = await service.reindex("notes");
  expect((reindexed.body as any).state).toBe("ready");
  expect(typeof (reindexed.body as any).indexed_file_count).toBe("number");

  const updated = await service.updateFile("notes/alpha.md", "alpha workspace status updated");
  expect(updated.status).toBe(200);

  const stale = service.getIndexStatus("notes");
  expect((stale.body as any).state).toBe("stale");
  expect((stale.body as any).last_indexed_at).toBeTruthy();
});
