import { expect, test } from "bun:test";
import "../helpers.js";
import { AgentQueue } from "../../src/queue.js";
import { assertProcessAdmission, registerProcessAdmissionGuard } from "../../src/runtime/process-admission.js";

const deferred = () => {
  let resolve!: () => void;
  const promise = new Promise<void>(yes => { resolve = yes; });
  return { promise, resolve };
};

test("registrations and disposers are identity scoped", () => {
  let calls = 0;
  const guard = () => { calls++; };
  const a = registerProcessAdmissionGuard(guard), b = registerProcessAdmissionGuard(guard);
  try {
    assertProcessAdmission(); expect(calls).toBe(2);
    a(); a(); assertProcessAdmission(); expect(calls).toBe(3);
    const deny = registerProcessAdmissionGuard(() => { throw new Error("sealed"); });
    try { expect(assertProcessAdmission).toThrow("sealed"); } finally { deny(); }
  } finally { a(); b(); }
  assertProcessAdmission(); expect(calls).toBe(4);
});

test("new admission is synchronous and leaves accepted startup, pending and current ownership intact", async () => {
  const queue = new AgentQueue(), started = deferred(), finish = deferred();
  const order: string[] = [];
  queue.assertProcessControlIdle();
  queue.enqueue(async () => { started.resolve(); await finish.promise; order.push("current"); }, "control", "chat");
  const allowed = { lane: "chat", ids: ["control"] };
  expect(() => queue.assertProcessControlIdle()).toThrow(); // startup
  queue.assertProcessControlIdle(allowed);
  expect(() => queue.assertProcessControlIdle({ lane: "other", ids: ["control"] })).toThrow();
  expect(() => queue.assertProcessControlIdle({ lane: "chat", ids: ["unknown"] })).toThrow();
  queue.enqueue(async () => { order.push("pending"); }, "pending", "chat");
  expect(() => queue.assertProcessControlIdle(allowed)).toThrow();
  const metrics = queue.getMetrics();
  const dispose = registerProcessAdmissionGuard(() => { throw new Error("sealed"); });
  try {
    expect(() => queue.enqueue(async () => {}, "control", "chat")).toThrow("sealed");
    expect(() => queue.enqueueTask("new", async () => {})).toThrow("sealed");
    expect(queue.getMetrics()).toEqual(metrics);
    await started.promise;
    finish.resolve();
    await queue.sealAndDrain().joined;
    expect(order).toEqual(["current", "pending"]);
    expect(() => queue.assertProcessControlIdle(allowed)).toThrow(); // migration
    await queue.shutdown();
  } finally { finish.resolve(); dispose(); }
});

test("only an exact current id is allowed, not anonymous or another active lane", async () => {
  const queue = new AgentQueue(), finish = deferred(), started = deferred();
  queue.enqueue(async () => { started.resolve(); await finish.promise; }, "control", "chat");
  await started.promise;
  queue.assertProcessControlIdle({ lane: "chat", ids: ["control"] });
  queue.enqueue(async () => { await finish.promise; }, undefined, "other");
  expect(() => queue.assertProcessControlIdle({ lane: "chat", ids: ["control"] })).toThrow();
  expect(() => queue.assertProcessControlIdle({ lane: "other", ids: [] })).toThrow();
  finish.resolve(); await queue.sealAndDrain().joined;
  const anonymous = new AgentQueue(), release = deferred();
  anonymous.enqueue(async () => { await release.promise; }, undefined, "chat");
  expect(() => anonymous.assertProcessControlIdle({ lane: "chat", ids: ["unknown", ""] })).toThrow();
  release.resolve(); await anonymous.sealAndDrain().joined;
  const empty = new AgentQueue(); await empty.shutdown();
  expect(() => empty.assertProcessControlIdle()).toThrow();
});

test("named and anonymous backoff remains owned and retries execute with process admission sealed", async () => {
  for (const id of ["retry", undefined]) {
    const original = globalThis.setTimeout;
    const scheduled = deferred();
    let fire!: () => void, timer!: ReturnType<typeof setTimeout>;
    globalThis.setTimeout = ((fn: () => void, ms?: number) => {
      if (ms && ms >= 1000) {
        fire = fn; timer = original(() => {}, 60000); scheduled.resolve(); return timer;
      }
      return original(fn, ms);
    }) as typeof setTimeout;
    const queue = new AgentQueue();
    let attempts = 0;
    let dispose = () => {};
    try {
      queue.enqueue(async () => { if (++attempts === 1) throw new Error("retry me"); }, id, "chat");
      await scheduled.promise;
      expect(() => queue.assertProcessControlIdle({ lane: "chat", ids: ["retry"] })).toThrow();
      dispose = registerProcessAdmissionGuard(() => { throw new Error("sealed"); });
      clearTimeout(timer); fire();
      const drain = queue.sealAndDrain(); await drain.joined;
      expect(attempts).toBe(2);
    } finally { dispose(); clearTimeout(timer); globalThis.setTimeout = original; }
  }
});
