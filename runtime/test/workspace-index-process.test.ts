import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { EventEmitter } from "node:events";
import fs from "node:fs/promises";
import path from "node:path";

import { initDatabase } from "../src/db.js";
import { getWorkspaceIndexStatus, searchWorkspace } from "../src/workspace-search.js";
import {
  AGGRESSIVE_WORKSPACE_INDEX_MEMORY_ENV,
  DISABLE_BACKGROUND_WORKSPACE_INDEX_ENV,
  launchWorkspaceIndexProcess,
  resetWorkspaceIndexLauncherForTests,
  runWorkspaceIndexProcessFromArgs,
  setWorkspaceIndexProcessFinalizeForTests,
  setWorkspaceIndexSpawnForTests,
} from "../src/workspace-index-process.js";
import { createTempWorkspace, setEnv } from "./helpers.js";

class FakeChild extends EventEmitter {
  exitCode: number | null = null;
  killed = false;
  unrefCalled = false;

  unref(): void {
    this.unrefCalled = true;
  }
}

describe("workspace index background process", () => {
  let ws: ReturnType<typeof createTempWorkspace>;
  let restoreEnv: (() => void) | null = null;

  beforeEach(async () => {
    ws = createTempWorkspace("piclaw-workspace-index-process-");
    restoreEnv = setEnv({
      PICLAW_WORKSPACE: ws.workspace,
      PICLAW_STORE: ws.store,
      PICLAW_DATA: ws.data,
      PICLAW_DB_IN_MEMORY: "1",
      [DISABLE_BACKGROUND_WORKSPACE_INDEX_ENV]: undefined,
    });
    initDatabase();
    await fs.mkdir(path.join(ws.workspace, "notes"), { recursive: true });
    await fs.writeFile(path.join(ws.workspace, "notes", "alpha.md"), "alpha kittens");
    resetWorkspaceIndexLauncherForTests();
  });

  afterEach(() => {
    resetWorkspaceIndexLauncherForTests();
    restoreEnv?.();
    restoreEnv = null;
    ws.cleanup();
  });

  test("launches a detached background process when the workspace index is not ready", () => {
    const calls: Array<{ command: string; args: string[]; options: Record<string, unknown> }> = [];
    const child = new FakeChild();
    setWorkspaceIndexSpawnForTests((command, args, options) => {
      calls.push({ command, args, options: options as Record<string, unknown> });
      return child as unknown as any;
    });

    const launched = launchWorkspaceIndexProcess({ scope: "notes", max_kb: 64 });

    expect(launched).toBe(true);
    expect(calls).toHaveLength(1);
    expect(calls[0].command).toBe(process.execPath);
    expect(calls[0].args[0]).toContain("workspace-index-process.ts");
    expect(calls[0].args).toEqual([expect.any(String), "--scope", "notes", "--max-kb", "64", "--expected-mode", "single-user"]);
    expect(calls[0].options.stdio).toBe("ignore");
    expect((calls[0].options.env as Record<string, string | undefined>)[AGGRESSIVE_WORKSPACE_INDEX_MEMORY_ENV]).toBe("1");
    expect(child.unrefCalled).toBe(true);
  });

  test("does not relaunch while a background index process is still active", () => {
    const child = new FakeChild();
    let launches = 0;
    setWorkspaceIndexSpawnForTests(() => {
      launches += 1;
      return child as unknown as any;
    });

    expect(launchWorkspaceIndexProcess({ scope: "all" })).toBe(true);
    expect(launchWorkspaceIndexProcess({ scope: "all" })).toBe(false);
    expect(launches).toBe(1);

    child.exitCode = 0;
    child.emit("exit", 0);
    expect(launchWorkspaceIndexProcess({ scope: "all" })).toBe(true);
    expect(launches).toBe(2);
  });

  test("does not launch when the index is already ready", async () => {
    setWorkspaceIndexProcessFinalizeForTests(() => {});
    await runWorkspaceIndexProcessFromArgs(["--scope", "notes", "--expected-mode", "single-user"]);

    let called = false;
    setWorkspaceIndexSpawnForTests(() => {
      called = true;
      return new FakeChild() as unknown as any;
    });

    expect(getWorkspaceIndexStatus({ scope: "notes" }).state).toBe("ready");
    expect(launchWorkspaceIndexProcess({ scope: "notes" })).toBe(false);
    expect(called).toBe(false);
  });

  test("runWorkspaceIndexProcessFromArgs refreshes the index without a session runtime", async () => {
    setWorkspaceIndexProcessFinalizeForTests(() => {});
    await runWorkspaceIndexProcessFromArgs(["--scope", "notes", "--expected-mode", "single-user"]);

    const status = getWorkspaceIndexStatus({ scope: "notes" });
    expect(status.state).toBe("ready");
    expect(status.indexed_file_count).toBe(1);

    const result = await searchWorkspace({ query: "alpha", scope: "notes", refresh: false });
    expect(result.rows).toHaveLength(1);
    expect(result.rows[0].path).toBe("notes/alpha.md");
  });

  test("runWorkspaceIndexProcessFromArgs performs aggressive cleanup after indexing", async () => {
    let cleanupCalls = 0;
    setWorkspaceIndexProcessFinalizeForTests(() => {
      cleanupCalls += 1;
    });

    await runWorkspaceIndexProcessFromArgs(["--scope", "notes", "--expected-mode", "single-user"]);

    expect(cleanupCalls).toBe(1);
  });
});
