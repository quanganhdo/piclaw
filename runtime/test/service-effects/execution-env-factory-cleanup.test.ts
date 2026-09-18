import "../helpers.js";

import { describe, expect, test } from "bun:test";
import { BACKGROUND_CONTEXT, Result, type Context } from "@earendil-works/pi-agent-core";

import { CurrentPiclawExecutionContextResolver } from "../../src/service-effects/current-piclaw/execution-context-resolver.js";
import { CurrentPiclawLocalExecutionEnvFactory } from "../../src/service-effects/current-piclaw/local-execution-env.js";
import { CurrentPiclawSshExecutionEnvFactory } from "../../src/service-effects/current-piclaw/ssh-execution-env.js";
import { FakeExecutionEnv } from "../../src/service-effects/testing/fakes/fake-execution-env.js";
import { FakeExecutionContextResolver } from "../../src/service-effects/testing/fakes/fake-execution-context-resolver.js";

describe("execution environment factory rejection cleanup", () => {
  for (const fake of [false, true]) describe(fake ? "independent fake resolver" : "current resolver", () => {
  test("resolver cleans hostile environment candidates once with the cleanup receiver and background context", async () => {
    for (const candidate of [changingCwdCandidate("/local"), changingMethodCandidate("/local")]) {
      const result = await resolver(() => Result.ok(candidate), fake).resolve(request());
      expect(result.ok).toBeFalse();
      expectCleanup(candidate);
    }
  });

  test("resolver cleans bounded candidates from unstable ok and value getters exactly once", async () => {
    const unstableOk = trackedCandidate("/local", true);
    let okReads = 0;
    const okResult = await resolver(() => ({
      get ok() { return okReads++ === 0 ? true : false; },
      value: unstableOk,
    }) as never, fake).resolve(request());
    expect(okResult.ok).toBeFalse();
    expect(okReads).toBe(2);
    expectCleanup(unstableOk);

    const first = trackedCandidate("/first", true);
    const second = trackedCandidate("/second", true);
    let valueReads = 0;
    const valueResult = await resolver(() => ({
      ok: true,
      get value() { return valueReads++ === 0 ? first : second; },
    }) as never, fake).resolve(request());
    expect(valueResult.ok).toBeFalse();
    expect(valueReads).toBe(2);
    expectCleanup(first);
    expectCleanup(second);
  });

  });

  test("local factory cleans a captured delegate when adapter construction throws", async () => {
    const candidate = changingMethodCandidate("/local", true);
    const factory = new CurrentPiclawLocalExecutionEnvFactory({
      cwd: "/local",
      prepareShellEnvironment: () => ({}),
      createNodeEnv: () => candidate,
    });
    const result = await Promise.resolve(factory.createLocalEnv());
    expect(result.ok).toBeFalse();
    expectCleanup(candidate);
  });

  test("SSH factory cleans candidates rejected by unstable envelopes and adapter validation", async () => {
    const unstableOk = trackedCandidate("/remote", true);
    let okReads = 0;
    const unstableFactory = new CurrentPiclawSshExecutionEnvFactory(() => ({
      get ok() { return okReads++ === 0 ? true : false; },
      value: unstableOk,
    }) as never, () => ({}));
    expect((await unstableFactory.createSshEnv(profile())).ok).toBeFalse();
    expect(okReads).toBe(2);
    expectCleanup(unstableOk);

    const first = trackedCandidate("/remote", true);
    const second = trackedCandidate("/remote", true);
    let valueReads = 0;
    const changingValueFactory = new CurrentPiclawSshExecutionEnvFactory(() => ({
      ok: true,
      get value() { return valueReads++ === 0 ? first : second; },
    }) as never, () => ({}));
    expect((await changingValueFactory.createSshEnv(profile())).ok).toBeFalse();
    expect(valueReads).toBe(2);
    expectCleanup(first);
    expectCleanup(second);

    const hostileMethod = changingMethodCandidate("/remote", true);
    const invalidFactory = new CurrentPiclawSshExecutionEnvFactory(() => Result.ok(hostileMethod), () => ({}));
    expect((await invalidFactory.createSshEnv(profile())).ok).toBeFalse();
    expectCleanup(hostileMethod);
  });
});

type TrackedCandidate = FakeExecutionEnv & {
  cleanupCalls: number;
  cleanupReceivers: unknown[];
  cleanupContexts: Context[];
};

function trackedCandidate(cwd: string, throwCleanup = false): TrackedCandidate {
  const candidate = new FakeExecutionEnv(cwd) as TrackedCandidate;
  candidate.cleanupCalls = 0;
  candidate.cleanupReceivers = [];
  candidate.cleanupContexts = [];
  Object.defineProperty(candidate, "cleanup", {
    configurable: true,
    value: async function(this: TrackedCandidate, context: Context) {
      this.cleanupCalls += 1;
      this.cleanupReceivers.push(this);
      this.cleanupContexts.push(context);
      if (throwCleanup) throw new Error("cleanup failed");
    },
  });
  return candidate;
}

function changingCwdCandidate(cwd: string, throwCleanup = true): TrackedCandidate {
  const candidate = trackedCandidate(cwd, throwCleanup);
  let reads = 0;
  Object.defineProperty(candidate, "cwd", {
    configurable: true,
    get() { return reads++ === 0 ? cwd : `${cwd}/changed`; },
  });
  return candidate;
}

function changingMethodCandidate(cwd: string, throwCleanup = true): TrackedCandidate {
  const candidate = trackedCandidate(cwd, throwCleanup);
  let reads = 0;
  Object.defineProperty(candidate, "absolutePath", {
    configurable: true,
    get() { return reads++ === 0 ? FakeExecutionEnv.prototype.absolutePath : FakeExecutionEnv.prototype.joinPath; },
  });
  return candidate;
}

function expectCleanup(candidate: TrackedCandidate): void {
  expect(candidate.cleanupCalls).toBe(1);
  expect(candidate.cleanupReceivers).toEqual([candidate]);
  expect(candidate.cleanupContexts).toEqual([BACKGROUND_CONTEXT]);
}

function resolver(createLocalEnv: () => never, fake = false) {
  const Resolver = fake ? FakeExecutionContextResolver : CurrentPiclawExecutionContextResolver;
  return new Resolver(
    { getOperationSnapshot: () => ({ chatJid: "chat", operationId: "operation", version: 1 }) },
    { getCurrentRoute: () => ({ kind: "local" }) },
    { getSshProfile: () => null },
    { createLocalEnv },
    { createSshEnv: createLocalEnv },
  );
}

function request() {
  return { chatJid: "chat", operationId: "operation", expectedOperationVersion: 1, requestedRoute: "local" as const };
}

function profile() {
  return { profileId: "profile", transportRef: "transport", cwd: "/remote" } as const;
}
