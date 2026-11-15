import { afterEach, expect, test } from "bun:test";
import fs from "node:fs/promises";
import path from "node:path";

import { createTempWorkspace, getTestWorkspace, importFresh, setEnv } from "./helpers.js";

let restoreEnv: (() => void) | null = null;

afterEach(() => {
  restoreEnv?.();
  restoreEnv = null;
});

test("workspace search status tracks never-indexed, ready, and stale lifecycle", async () => {
  const ws = getTestWorkspace();
  restoreEnv = setEnv({
    PICLAW_WORKSPACE: ws.workspace,
    PICLAW_STORE: ws.store,
    PICLAW_DATA: ws.data,
  });

  await fs.rm(path.join(ws.workspace, "notes"), { recursive: true, force: true });
  await fs.rm(path.join(ws.data, "workspace-search"), { recursive: true, force: true });
  await fs.mkdir(path.join(ws.workspace, "notes"), { recursive: true });
  await fs.writeFile(path.join(ws.workspace, "notes", "alpha.md"), "alpha kittens");

  const db = await importFresh<typeof import("../src/db.js")>("../src/db.js");
  db.initDatabase();
  const workspaceSearch = await importFresh<typeof import("../src/workspace-search.js")>("../src/workspace-search.js");

  const initial = workspaceSearch.getWorkspaceIndexStatus({ scope: "notes" });
  expect(initial.state).toBe("never_indexed");
  expect(initial.indexed_file_count).toBe(0);

  const ready = await workspaceSearch.refreshWorkspaceIndex({ scope: "notes" });
  expect(ready.state).toBe("ready");
  expect(ready.indexed_file_count).toBe(1);
  expect(ready.roots).toEqual(["notes"]);
  expect(ready.last_indexed_at).toBeTruthy();

  await fs.writeFile(path.join(ws.workspace, "notes", "alpha.md"), "alpha kittens updated");
  await workspaceSearch.markWorkspaceIndexStale({ paths: ["notes/alpha.md"] });

  const stale = workspaceSearch.getWorkspaceIndexStatus({ scope: "notes" });
  expect(stale.state).toBe("stale");
  expect(stale.last_indexed_at).toBe(ready.last_indexed_at);
});

test("markWorkspaceIndexStale requests a background relaunch for affected scopes", async () => {
  const ws = createTempWorkspace("piclaw-workspace-search-stale-");
  const restore = setEnv({
    PICLAW_WORKSPACE: ws.workspace,
    PICLAW_STORE: ws.store,
    PICLAW_DATA: ws.data,
  });

  try {
    await fs.mkdir(path.join(ws.workspace, "notes"), { recursive: true });
    await fs.writeFile(path.join(ws.workspace, "notes", "alpha.md"), "alpha kittens");

    const db = await importFresh<typeof import("../src/db.js")>("../src/db.js");
    db.initDatabase();
    const workspaceSearch = await importFresh<typeof import("../src/workspace-search.js")>("../src/workspace-search.js");
    await workspaceSearch.refreshWorkspaceIndex({ scope: "notes" });

    const requests: Array<{ scope?: string; max_kb?: number }> = [];
    workspaceSearch.setBackgroundWorkspaceIndexRefreshRequesterForTests((params) => {
      requests.push({ scope: params?.scope as string | undefined, max_kb: params?.max_kb });
    });

    await workspaceSearch.markWorkspaceIndexStale({ paths: ["notes/alpha.md"] });
    expect(workspaceSearch.getWorkspaceIndexStatus({ scope: "notes" }).state).toBe("stale");
    expect(requests).toEqual([{ scope: "notes", max_kb: undefined }, { scope: "all", max_kb: undefined }]);

    workspaceSearch.setBackgroundWorkspaceIndexRefreshRequesterForTests(null);
  } finally {
    restore();
    ws.cleanup();
  }
});

test("non-blocking search requests a background relaunch when the index is missing", async () => {
  const ws = createTempWorkspace("piclaw-workspace-search-background-");
  const restore = setEnv({
    PICLAW_WORKSPACE: ws.workspace,
    PICLAW_STORE: ws.store,
    PICLAW_DATA: ws.data,
  });

  try {
    await fs.mkdir(path.join(ws.workspace, "notes"), { recursive: true });
    await fs.writeFile(path.join(ws.workspace, "notes", "alpha.md"), "alpha kittens");

    const db = await importFresh<typeof import("../src/db.js")>("../src/db.js");
    db.initDatabase();
    const workspaceSearch = await importFresh<typeof import("../src/workspace-search.js")>("../src/workspace-search.js");

    const requests: Array<{ scope?: string; max_kb?: number }> = [];
    workspaceSearch.setBackgroundWorkspaceIndexRefreshRequesterForTests((params) => {
      requests.push({ scope: params?.scope as string | undefined, max_kb: params?.max_kb });
    });

    const result = await workspaceSearch.searchWorkspace({ query: "alpha", scope: "notes", refresh: false });
    expect(result.rows).toEqual([]);
    expect(requests).toEqual([{ scope: "notes", max_kb: undefined }]);

    workspaceSearch.setBackgroundWorkspaceIndexRefreshRequesterForTests(null);
  } finally {
    restore();
    ws.cleanup();
  }
});
