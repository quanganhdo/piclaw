import { existsSync } from "fs";
import { describe, expect, test } from "bun:test";

import { cleanupSharedTestWorkspace, getTestWorkspace } from "./helpers.js";

describe("runtime test helpers", () => {
  test("shared temp workspace can be cleaned up and recreated", () => {
    const first = getTestWorkspace();
    expect(existsSync(first.base)).toBe(true);

    cleanupSharedTestWorkspace();
    expect(existsSync(first.base)).toBe(false);

    const second = getTestWorkspace();
    expect(existsSync(second.base)).toBe(true);
    expect(second.base).not.toBe(first.base);

    cleanupSharedTestWorkspace();
    expect(existsSync(second.base)).toBe(false);

    // Other files reuse the helper module and its environment in the same Bun process.
    // Leave a live shared workspace for SDKs that require the stored cwd to exist.
    const restored = getTestWorkspace();
    expect(process.env.PICLAW_WORKSPACE).toBe(restored.workspace);
    expect(existsSync(restored.workspace)).toBe(true);
  });
});
