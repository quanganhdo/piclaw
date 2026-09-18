import "../helpers.js";

import { describe, expect, test } from "bun:test";
import { ExecutionError } from "@earendil-works/pi-agent-core";
import { BACKGROUND_CONTEXT, withAbortSignal, type Context } from "@earendil-works/pi-agent-core/harness/context";

import { FakeExecutionEnv } from "../../src/service-effects/testing/fakes/fake-execution-env.js";

describe("FakeExecutionEnv direct settlement", () => {
  test("wait_for_stop settles on timeout without an external release", async () => {
    const env = new FakeExecutionEnv("/repo");
    const release = Promise.withResolvers<void>();
    let started = false;
    env.script({ _tag: "wait_for_stop", started: () => { started = true; }, release: release.promise });

    const result = await settlesWithin(env.exec("wait", { timeout: 0.01 }, BACKGROUND_CONTEXT));

    expect(started).toBeTrue();
    expect(!result.ok && result.error.code).toBe("timeout");
    expect(env.ownedGroups.size).toBe(0);
    expect(env.killedGroups).toEqual([1]);
    await env.cleanup(BACKGROUND_CONTEXT);
    await env.cleanup(BACKGROUND_CONTEXT);
    expect(env.cleanupCalls).toBe(1);
  });

  test("wait_for_stop settles on a mid-execution abort without an external release", async () => {
    const env = new FakeExecutionEnv("/repo");
    const release = Promise.withResolvers<void>();
    const running = Promise.withResolvers<void>();
    const controller = new AbortController();
    const context = withAbortSignal(controller.signal, BACKGROUND_CONTEXT);
    env.script({ _tag: "wait_for_stop", started: running.resolve, release: release.promise });

    const pending = env.exec("wait", undefined, context);
    await running.promise;
    controller.abort();
    const result = await settlesWithin(pending);

    expect(!result.ok && result.error.code).toBe("aborted");
    expect(env.observedContexts).toEqual([context]);
    expect(env.ownedGroups.size).toBe(0);
    expect(env.killedGroups).toEqual([1]);
  });

  test("pre-aborted execution settles before consuming a script or owning a group", async () => {
    const env = new FakeExecutionEnv("/repo");
    const release = Promise.withResolvers<void>();
    let started = false;
    env.script({ _tag: "wait_for_stop", started: () => { started = true; }, release: release.promise });
    const controller = new AbortController();
    controller.abort();
    const context = withAbortSignal(controller.signal, BACKGROUND_CONTEXT);

    const result = await settlesWithin(env.exec("wait", undefined, context));

    expect(!result.ok && result.error.code).toBe("aborted");
    expect(started).toBeFalse();
    expect(env.shellSteps).toHaveLength(1);
    expect(env.ownedGroups.size).toBe(0);
    expect(env.killedGroups).toEqual([]);
  });

  test("cleanup settles an owned wait, is idempotent, and prevents later execution", async () => {
    const env = new FakeExecutionEnv("/repo");
    const release = Promise.withResolvers<void>();
    const running = Promise.withResolvers<void>();
    env.script({ _tag: "wait_for_stop", started: running.resolve, release: release.promise });
    const pending = env.exec("wait", undefined, BACKGROUND_CONTEXT);
    await running.promise;

    await settlesWithin(env.cleanup(BACKGROUND_CONTEXT));
    const result = await settlesWithin(pending);
    await settlesWithin(env.cleanup(BACKGROUND_CONTEXT));

    expect(!result.ok && result.error.code).toBe("unknown");
    expect(env.cleanupCalls).toBe(1);
    expect(env.ownedGroups.size).toBe(0);
    expect(env.killedGroups).toEqual([1]);

    env.script({ _tag: "result", stdout: "unused", stderr: "", exitCode: 0 });
    const afterCleanup = await settlesWithin(env.exec("must-not-run", undefined, BACKGROUND_CONTEXT));
    expect(!afterCleanup.ok && afterCleanup.error.code).toBe("unknown");
    expect(env.shellSteps).toHaveLength(1);
    expect(env.ownedGroups.size).toBe(0);
  });

  test("a throwing output callback settles as callback_error while preserving update data and Context identity", async () => {
    const env = new FakeExecutionEnv("/repo");
    env.script({ _tag: "result", stdout: "out", stderr: "err", exitCode: 7 });
    const context = Object.freeze({ ...BACKGROUND_CONTEXT }) as Context;
    let callbackContext: Context | undefined;
    let callbackText: string | undefined;

    const result = await settlesWithin(env.exec("ignored", {
      capture: { limits: { maxBytes: 32, maxLines: 4, retain: "tail" } },
      onUpdate(update, receivedContext) {
        callbackContext = receivedContext;
        callbackText = update.kind === "replace" ? update.output.text : undefined;
        throw new Error("callback exploded");
      },
    }, context));

    expect(!result.ok && result.error.code).toBe("callback_error");
    expect(!result.ok && result.error).toBeInstanceOf(ExecutionError);
    expect(!result.ok && result.error.message).toBe("callback exploded");
    expect(callbackText).toBe("outerr");
    expect(callbackContext).toBe(context);
    expect(env.observedContexts).toEqual([context]);
    expect(env.ownedGroups.size).toBe(0);
  });

  for (const fault of ["started", "release"] as const) {
    test(`hostile wait ${fault} settles as a typed error and retires its owned group`, async () => {
      const env = new FakeExecutionEnv("/repo");
      const release = Promise.withResolvers<void>();
      env.script({
        _tag: "wait_for_stop",
        started() { if (fault === "started") throw new Error("started fault"); release.reject(new Error("release fault")); },
        release: release.promise,
      });
      const result = await settlesWithin(env.exec("wait", { timeout: 0.03 }, BACKGROUND_CONTEXT));
      expect(!result.ok && result.error.code).toBe("unknown");
      expect(!result.ok && result.error).toBeInstanceOf(ExecutionError);
      expect(env.ownedGroups.size).toBe(0);
      expect(env.killedGroups).toEqual([1]);
      await env.cleanup(BACKGROUND_CONTEXT);
      await Bun.sleep(50);
      expect(env.killedGroups).toEqual([1]);
      expect(env.cleanupCalls).toBe(1);
    });
  }

  test("throwCleanup remains an intentional hostile-only rejection and later cleanup is idempotent", async () => {
    const env = new FakeExecutionEnv("/repo");
    env.throwCleanup = true;

    await expect(env.cleanup(BACKGROUND_CONTEXT)).rejects.toThrow("cleanup fault");
    await settlesWithin(env.cleanup(BACKGROUND_CONTEXT));

    expect(env.cleanupCalls).toBe(1);
    expect(env.ownedGroups.size).toBe(0);
  });
});

async function settlesWithin<T>(promise: Promise<T>): Promise<T> {
  return await Promise.race([
    promise,
    Bun.sleep(250).then(() => { throw new Error("operation did not settle promptly"); }),
  ]);
}
