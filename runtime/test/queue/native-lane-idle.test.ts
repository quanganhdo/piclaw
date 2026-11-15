import { expect, test } from "bun:test";
import { AgentQueue } from "../../src/queue.js";

test("shell-lane release wakes accepted chat work once without re-entering the active lane", async () => {
  const queue = new AgentQueue();
  const calls: string[] = [];
  let release!: () => void;
  const held = new Promise<void>(resolve => { release = resolve; });
  const done = new Promise<void>(resolve => {
    const unsubscribe = queue.onLaneIdle(lane => {
      expect(queue.isLaneBusy(lane)).toBe(false);
      unsubscribe();
      queue.enqueue(async () => { calls.push("accepted-input"); resolve(); }, "accepted", lane);
    });
  });
  queue.enqueue(async () => { calls.push("shell"); await held; }, "shell", "chat:fixture");
  await Bun.sleep(5);
  expect(queue.isLaneBusy("chat:fixture")).toBe(true);
  release(); await done;
  expect(calls).toEqual(["shell", "accepted-input"]);
  await queue.shutdown();
});
