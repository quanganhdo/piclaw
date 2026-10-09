import { afterEach, expect, spyOn, test } from "bun:test";
import { withTempWorkspaceEnv } from "../helpers.js";
import { closeDatabase, initDatabase } from "../../src/db.js";
import { startToolOutputCleanup, stopToolOutputCleanup } from "../../src/tool-output.js";

afterEach(() => stopToolOutputCleanup());

test("cleanup stop is idempotent and a stopped callback cannot prune a closed database", async () => {
  await withTempWorkspaceEnv("tool-output-cleanup-lifecycle-", {}, () => {
    initDatabase();
    const callbacks: Array<() => void> = [];
    const timers: Array<{ unref(): void }> = [];
    const interval = spyOn(globalThis, "setInterval").mockImplementation(((callback: () => void) => {
      const timer = { unref() {} };
      callbacks.push(callback); timers.push(timer); return timer;
    }) as any);
    const clear = spyOn(globalThis, "clearInterval").mockImplementation(() => {});
    try {
      startToolOutputCleanup();
      expect(callbacks).toHaveLength(1);
      stopToolOutputCleanup(); stopToolOutputCleanup();
      expect(clear).toHaveBeenCalledTimes(1);
      expect(clear).toHaveBeenCalledWith(timers[0]);
      closeDatabase();
      expect(callbacks[0]).not.toThrow();
      initDatabase(); startToolOutputCleanup();
      expect(callbacks).toHaveLength(2);
      expect(callbacks[0]).not.toThrow();
      stopToolOutputCleanup(); closeDatabase();
      expect(callbacks[1]).not.toThrow();
    } finally { stopToolOutputCleanup(); closeDatabase(); interval.mockRestore(); clear.mockRestore(); }
  });
});
