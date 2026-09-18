import { beforeEach, afterEach, expect, test } from "bun:test";
import { initDatabase, getDb } from "../../src/db.js";
import { AddonOperationService } from "../../src/addons/operation-service.js";
import {
  type OperationGrant,
  type OperationHost,
  type OperationResult,
} from "../../src/addons/operation-contracts.js";
import {
  readAddonOperation,
  transitionAddonOperation,
} from "../../src/db/addon-operations.js";

let service: AddonOperationService;
let authorized: boolean;
let handler: OperationHost["execute"];
const grant: OperationGrant = {
  revision: "r1",
  target: "target",
  allowedTools: [],
  timeoutMs: 500,
  maxToolCalls: 0,
  parentWorkId: null,
};
const principal = { addonId: "fixture", principalId: "alice" };
beforeEach(() => {
  initDatabase();
  getDb().exec(
    "DELETE FROM addon_operation_events;DELETE FROM addon_operations;",
  );
  authorized = true;
  handler = async () => ({ status: "completed", output: "done" });
  service = new AddonOperationService({
    authorize: () =>
      authorized ? { decision: "allow", grant } : { decision: "rejected" },
    execute: (input) => handler(input),
  });
});
afterEach(async () => {
  service.shutdown();
  await service.waitForIdle();
});
const request = (key: string) => ({
  target: "target",
  idempotencyKey: key,
  text: "external data",
});

test("caller-scoped list pagination, terminal subscriptions and duplicate receipts", async () => {
  const client = service.bind(principal),
    other = service.bind({ ...principal, principalId: "bob" });
  for (let i = 0; i < 4; i++) await client.admit(request("a" + i));
  await other.admit(request("b"));
  await service.waitForIdle();
  const first = await client.list(null, 2),
    second = await client.list(first.nextCursor, 2);
  expect(first.operations).toHaveLength(2);
  expect(second.operations).toHaveLength(2);
  expect(second.nextCursor).toBeNull();
  const all = [...first.operations, ...second.operations];
  expect(new Set(all.map((o) => o.id)).size).toBe(4);
  const updates = [];
  for await (const update of client.subscribe(all[0].id)) updates.push(update);
  expect(updates).toHaveLength(1);
  expect(updates[0]).toHaveProperty("snapshot.status", "completed");
  expect((await other.list()).operations).toHaveLength(1);
});

test("subscribers receive durable completion independently; aborting subscription does not cancel execution", async () => {
  let finish!: (r: OperationResult) => void;
  handler = () =>
    new Promise((resolve) => {
      finish = resolve;
    });
  const client = service.bind(principal),
    receipt = await client.admit(request("stream"));
  await Bun.sleep(0);
  const controller = new AbortController();
  const stream = client.subscribe(receipt.operation!.id, 0, controller.signal);
  expect((await stream.next()).value).toHaveProperty(
    "snapshot.status",
    "working",
  );
  const next = stream.next();
  controller.abort(new Error("subscriber_left"));
  await expect(next).rejects.toThrow("subscriber_left");
  expect((await client.get(receipt.operation!.id)).status).toBe("working");
  finish({ status: "completed", output: "persisted after disconnect" });
  await service.waitForIdle();
  expect((await client.get(receipt.operation!.id)).output).toBe(
    "persisted after disconnect",
  );
  const reconnect = client.subscribe(receipt.operation!.id);
  expect((await reconnect.next()).value).toHaveProperty(
    "snapshot.status",
    "completed",
  );
  await reconnect.return();
});

test("revocation interrupts subscribed access, not unrelated task execution", async () => {
  let finish!: (r: OperationResult) => void;
  handler = () =>
    new Promise((resolve) => {
      finish = resolve;
    });
  const client = service.bind(principal),
    receipt = await client.admit(request("revoked"));
  await Bun.sleep(0);
  const stream = client.subscribe(receipt.operation!.id);
  await stream.next();
  authorized = false;
  await expect(stream.next()).rejects.toThrow("unavailable");
  finish({ status: "completed" });
  await service.waitForIdle();
  await expect(client.get(receipt.operation!.id)).rejects.toThrow(
    "unavailable",
  );
});

