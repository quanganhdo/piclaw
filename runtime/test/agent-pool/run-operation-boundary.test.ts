import { expect, test } from "bun:test";
import { createOperationModelBoundary } from "../../src/agent-pool/run-operation-boundary.js";

test("restricted model boundary rechecks admission and budget for every model invocation", async () => {
  let allowed = true,
    blocked: string | null = null,
    calls = 0,
    checks = 0;
  const original = async () => {
    calls++;
    return {} as never;
  };
  const session = { agent: { streamFunction: original } } as any;
  const guard = createOperationModelBoundary({
    requireToolCeiling: true,
    executionAdmissionCheck: () => allowed,
    budgetBeforeModelCall: async () => {
      checks++;
      return blocked;
    },
  });
  guard.apply(session);
  await session.agent.streamFunction({ provider: "fixture" }, {}, {});
  expect(calls).toBe(1);
  expect(checks).toBe(1);
  blocked = "cap exceeded";
  await expect(
    session.agent.streamFunction({ provider: "fixture" }, {}, {}),
  ).rejects.toThrow("PICLAW-BUDGET-BLOCKED");
  expect(calls).toBe(1);
  allowed = false;
  await expect(
    session.agent.streamFunction({ provider: "fixture" }, {}, {}),
  ).rejects.toThrow("permission revoked");
  expect(calls).toBe(1);
  guard.release();
  expect(session.agent.streamFunction).toBe(original);
});

test("required model boundary fails closed, transfers owner and honours caller abort", async () => {
  const controller = new AbortController(),
    original = () => ({}) as never,
    replacement = () => ({}) as never;
  const guard = createOperationModelBoundary({
    requireToolCeiling: true,
    abortSignal: controller.signal,
  });
  expect(() => guard.apply({ agent: {} } as never)).toThrow("admission hook");
  const first = { agent: { streamFunction: original } },
    second = { agent: { streamFunction: replacement } };
  guard.apply(first as never);
  guard.apply(second as never);
  expect(first.agent.streamFunction).toBe(original);
  controller.abort(new Error("caller cancelled"));
  await expect(
    second.agent.streamFunction({ provider: "fixture" } as never, {} as never),
  ).rejects.toThrow("caller cancelled");
  guard.release();
  expect(second.agent.streamFunction).toBe(replacement);
});

test("operation input is recorded as consumed before a blocked model boundary", async () => {
  let committed = 0,
    called = 0;
  const session = {
    agent: {
      streamFunction: async () => {
        called++;
        return {} as never;
      },
    },
  } as any;
  const guard = createOperationModelBoundary({
    requireToolCeiling: true,
    onOperationInputCommitted: () => {
      committed++;
    },
    budgetBeforeModelCall: async () => "exhausted",
  });
  guard.apply(session);
  await expect(
    session.agent.streamFunction({ provider: "fixture" }, {}, {}),
  ).rejects.toThrow("BUDGET-BLOCKED");
  expect(committed).toBe(1);
  expect(called).toBe(0);
  guard.release();
});
