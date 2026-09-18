import "../helpers.js";

import { describe, expect, test } from "bun:test";
import {
  createBashTool,
  createEditTool,
  createReadTool,
  createWriteTool,
  ExecutionError,
  Result,
  type ShellExecOptions,
  type AgentHarnessToolInvocation,
  type JsonValue,
  truncateTail,
} from "@earendil-works/pi-agent-core";

import { BACKGROUND_CONTEXT, withAbortSignal, type Context } from "@earendil-works/pi-agent-core/harness/context";

import type { PiclawToolContext } from "../../src/service-effects/contracts/execution-context-resolver.js";
import { FakeExecutionEnv } from "../../src/service-effects/testing/fakes/fake-execution-env.js";

const memos = new Map<string, Map<string, JsonValue>>();
function invocation(id: string): AgentHarnessToolInvocation {
  const memo = memos.get(id) ?? new Map<string, JsonValue>(); memos.set(id, memo);
  return Object.freeze({
    invocationId: id, operationId: "harness-operation:factory", turnId: "turn:factory",
    async getMemo(name: string) { return memo.get(name); },
    async setMemo(name: string, value: JsonValue | undefined) { if (value === undefined) memo.delete(name); else memo.set(name, structuredClone(value)); },
  });
}

function context(env: FakeExecutionEnv): PiclawToolContext {
  return Object.freeze({ chatJid: "chat:factory", operationId: "operation:factory", env, localEnv: env });
}

function text(result: { readonly content: readonly { readonly type: string; readonly text?: string }[] }): string {
  return result.content.filter((part) => part.type === "text").map((part) => part.text ?? "").join("\n");
}

function deferred(): { readonly promise: Promise<void>; readonly resolve: () => void } {
  let resolve!: () => void;
  const promise = new Promise<void>((done) => { resolve = done; });
  return { promise, resolve };
}

class DelayedReadEnv extends FakeExecutionEnv {
  readonly started = deferred();
  readonly release = deferred();
  override async readBinaryFile(path: string, chord: Context) {
    this.started.resolve();
    await this.release.promise;
    return super.readBinaryFile(path, chord);
  }
}

class SerializedMutationEnv extends FakeExecutionEnv {
  readonly firstWriteStarted = deferred();
  readonly releaseFirstWrite = deferred();
  readonly events: string[] = [];
  private writeCount = 0;

  override async writeFile(path: string, content: string | Uint8Array, chord: Context) {
    this.writeCount += 1;
    this.events.push(`write:${this.writeCount}:start`);
    if (this.writeCount === 1) {
      this.firstWriteStarted.resolve();
      await this.releaseFirstWrite.promise;
    }
    const result = await super.writeFile(path, content, chord);
    this.events.push(`write:${this.writeCount}:end`);
    return result;
  }

  override async readTextFile(path: string, chord: Context) {
    this.events.push("read:start");
    return super.readTextFile(path, chord);
  }
}

class ThrottledAbortEnv extends FakeExecutionEnv {
  readonly started = deferred();
  readonly release = deferred();

  override async exec(_command: string, options: ShellExecOptions | undefined, chord: Context) {
    for (const text of ["first", "firstsecond"]) {
      const { content: _content, ...truncation } = truncateTail(text, { maxBytes: 1024, maxLines: 100 });
      options?.onUpdate?.({ kind: "replace", output: { text, truncation } }, chord);
    }
    this.started.resolve();
    await this.release.promise;
    return Result.err(new ExecutionError("aborted", "aborted"));
  }
}