test("input continuation remains in one operation and budget work, requires nonempty bounded input", async () => {
  let count = 0;
  handler = async (input) =>
    ++count === 1
      ? { status: "input_required", output: "What value?" }
      : { status: "completed", output: input.text };
  const client = service.bind(principal),
    receipt = await client.admit(request("input"));
  await service.waitForIdle();
  expect((await client.get(receipt.operation!.id)).status).toBe(
    "input_required",
  );
  await expect(client.continue(receipt.operation!.id, "")).rejects.toThrow();
  const result = await client.continue(receipt.operation!.id, "supplied value");
  expect(result.resumed).toBe(true);
  await service.waitForIdle();
  const final = await client.get(receipt.operation!.id);
  expect(final.workId).toBe(receipt.operation!.workId);
  expect(final.output).toBe("supplied value");
  expect(readAddonOperation(receipt.operation!.id)?.text).toBe(
    "supplied value",
  );
  expect(count).toBe(2);
  expect((await client.continue(receipt.operation!.id, "late")).resumed).toBe(
    false,
  );
  expect(count).toBe(2);
});

test("budget pause can resume with identical grant and bounded event replay reports gaps", async () => {
  let count = 0;
  handler = async () =>
    ++count === 1
      ? { status: "budget_blocked", reason: "budget_boundary" }
      : { status: "completed" };
  const client = service.bind(principal),
    receipt = await client.admit(request("budget"));
  await service.waitForIdle();
  expect((await client.resume(receipt.operation!.id)).resumed).toBe(true);
  await service.waitForIdle();
  expect(count).toBe(2);
  const next = await client.admit(request("many"));
  await service.waitForIdle();
  // Test retention with host-owned transitions; no adapter mutation API exists.
  getDb()
    .query("UPDATE addon_operations SET status='input_required' WHERE id=?")
    .run(next.operation!.id);
  for (let i = 0; i < 140; i++) {
    const row = readAddonOperation(next.operation!.id)!;
    transitionAddonOperation(
      row.id,
      [row.status],
      row.status === "queued" ? "input_required" : "queued",
    );
  }
  const replay = await client.events(next.operation!.id, 1);
  expect(replay.gap).toBe(true);
  expect(replay.events).toHaveLength(128);
});

test("concurrent active-work quota is enforced inside admission transaction", async () => {
  handler = async (input) =>
    new Promise((resolve) =>
      input.signal.addEventListener(
        "abort",
        () => resolve({ status: "cancelled" }),
        { once: true },
      ),
    );
  const client = service.bind(principal);
  const results = await Promise.allSettled(
    Array.from({ length: 17 }, (_, i) => client.admit(request("quota" + i))),
  );
  expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(16);
  expect(results.filter((r) => r.status === "rejected")).toHaveLength(1);
  await Bun.sleep(0);
  for (const r of results)
    if (r.status === "fulfilled") await client.cancel(r.value.operation!.id);
  await service.waitForIdle();
});

test("resume after committed model input uses continuation instruction instead of replaying the last user request", async () => {
  const { markAddonOperationInputCommitted } =
    await import("../../src/db/addon-operations.js");
  const prompts: string[] = [];
  handler = async (input) => {
    prompts.push(input.text);
    if (prompts.length === 1) {
      markAddonOperationInputCommitted(input.operationId);
      return { status: "budget_blocked", reason: "budget_boundary" };
    }
    return { status: "completed" };
  };
  const client = service.bind(principal);
  const first = await client.admit(request("resume-committed"));
  await service.waitForIdle();
  await client.resume(first.operation!.id);
  await service.waitForIdle();
  expect(prompts[0]).toBe("external data");
  expect(prompts[1]).not.toContain("external data");
  expect(prompts[1]).toContain("already in this session");
});

test("cumulative input quota survives replacement of previous continuation text", async () => {
  handler = async () => ({ status: "input_required" });
  const client = service.bind(principal);
  const first = await client.admit({
    ...request("quota-continuation"),
    text: "a".repeat(16000),
  });
  await service.waitForIdle();
  await client.continue(first.operation!.id, "b".repeat(16000));
  await service.waitForIdle();
  expect(readAddonOperation(first.operation!.id)?.text).toBe("b".repeat(16000));
  await expect(
    client.continue(first.operation!.id, "c".repeat(1000)),
  ).rejects.toThrow("input limit");
});
