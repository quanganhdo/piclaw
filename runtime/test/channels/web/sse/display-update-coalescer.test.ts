import { describe, expect, it } from "vitest";
import { createDisplayUpdateCoalescer } from "../../../../src/channels/web/sse/display-update-coalescer.js";

describe("display update coalescer", () => {
  it("emits the first update immediately and coalesces latest snapshots plus ordered deltas", () => {
    let now = 1_000;
    let scheduled: (() => void) | null = null;
    let scheduleCalls = 0;
    const cancelled: unknown[] = [];
    const calls: Array<{ key: string; payload: Record<string, unknown> }> = [];
    const coalescer = createDisplayUpdateCoalescer({
      intervalMs: 100,
      order: ["snapshot", "delta"],
      now: () => now,
      schedule: (callback) => {
        scheduleCalls += 1;
        scheduled = callback;
        return 0;
      },
      cancel: (handle) => {
        cancelled.push(handle);
        scheduled = null;
      },
    });

    coalescer.queue("snapshot", { text: "a" }, (payload) => calls.push({ key: "snapshot", payload }));
    coalescer.queue("snapshot", { text: "abc" }, (payload) => calls.push({ key: "snapshot", payload }));
    coalescer.queue("delta", { delta: "a" }, (payload) => calls.push({ key: "delta", payload }), { mergeDelta: true });
    coalescer.queue("delta", { delta: "bc" }, (payload) => calls.push({ key: "delta", payload }), { mergeDelta: true });

    expect(calls).toEqual([{ key: "snapshot", payload: { text: "a" } }]);
    expect(scheduled).not.toBeNull();
    expect(scheduleCalls).toBe(1);

    now = 1_100;
    scheduled?.();
    expect(calls).toEqual([
      { key: "snapshot", payload: { text: "a" } },
      { key: "snapshot", payload: { text: "abc" } },
      { key: "delta", payload: { delta: "abc" } },
    ]);
    expect(cancelled).toEqual([0]);
  });

  it("flushes pending updates before an immediate lifecycle payload", () => {
    const calls: string[] = [];
    const coalescer = createDisplayUpdateCoalescer({
      intervalMs: 100,
      order: ["display"],
      now: () => 1_000,
      schedule: () => 1,
      cancel: () => {},
    });

    coalescer.emitImmediate({ state: "start" }, () => calls.push("start"));
    coalescer.queue("display", { text: "latest" }, () => calls.push("display"));
    coalescer.emitImmediate({ state: "done" }, () => calls.push("done"));

    expect(calls).toEqual(["start", "display", "done"]);
  });

  it("disables batching at interval zero for synchronous consumers and tests", () => {
    const calls: string[] = [];
    const coalescer = createDisplayUpdateCoalescer({ intervalMs: 0, order: [] });
    coalescer.queue("one", { value: 1 }, () => calls.push("one"));
    coalescer.queue("two", { value: 2 }, () => calls.push("two"));
    expect(calls).toEqual(["one", "two"]);
  });
});