describe("WP-3C selected direct @earendil-works/pi-agent-core harness factories", () => {
  test("root exports bind PiclawToolContext and preserve read offset, limit and line truncation", async () => {
    const env = new FakeExecutionEnv("/repo");
    env.putText("notes/a.txt", "one\ntwo\nthree\nfour");
    const tool = createReadTool<PiclawToolContext>();
    const limited = await tool.execute("read-1", { path: "notes/a.txt", offset: 2, limit: 2 }, () => {}, context(env), invocation("read-1"), BACKGROUND_CONTEXT);
    expect(text(limited)).toBe("two\nthree\n\n[1 more lines in file. Use offset=4 to continue.]");

    env.putText("large.txt", Array.from({ length: 2_100 }, (_, index) => `line-${index + 1}`).join("\n"));
    const truncated = await tool.execute("read-2", { path: "large.txt" }, () => {}, context(env), invocation("read-2"), BACKGROUND_CONTEXT);
    expect(truncated.details?.truncation).toMatchObject({ truncated: true, truncatedBy: "lines", maxLines: 2_000 });
    expect(text(truncated)).toContain("Use offset=2001 to continue.");
    await expect(tool.execute("read-missing", { path: "missing.txt" }, () => {}, context(env), invocation("read-missing"), BACKGROUND_CONTEXT)).rejects.toMatchObject({ code: "not_found" });
  });

  test("read honors pre-abort and mid-read abort without accepting bytes", async () => {
    const tool = createReadTool<PiclawToolContext>();
    const pre = new FakeExecutionEnv("/repo");
    pre.putText("pre.txt", "must not be read");
    const preController = new AbortController();
    preController.abort();
    await expect(tool.execute("read-pre-abort", { path: "pre.txt" }, () => {}, context(pre), invocation("read-pre-abort"), withAbortSignal(preController.signal, BACKGROUND_CONTEXT))).rejects.toMatchObject({ code: "aborted" });

    const mid = new DelayedReadEnv("/repo");
    mid.putText("mid.txt", "must not be accepted");
    const midController = new AbortController();
    const pending = tool.execute("read-mid-abort", { path: "mid.txt" }, () => {}, context(mid), invocation("read-mid-abort"), withAbortSignal(midController.signal, BACKGROUND_CONTEXT));
    await mid.started.promise;
    midController.abort();
    mid.release.resolve();
    await expect(pending).rejects.toMatchObject({ code: "aborted" });
  });

  test("read returns native image content and deterministic processor success/failure vectors", async () => {
    const env = new FakeExecutionEnv("/repo");
    const pngBytes = Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13, 0x49, 0x48, 0x44, 0x52, 0, 0, 0, 1, 0, 0, 0, 1, 8, 2, 0, 0, 0]);
    const bmpBytes = new Uint8Array(30);
    bmpBytes.set([0x42, 0x4d, 30, 0, 0, 0], 0);
    bmpBytes.set([26, 0, 0, 0], 10);
    bmpBytes.set([12, 0, 0, 0], 14);
    bmpBytes.set([1, 0, 24, 0], 22);
    env.files.set("/repo/image.png", pngBytes);
    env.files.set("/repo/image.bmp", bmpBytes);
    const native = createReadTool<PiclawToolContext>();
    const png = await native.execute("image-png", { path: "image.png" }, () => {}, context(env), invocation("image-png"), BACKGROUND_CONTEXT);
    expect(png.content).toEqual([
      { type: "text", text: "Read image file [image/png]" },
      { type: "image", data: Buffer.from(pngBytes).toString("base64"), mimeType: "image/png" },
    ]);
    const bmp = await native.execute("image-bmp", { path: "image.bmp" }, () => {}, context(env), invocation("image-bmp"), BACKGROUND_CONTEXT);
    expect(text(bmp)).toContain("Image omitted: configure an imageProcessor");

    const processed = createReadTool<PiclawToolContext>({
      imageProcessor: async () => ({ ok: true, data: "processed", mimeType: "image/webp", hints: ["resized"] }),
    });
    expect((await processed.execute("image-processed", { path: "image.png" }, () => {}, context(env), invocation("image-processed"), BACKGROUND_CONTEXT)).content).toEqual([
      { type: "text", text: "Read image file [image/webp]\nresized" },
      { type: "image", data: "processed", mimeType: "image/webp" },
    ]);
    const failed = createReadTool<PiclawToolContext>({ imageProcessor: async () => ({ ok: false, message: "decode failed" }) });
    expect(text(await failed.execute("image-failed", { path: "image.png" }, () => {}, context(env), invocation("image-failed"), BACKGROUND_CONTEXT))).toBe(
      "Read image file [image/png]\ndecode failed",
    );
  });

  test("write uses ExecutionEnv directly and edit preserves CRLF with exact diagnostics", async () => {
    const env = new FakeExecutionEnv("/repo");
    const write = createWriteTool<PiclawToolContext>();
    const written = await write.execute("write-1", { path: "nested/a.txt", content: "alpha\r\nbeta\r\n" }, () => {}, context(env), invocation("write-1"), BACKGROUND_CONTEXT);
    expect(text(written)).toBe("Successfully wrote to nested/a.txt");
    expect(new TextDecoder().decode(env.files.get("/repo/nested/a.txt"))).toBe("alpha\r\nbeta\r\n");

    env.putText("crlf.txt", "alpha\r\nbeta\r\n");
    const edit = createEditTool<PiclawToolContext>();
    const edited = await edit.execute("edit-1", { path: "crlf.txt", edits: [{ oldText: "beta", newText: "gamma" }] }, () => {}, context(env), invocation("edit-1"), BACKGROUND_CONTEXT);
    expect(new TextDecoder().decode(env.files.get("/repo/crlf.txt"))).toBe("alpha\r\ngamma\r\n");
    expect(edited.details?.patch).toContain("+gamma");

    env.putText("duplicate.txt", "same same");
    await expect(edit.execute("edit-duplicate", { path: "duplicate.txt", edits: [{ oldText: "same", newText: "next" }] }, () => {}, context(env), invocation("edit-duplicate"), BACKGROUND_CONTEXT)).rejects.toThrow("Found 2 occurrences");
    await expect(edit.execute("edit-missing", { path: "duplicate.txt", edits: [{ oldText: "absent", newText: "next" }] }, () => {}, context(env), invocation("edit-missing"), BACKGROUND_CONTEXT)).rejects.toThrow("Could not find the exact text");
    env.putText("overlap.txt", "alpha beta");
    await expect(edit.execute("edit-overlap", {
      path: "overlap.txt",
      edits: [{ oldText: "alpha", newText: "one" }, { oldText: "alpha beta", newText: "two" }],
    }, () => {}, context(env), invocation("edit-overlap"), BACKGROUND_CONTEXT)).rejects.toThrow(/overlap/i);
    expect(new TextDecoder().decode(env.files.get("/repo/overlap.txt"))).toBe("alpha beta");
  });

  test("serializes concurrent write/edit operations on the same canonical path", async () => {
    const env = new SerializedMutationEnv("/repo");
    env.putText("shared.txt", "before");
    const write = createWriteTool<PiclawToolContext>();
    const edit = createEditTool<PiclawToolContext>();
    const first = write.execute("write-queued", { path: "./shared.txt", content: "alpha" }, () => {}, context(env), invocation("write-queued"), BACKGROUND_CONTEXT);
    await env.firstWriteStarted.promise;
    const second = edit.execute("edit-queued", {
      path: "shared.txt", edits: [{ oldText: "alpha", newText: "gamma" }],
    }, () => {}, context(env), invocation("edit-queued"), BACKGROUND_CONTEXT);
    await Bun.sleep(20);
    expect(env.events).toEqual(["write:1:start"]);
    env.releaseFirstWrite.resolve();
    await Promise.all([first, second]);
    expect(env.events).toEqual(["write:1:start", "write:1:end", "read:start", "write:2:start", "write:2:end"]);
    expect(new TextDecoder().decode(env.files.get("/repo/shared.txt"))).toBe("gamma");
  });

  test("bash calls env.exec exactly once, preserves ordered updates and emits no post-terminal update", async () => {
    const env = new FakeExecutionEnv("/repo");
    env.script({ _tag: "result", stdout: "out\n", stderr: "err\n", exitCode: 0 });
    const tool = createBashTool<PiclawToolContext>();
    const updates: string[] = [];
    const result = await tool.execute("bash-ok", { command: "echo ok" }, (update) => updates.push(text(update)), context(env), invocation("bash-ok"), BACKGROUND_CONTEXT);
    expect(text(result)).toBe("out\nerr\n");
    expect(env.observedShellEnvironments).toHaveLength(1);
    expect(updates).toEqual(["", "out\nerr\n"]);
    const terminalCount = updates.length;
    await Bun.sleep(120);
    expect(updates).toHaveLength(terminalCount);
  });

  test("bash preserves non-zero, timeout, pre-abort and mid-flight abort semantics", async () => {
    const tool = createBashTool<PiclawToolContext>();
    const nonzero = new FakeExecutionEnv("/repo");
    nonzero.script({ _tag: "result", stdout: "partial", stderr: "", exitCode: 7 });
    await expect(tool.execute("bash-nonzero", { command: "false" }, () => {}, context(nonzero), invocation("bash-nonzero"), BACKGROUND_CONTEXT)).rejects.toThrow(
      "partial\n\nCommand exited with code 7",
    );
    expect(nonzero.observedShellEnvironments).toHaveLength(1);

    const timeout = new FakeExecutionEnv("/repo");
    timeout.script({ _tag: "error", error: new ExecutionError("timeout", "deadline") });
    await expect(tool.execute("bash-timeout", { command: "sleep", timeout: 3 }, () => {}, context(timeout), invocation("bash-timeout"), BACKGROUND_CONTEXT)).rejects.toThrow(
      "Command timed out after 3 seconds",
    );
    expect(timeout.observedShellEnvironments).toHaveLength(1);

    const pre = new FakeExecutionEnv("/repo");
    const preController = new AbortController();
    preController.abort();
    await expect(tool.execute("bash-pre", { command: "unused" }, () => {}, context(pre), invocation("bash-pre"), withAbortSignal(preController.signal, BACKGROUND_CONTEXT))).rejects.toThrow("Command aborted");
    expect(pre.observedShellEnvironments).toHaveLength(0);

    const mid = new FakeExecutionEnv("/repo");
    const gate = deferred();
    let started!: () => void;
    const running = new Promise<void>((resolve) => { started = resolve; });
    mid.script({ _tag: "wait_for_stop", started, release: gate.promise });
    const controller = new AbortController();
    const pending = tool.execute("bash-mid", { command: "wait" }, () => {}, context(mid), invocation("bash-mid"), withAbortSignal(controller.signal, BACKGROUND_CONTEXT));
    await running;
    controller.abort();
    gate.resolve();
    await expect(pending).rejects.toThrow("Command aborted");
    expect(mid.observedShellEnvironments).toHaveLength(1);
    expect(mid.killedGroups).toHaveLength(1);
  });

  test("bash forwards source updates in order and emits no updates after abort rejection", async () => {
    const env = new ThrottledAbortEnv("/repo");
    const controller = new AbortController();
    const updates: string[] = [];
    const pending = createBashTool<PiclawToolContext>().execute(
      "bash-throttled-abort", { command: "wait" }, (update) => updates.push(text(update)), context(env), invocation("bash-throttled-abort"), withAbortSignal(controller.signal, BACKGROUND_CONTEXT),
    );
    await env.started.promise;
    expect(updates).toEqual(["", "first", "firstsecond"]);
    controller.abort();
    env.release.resolve();
    await expect(pending).rejects.toThrow("Command aborted");
    const terminalCount = updates.length;
    expect(updates.at(-1)).toBe("firstsecond");
    await Bun.sleep(140);
    expect(updates).toHaveLength(terminalCount);
  });

  test("bash truncates UTF-8 on code-point boundaries and persists a complete fullOutputPath", async () => {
    const env = new FakeExecutionEnv("/repo");
    const full = `${"é".repeat(30_000)}\nend\n`;
    env.script({ _tag: "result", stdout: full, stderr: "", exitCode: 0 });
    const result = await createBashTool<PiclawToolContext>().execute("bash-large", { command: "large" }, () => {}, context(env), invocation("bash-large"), BACKGROUND_CONTEXT);
    expect(result.details?.truncation).toMatchObject({ truncated: true, truncatedBy: "bytes" });
    expect(result.details?.fullOutputPath).toMatch(/^\/repo\/fake-shell-\d+\.log$/);
    expect(new TextDecoder().decode(env.files.get(result.details!.fullOutputPath!))).toBe(full);
    expect(text(result)).not.toContain("�");
    expect(env.observedShellEnvironments).toHaveLength(1);
  });
});
