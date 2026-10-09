import { describe, expect, test } from "bun:test";
import { join } from "node:path";
import { SettingsManager } from "@earendil-works/pi-coding-agent";

import { createTempWorkspace, setEnv } from "../helpers.js";
import { createSessionInDir } from "../../src/agent-pool/session.ts";
import { createRealTestModelServices } from "../model-services-fixture.js";

describe("session auto-compaction controls", () => {
  test("createSessionInDir disables upstream auto-compaction with the public session API", async () => {
    const workspace = createTempWorkspace("piclaw-session-auto-compaction-");
    const tempRoot = workspace.base, workspaceDir = workspace.workspace;
    const restore = setEnv({ PICLAW_WORKSPACE: workspaceDir, PICLAW_STORE: workspace.store, PICLAW_DATA: workspace.data });
    const sessionDir = join(tempRoot, "session");
    try {
      const { modelRuntime } = await createRealTestModelServices(join(tempRoot, "agent"));
      const settingsManager = SettingsManager.create(workspaceDir, join(tempRoot, "agent"));
      const runtime = await createSessionInDir(sessionDir, {
        modelRuntime,
        settingsManager,
        tools: [],
        cwd: workspaceDir,
      } as any);

      expect(runtime.session.autoCompactionEnabled).toBe(false);
      runtime.session.dispose?.();
    } finally {
      restore();
      workspace.cleanup();
    }
  }, 20_000);
});
