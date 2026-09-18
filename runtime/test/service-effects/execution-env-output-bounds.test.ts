import "../helpers.js";
import { expect, test } from "bun:test";
import { Result, truncateTail, type ShellOutputMetadata, type ShellOutputUpdate } from "@earendil-works/pi-agent-core";
import { NodeExecutionEnv } from "@earendil-works/pi-agent-core/harness/env/nodejs";
import { createTempWorkspace } from "../helpers.js";
import { BACKGROUND_CONTEXT } from "@earendil-works/pi-agent-core/harness/context";
import { PiclawExecutionEnv } from "../../src/service-effects/current-piclaw/execution-env-adapter.js";
import { FakeExecutionEnv } from "../../src/service-effects/testing/fakes/fake-execution-env.js";

const ctx = BACKGROUND_CONTEXT;
const limits = { maxBytes: 8, maxLines: 2 };
function metadata(text: string) {
  const { content: _content, ...truncation } = truncateTail(text, limits);
  return { truncation };
}
function controlled(updates: ShellOutputUpdate[], completion?: ShellOutputMetadata) {
  const raw = new FakeExecutionEnv("/test");
  raw.exec = async (_command, options, context) => {
    let final: ShellOutputMetadata = metadata("");
    for (const update of updates) {
      options?.onUpdate?.(update, context);
      const source = update.kind === "replace" ? update.output : update.metadata;
      final = { truncation: source.truncation, ...(source.spillPath === undefined ? {} : { spillPath: source.spillPath }), ...(source.lastLineBytes === undefined ? {} : { lastLineBytes: source.lastLineBytes }) };
    }
    return Result.ok({ exitCode: 0, ...(completion ?? final) });
  };
  return new PiclawExecutionEnv(raw, () => ({}));
}

test("cleanup closes admission before asynchronous shell preparation completes", async () => {
  let ready!: () => void, release!: () => void;
  const started = new Promise<void>((resolve) => { ready = resolve; });
  const blocked = new Promise<void>((resolve) => { release = resolve; });
  const raw = new FakeExecutionEnv("/test");
  const env = new PiclawExecutionEnv(raw, async () => { ready(); await blocked; return {}; });
  const pending = env.exec("never starts", undefined, ctx);
  await started;
  await env.cleanup(ctx);
  release();
  const result = await pending;
  expect(result.ok).toBe(false);
  expect(!result.ok && result.error.code).toBe("aborted");
  expect(raw.observedShellEnvironments).toHaveLength(0);
  expect((await env.exec("also forbidden", undefined, ctx)).ok).toBe(false);
  expect((await env.writeFile("late", "value", ctx)).ok).toBe(false);
  await env.cleanup(ctx);
  expect(raw.cleanupCalls).toBe(1);
  expect(raw.ownedGroups.size).toBe(0);
});

for (const [name, updates, accepted] of [
  ["oversized replace", [{ kind: "replace", output: { text: "x".repeat(1_000_000), ...metadata("x") } }], 0],
  ["cumulative append", [
    { kind: "replace", output: { text: "123456", ...metadata("123456") } },
    { kind: "append", text: "789", metadata: metadata("123456") },
  ], 1],
  ["metadata understates bytes", [{ kind: "replace", output: { text: "éé", ...metadata("x") } }], 0],
  ["metadata understates lines", [{ kind: "replace", output: { text: "a\nb", ...metadata("abc") } }], 0],
  ["slide past retained view", [
    { kind: "replace", output: { text: "123", ...metadata("123") } },
    { kind: "slide", drop: 4, text: "x", metadata: metadata("x") },
  ], 1],
  ["slide splits Unicode code point", [
    { kind: "replace", output: { text: "😀", ...metadata("😀") } },
    { kind: "slide", drop: 1, text: "x", metadata: metadata("x") },
  ], 1],
] as const) {
  test(`rejects ${name} without delivering the invalid update`, async () => {
    const env = controlled(updates as unknown as ShellOutputUpdate[]);
    const seen: ShellOutputUpdate[] = [];
    const result = await env.exec("fixture", { capture: { limits }, onUpdate: (update) => { seen.push(update); } }, ctx);
    expect(!result.ok && result.error.code).toBe("callback_error");
    expect(seen).toHaveLength(accepted);
    await env.cleanup(ctx);
  });
}

test("accepts bounded replace, append, slide and metadata updates in order", async () => {
  const updates: ShellOutputUpdate[] = [
    { kind: "replace", output: { text: "ab", ...metadata("ab") } },
    { kind: "append", text: "cd", metadata: metadata("abcd") },
    { kind: "slide", drop: 2, text: "ef", metadata: metadata("cdef") },
    { kind: "metadata", metadata: metadata("cdef") },
  ];
  const env = controlled(updates), seen: ShellOutputUpdate[] = [];
  const result = await env.exec("fixture", { capture: { limits }, onUpdate: (update) => { seen.push(update); } }, ctx);
  expect(result.ok).toBe(true);
  expect(seen.map((update) => update.kind)).toEqual(["replace", "append", "slide", "metadata"]);
  await env.cleanup(ctx);
});

test("completion cannot contradict the final output truncation, spill or partial-line metadata", async () => {
  const captured: ShellOutputMetadata = { ...metadata("0123456789abcdef"), spillPath: "/test/full.log", lastLineBytes: 16 };
  const update: ShellOutputUpdate = { kind: "replace", output: { text: "89abcdef", ...captured } };
  for (const end of [metadata("89abcdef"), { ...captured, spillPath: undefined }, { ...captured, lastLineBytes: 15 }]) {
    const env = controlled([update], end);
    let calls = 0;
    const result = await env.exec("fixture", { capture: { limits }, onUpdate: () => { calls++; } }, ctx);
    expect(calls).toBe(1);
    expect(!result.ok && result.error.code).toBe("unknown");
    await env.cleanup(ctx);
  }
  const matching = controlled([update], captured);
  expect((await matching.exec("fixture", { capture: { limits }, onUpdate() {} }, ctx)).ok).toBe(true);
  await matching.cleanup(ctx);
});

test("cleanup publishes its shared promise before a delegate can re-enter", async () => {
  const raw = new FakeExecutionEnv("/test");
  let calls = 0;
  let nested: Promise<void> | undefined;
  let env!: PiclawExecutionEnv;
  raw.cleanup = async () => { calls++; nested = env.cleanup(ctx); };
  env = new PiclawExecutionEnv(raw, () => ({}));
  const first = env.cleanup(ctx);
  await first;
  expect(calls).toBe(1);
  expect(nested).toBe(first);
  expect(env.cleanup(ctx)).toBe(first);
});

test("real upstream head capture accepts both byte overflow and line-priority metadata", async () => {
  const workspace = createTempWorkspace("earendil-head-capture-");
  const raw = new NodeExecutionEnv({ cwd: workspace.base });
  const env = new PiclawExecutionEnv(raw, () => ({ PATH: "/usr/bin:/bin" }));
  const output: ShellOutputUpdate[] = [];
  try {
    const result = await env.exec("printf '12345678901234567890\\nsecond\\nthird\\n'", {
      capture: { limits: { maxBytes: 8, maxLines: 1, retain: "head" } },
      onUpdate: (update) => { output.push(update); },
    }, ctx);
    expect(result.ok).toBe(true);
    if (!result.ok) throw result.error;
    expect(result.value.truncation).toMatchObject({ truncated: true, truncatedBy: "lines", firstLineExceedsLimit: true, outputBytes: 0, outputLines: 0 });
    expect(output.length).toBeGreaterThan(0);
  } finally { await env.cleanup(ctx); workspace.cleanup(); }
});
