import { afterEach, describe, expect, test } from "bun:test";
import {
  checkPendingShutdown,
  clearPendingShutdownForTests,
  isPendingShutdown,
  markPendingShutdown,
} from "../../src/runtime/shutdown-registry.js";

type TestGlobals = typeof globalThis & {
  __PICLAW_EXIT_SCHEDULER__?: () => void;
  __PICLAW_PENDING_SHUTDOWN_FAIL_SAFE_SCHEDULER__?: (callback: () => void, delayMs: number) => void;
};

const testGlobals = globalThis as TestGlobals;

afterEach(() => {
  clearPendingShutdownForTests();
  delete testGlobals.__PICLAW_EXIT_SCHEDULER__;
  delete testGlobals.__PICLAW_PENDING_SHUTDOWN_FAIL_SAFE_SCHEDULER__;
});

describe("shutdown registry ownership", () => {
  test("only the requesting chat can observe or finalize a pending shutdown", () => {
    const failSafeSchedules: number[] = [];
    testGlobals.__PICLAW_PENDING_SHUTDOWN_FAIL_SAFE_SCHEDULER__ = (_callback, delayMs) => {
      failSafeSchedules.push(delayMs);
    };

    markPendingShutdown("deploy", "web:owner", () => true);

    expect(isPendingShutdown()).toBe(true);
    expect(isPendingShutdown("web:owner")).toBe(true);
    expect(isPendingShutdown("web:unrelated")).toBe(false);
    expect(failSafeSchedules).toEqual([30_000]);

    checkPendingShutdown("web:unrelated");
    expect(isPendingShutdown("web:owner")).toBe(true);
  });

  test("fail-safe waits for unrelated sessions to become idle before shutting down", () => {
    const callbacks: Array<() => void> = [];
    const delays: number[] = [];
    let canShutdown = false;
    let shutdownCalls = 0;
    testGlobals.__PICLAW_PENDING_SHUTDOWN_FAIL_SAFE_SCHEDULER__ = (callback, delayMs) => {
      callbacks.push(callback);
      delays.push(delayMs);
    };
    testGlobals.__PICLAW_EXIT_SCHEDULER__ = () => {
      shutdownCalls += 1;
    };

    markPendingShutdown("deploy", "web:owner", () => canShutdown);
    checkPendingShutdown("web:owner");
    expect(isPendingShutdown("web:owner")).toBe(true);
    expect(shutdownCalls).toBe(0);

    callbacks[0]!();

    expect(isPendingShutdown("web:owner")).toBe(true);
    expect(shutdownCalls).toBe(0);
    expect(delays).toEqual([30_000, 5_000]);

    canShutdown = true;
    callbacks[1]!();

    expect(isPendingShutdown()).toBe(false);
    expect(shutdownCalls).toBe(1);
  });
});
