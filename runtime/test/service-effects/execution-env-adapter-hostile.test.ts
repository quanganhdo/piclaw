import "../helpers.js";

import { homedir } from "node:os";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, test } from "bun:test";
import { BACKGROUND_CONTEXT, ExecutionError, Result, type Context, type ShellExecOptions } from "@earendil-works/pi-agent-core";

import { CurrentPiclawExecutionContextResolver } from "../../src/service-effects/current-piclaw/execution-context-resolver.js";
import { PiclawExecutionEnv } from "../../src/service-effects/current-piclaw/execution-env-adapter.js";
import { CurrentPiclawSshExecutionEnvFactory } from "../../src/service-effects/current-piclaw/ssh-execution-env.js";
import { FakeExecutionContextResolver } from "../../src/service-effects/testing/fakes/fake-execution-context-resolver.js";
import { FakeExecutionEnv } from "../../src/service-effects/testing/fakes/fake-execution-env.js";

const SECRET = "hostile-secret-sentinel";

describe("EF-H01 resolver factory normalization", () => {
  for (const [name, create] of [["current", createCurrentResolver], ["fake", createFakeResolver]] as const) {
    test(`${name} snapshots result errors and environments`, async () => {
      const changedResult = await create(() => changingResult("ok", true, false, "value", new FakeExecutionEnv("/root")) as never).resolve(localRequest());
      expect(!changedResult.ok && changedResult.error._tag).toBe("environment_unavailable");
      const sourceError = { _tag: "credential_unavailable", certainty: "not_applied", retryable: false, secret: SECRET } as const;
      const copiedError = await create(() => Result.err(sourceError)).resolve(localRequest());
      expect(!copiedError.ok && copiedError.error).toEqual({ _tag: "credential_unavailable", certainty: "not_applied", retryable: false }); expect(JSON.stringify(copiedError)).not.toContain(SECRET);
      const changedError = await create(() => Result.err(changingError() as never)).resolve(localRequest());
      expect(!changedError.ok && changedError.error._tag).toBe("environment_unavailable");
      const changedCwd = new FakeExecutionEnv("/root"); let cwdReads = 0; Object.defineProperty(changedCwd, "cwd", { configurable: true, get() { return cwdReads++ === 0 ? "/root" : "/changed"; } });
      expect((await create(() => Result.ok(changedCwd)).resolve(localRequest())).ok).toBeFalse();
      const changedMethod = new FakeExecutionEnv("/root"); let methodReads = 0; Object.defineProperty(changedMethod, "exists", { configurable: true, get() { return methodReads++ === 0 ? FakeExecutionEnv.prototype.exists : FakeExecutionEnv.prototype.fileInfo; } });
      expect((await create(() => Result.ok(changedMethod)).resolve(localRequest())).ok).toBeFalse();
      const raw = new FakeExecutionEnv("/root") as FakeExecutionEnv & { secret?: string }; raw.secret = SECRET;
      const accepted = await create(() => Result.ok(raw)).resolve(localRequest()); expect(accepted.ok).toBeTrue();
      if (accepted.ok) {
        expect(Object.keys(accepted.value.env)).not.toContain("secret");
        Object.defineProperty(raw, "cwd", { value: "/changed" }); Object.defineProperty(raw, "exists", { value: () => { throw new Error("retarget"); } });
        expect(accepted.value.env.cwd).toBe("/root"); expect((await accepted.value.env.exists("missing", BACKGROUND_CONTEXT)).ok).toBeTrue();
      }
    });
  }
});

describe("EF-H01 hostile ExecutionEnv adapter boundaries", () => {
  test("adapter-generated and FileInfo paths mirror selected Earendil syntax", async () => {
    const rejecting = new FakeExecutionEnv("/root"); rejecting.rejectAllFiles = true; rejecting.rejectAllFilesWithThrow = true; const env = adapter(rejecting);
    for (const [input, expected] of [
      ["a/../x", "/root/x"], ["/tmp/x", "/tmp/x"], ["~", homedir()], ["~/x", resolve(homedir(), "x")],
      ["file:///tmp/x", fileURLToPath("file:///tmp/x")], ["file://%", "/root/file:/%"], ["/remote/path/../x", "/remote/x"],
    ] as const) {
      const failed = await env.readTextFile(input, BACKGROUND_CONTEXT); expect(!failed.ok && failed.error.path).toBe(expected);
      const info = { name: "x", path: input, kind: "file", size: 0, mtimeMs: 0 } as const;
      const normalized = await adapter(delegateWith(Result.ok(info))).fileInfo(input, BACKGROUND_CONTEXT); expect(normalized.ok && normalized.value.path).toBe(expected);
    }
  });
  test("runtime-hostile filesystem arguments always settle typed errors", async () => {
    const env = adapter();
    const changingContext = changingField("abortSignal", undefined, { aborted: false });
    const changingTempContext = changingField("abortSignal", undefined, { aborted: false });
    const throwing = throwingField("recursive");
    const binary = new Proxy(new Uint8Array([1, 2]), { get() { throw new Error("bytes getter"); } });
    const results = await Promise.all([
      env.readTextLines("x", undefined, changingContext), env.createDir("x", throwing, BACKGROUND_CONTEXT), env.remove("x", throwing, BACKGROUND_CONTEXT), env.createTempFile(undefined, changingTempContext),
      env.writeFile("x", binary, BACKGROUND_CONTEXT), env.appendFile("x", binary, BACKGROUND_CONTEXT), env.joinPath(new Proxy(["x"], { get() { throw new Error("parts getter"); } }), BACKGROUND_CONTEXT),
    ]);
    expect(results.map((result) => result.ok ? "ok" : result.error.code)).toEqual(["unknown", "unknown", "unknown", "unknown", "unknown", "unknown", "unknown"]);
  });

  test("filesystem results are normalized copied and type checked", async () => {
    const delegate = new FakeExecutionEnv("/root"); const env = adapter(delegate);
    delegate.rejectAllFiles = true; const direct = await env.readTextFile("a/../secret.txt", BACKGROUND_CONTEXT);
    expect(!direct.ok && direct.error.code).toBe("unknown"); expect(!direct.ok && direct.error.path).toBe("/root/secret.txt");
    delegate.rejectAllFilesWithThrow = true; const rejected = await env.exists("a/../secret.txt", BACKGROUND_CONTEXT);
    expect(!rejected.ok && rejected.error.code).toBe("unknown"); expect(!rejected.ok && rejected.error.path).toBe("/root/secret.txt");

    const malformed = adapter(delegateWith({ ok: true, value: 3 }));
    expect((await malformed.readTextFile("x", BACKGROUND_CONTEXT)).ok).toBeFalse();
    const changing = adapter(delegateWith(changingResult("ok", true, false, "value", "safe")));
    expect((await changing.readTextFile("x", BACKGROUND_CONTEXT)).ok).toBeFalse();
    const bytes = new Uint8Array([1, 2]); const copied = adapter(delegateWith(Result.ok(bytes))); const read = await copied.readBinaryFile("x", BACKGROUND_CONTEXT); bytes[0] = 9;
    expect(read.ok && [...read.value]).toEqual([1, 2]);
    const info = { name: "x", path: "/root/x", kind: "file", size: 1, mtimeMs: 1 } as const;
    const infoResult = await adapter(delegateWith(Result.ok(info))).fileInfo("x", BACKGROUND_CONTEXT);
    expect(infoResult.ok && Object.isFrozen(infoResult.value)).toBeTrue();
    expect((await adapter(delegateWith(Result.ok(["a", "b"]))).readTextLines("x", undefined, BACKGROUND_CONTEXT)).ok).toBeTrue();
    expect((await adapter(delegateWith(Result.ok(true))).exists("x", BACKGROUND_CONTEXT)).ok).toBeTrue();
    expect((await adapter(delegateWith(Result.ok(undefined))).remove("x", undefined, BACKGROUND_CONTEXT)).ok).toBeTrue();
    expect((await adapter(delegateWith(Result.ok([info]))).listDir("x", BACKGROUND_CONTEXT)).ok).toBeTrue();
    expect((await adapter(delegateWith(Result.ok({ ...info, size: -1 }))).fileInfo("x", BACKGROUND_CONTEXT)).ok).toBeFalse();
    expect((await adapter(delegateWith(Result.ok({ ...info, size: 1.5 }))).fileInfo("x", BACKGROUND_CONTEXT)).ok).toBeFalse();
    expect((await adapter(delegateWith(Result.ok({ ...info, mtimeMs: -1 }))).fileInfo("x", BACKGROUND_CONTEXT)).ok).toBeFalse();
    expect((await adapter(delegateWith(Result.ok({ ...info, mtimeMs: Number.POSITIVE_INFINITY }))).fileInfo("x", BACKGROUND_CONTEXT)).ok).toBeFalse();
  });

  test("shell options results callbacks and preparation failures remain bounded and sanitized", async () => {
    const hostileContext = changingField("abortSignal", undefined, { aborted: false });
    expect((await adapter().exec("x", undefined, hostileContext)).ok).toBeFalse();
    for (const timeout of [Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY, 0, -1, 2_147_483.648]) {
      const result = await adapter().exec("x", { timeout }, BACKGROUND_CONTEXT); expect(!result.ok && result.error.code).toBe("timeout");
    }
    expect((await adapter().exec("x", { timeout: 2_147_483.647 }, BACKGROUND_CONTEXT)).ok).toBeTrue();
    for (const capture of [
      null,
      {},
      { limits: null },
      { limits: { maxBytes: 0, maxLines: 1 } },
      { limits: { maxBytes: 1, maxLines: 0 } },
      { limits: { maxBytes: 1, maxLines: 1, retain: "middle" } },
      { limits: { maxBytes: 1, maxLines: 1 }, spill: "yes" },
      changingField("limits", { maxBytes: 1, maxLines: 1 }, { maxBytes: 1, maxLines: 1 }),
    ]) {
      const result = await adapter().exec("x", { capture } as never, BACKGROUND_CONTEXT);
      expect(!result.ok && result.error.code).toBe("unknown");
    }
    const leaked = new Error(`preparer ${SECRET}`); (leaked as Error & { secret?: string }).secret = SECRET;
    const prepared = new PiclawExecutionEnv(new FakeExecutionEnv("/root"), () => { throw leaked; }); const failure = await prepared.exec("x", undefined, BACKGROUND_CONTEXT);
    expect(!failure.ok && failure.error.code).toBe("unknown"); expect(JSON.stringify(!failure.ok && failure.error)).not.toContain(SECRET); expect(!failure.ok && failure.error.cause).toBeUndefined();

    const malformed = await adapter(delegateWith({ ok: true, value: shellResult(1.5) })).exec("x", captureOptions(), BACKGROUND_CONTEXT);
    expect(!malformed.ok && malformed.error.code).toBe("unknown");
    expect((await adapter(delegateWith(Result.ok(shellResult(Number.MAX_SAFE_INTEGER + 1)))).exec("x", captureOptions(), BACKGROUND_CONTEXT)).ok).toBeFalse();
    const changing = await adapter(delegateWith(changingResult("ok", true, false, "value", shellResult()))).exec("x", captureOptions(), BACKGROUND_CONTEXT);
    expect(!changing.ok && changing.error.code).toBe("unknown");
    const changingOutput = await adapter(delegateWith(Result.ok(changingOutputValue()))).exec("x", captureOptions(), BACKGROUND_CONTEXT);
    expect(!changingOutput.ok && changingOutput.error.code).toBe("unknown");
    const callbackDelegate = new FakeExecutionEnv("/root"); callbackDelegate.script({ _tag: "result", stdout: "x", stderr: "", exitCode: 0 });
    const callback = await adapter(callbackDelegate).exec("x", { ...captureOptions(), onUpdate() { throw new Error("callback"); } }, BACKGROUND_CONTEXT);
    expect(!callback.ok && callback.error.code).toBe("callback_error");
    const typed = await adapter(delegateWith(Result.err(new ExecutionError("spawn_error", "no")))).exec("x", captureOptions(), BACKGROUND_CONTEXT);
    expect(!typed.ok && typed.error.code).toBe("spawn_error");
    const mutableTruncation = truncationMetadata(); const mutableValue = { exitCode: 0, truncation: mutableTruncation };
    const copied = await adapter(delegateWith(Result.ok(mutableValue))).exec("x", captureOptions(), BACKGROUND_CONTEXT); mutableTruncation.totalBytes = 2;
    expect(copied.ok && copied.value.truncation.totalBytes === 1 && Object.isFrozen(copied.value) && Object.isFrozen(copied.value.truncation)).toBeTrue();

    const postTerminalDelegate = new FakeExecutionEnv("/root"); let postTerminal!: () => void; let callbackCalls = 0;
    Object.defineProperty(postTerminalDelegate, "exec", { value: async (_command: string, options: ShellExecOptions | undefined, context: Context) => {
      options?.onUpdate?.(shellUpdate() as never, context);
      postTerminal = () => options?.onUpdate?.(throwingField("kind"), context);
      return Result.ok(shellResult());
    } });
    const postTerminalResult = await adapter(postTerminalDelegate).exec("x", { ...captureOptions(), onUpdate(update, context) {
      callbackCalls += 1; expect(update).toEqual(shellUpdate()); expect(context).toBe(BACKGROUND_CONTEXT);
    } }, BACKGROUND_CONTEXT);
    expect(postTerminalResult.ok).toBeTrue(); expect(postTerminal).not.toThrow(); expect(callbackCalls).toBe(1);
  });

  test("cleanup rejection is absorbed once", async () => {
    const delegate = new FakeExecutionEnv("/root"); delegate.throwCleanup = true; const env = adapter(delegate);
    await env.cleanup(BACKGROUND_CONTEXT); await env.cleanup(BACKGROUND_CONTEXT); expect(delegate.cleanupCalls).toBe(1);
  });
});

describe("EF-H01 SSH factory normalization and cleanup", () => {
  test("copies closed failures including credential_unavailable", async () => {
    const source = { _tag: "credential_unavailable", certainty: "not_applied", retryable: false, secret: SECRET } as const;
    const factory = new CurrentPiclawSshExecutionEnvFactory(() => Result.err(source), () => ({}));
    const result = await factory.createSshEnv(profile());
    expect(!result.ok && result.error).toEqual({ _tag: "credential_unavailable", certainty: "not_applied", retryable: false });
    expect(JSON.stringify(result)).not.toContain(SECRET);
  });

  test("changing result/error fields are rejected without leaking", async () => {
    const changing = new CurrentPiclawSshExecutionEnvFactory(() => changingResult("ok", false, true, "error", { _tag: "credential_unavailable", certainty: "not_applied", retryable: false, secret: SECRET }) as never, () => ({}));
    const result = await changing.createSshEnv(profile()); expect(!result.ok && result.error._tag).toBe("environment_unavailable"); expect(JSON.stringify(result)).not.toContain(SECRET);
    const errorChanging = new CurrentPiclawSshExecutionEnvFactory(() => Result.err(changingError()) as never, () => ({}));
    expect((await errorChanging.createSshEnv(profile())).ok).toBeFalse();
  });

  test("invalid or mismatched environments clean up with their receiver and hostile cleanup getters stay bounded", async () => {
    for (const candidate of [cleanupCandidate("/wrong"), hostileCleanupCandidate()]) {
      const factory = new CurrentPiclawSshExecutionEnvFactory(() => Result.ok(candidate as never), () => ({}));
      const result = await factory.createSshEnv(profile()); expect(result.ok).toBeFalse(); expect(candidate.calls).toBe(1);
    }
    const changingCwd = cleanupCandidate("/remote"); let reads = 0; Object.defineProperty(changingCwd, "cwd", { configurable: true, get() { return reads++ === 0 ? "/remote" : "/changed"; } });
    const factory = new CurrentPiclawSshExecutionEnvFactory(() => Result.ok(changingCwd as never), () => ({}));
    expect((await factory.createSshEnv(profile())).ok).toBeFalse(); expect(changingCwd.calls).toBe(1);
  });
});

function createCurrentResolver(factory: () => never) { return new CurrentPiclawExecutionContextResolver(operationLookup(), routeLookup(), profileLookup(), { createLocalEnv: factory }, { createSshEnv: factory }); }
function createFakeResolver(factory: () => never) { return new FakeExecutionContextResolver(operationLookup(), routeLookup(), profileLookup(), { createLocalEnv: factory }, { createSshEnv: factory }); }
function operationLookup() { return { getOperationSnapshot: () => ({ chatJid: "chat", operationId: "operation", version: 1 }) }; }
function routeLookup() { return { getCurrentRoute: () => ({ kind: "local" } as const) }; }
function profileLookup() { return { getSshProfile: () => null }; }
function localRequest() { return { chatJid: "chat", operationId: "operation", expectedOperationVersion: 1, requestedRoute: "local" as const }; }
function adapter(delegate = new FakeExecutionEnv("/root")): PiclawExecutionEnv { return new PiclawExecutionEnv(delegate, () => ({})); }
function delegateWith(result: unknown): FakeExecutionEnv {
  const delegate = new FakeExecutionEnv("/root");
  for (const method of ["absolutePath", "joinPath", "readTextFile", "readTextLines", "readBinaryFile", "writeFile", "appendFile", "renameFile", "fileInfo", "listDir", "canonicalPath", "exists", "createDir", "remove", "createTempDir", "createTempFile"] as const) Object.defineProperty(delegate, method, { value: async () => result });
  Object.defineProperty(delegate, "exec", { value: async () => result }); return delegate;
}
function changingField(field: string, first: unknown, second: unknown): never { let reads = 0; return { get [field]() { return reads++ === 0 ? first : second; } } as never; }
function throwingField(field: string): never { return { get [field]() { throw new Error("getter"); } } as never; }
function changingResult(field: string, first: unknown, second: unknown, stableField: string, stableValue: unknown): object { let reads = 0; return { get [field]() { return reads++ === 0 ? first : second; }, [stableField]: stableValue }; }
function captureOptions() { return { capture: { limits: { maxBytes: 16, maxLines: 4, retain: "tail" as const } } }; }
function truncationMetadata() { return { truncated: false, truncatedBy: null, totalLines: 1, totalBytes: 1, outputLines: 1, outputBytes: 1, lastLinePartial: false, firstLineExceedsLimit: false, maxLines: 4, maxBytes: 16 }; }
function shellResult(exitCode = 0) { return { exitCode, truncation: truncationMetadata() }; }
function shellUpdate() { return { kind: "replace", output: { text: "x", truncation: truncationMetadata() } }; }
function changingOutputValue(): object { let reads = 0; return { exitCode: 0, truncation: { ...truncationMetadata(), get totalBytes() { return reads++ === 0 ? 1 : 2; } } }; }
function changingError(): object { let reads = 0; return { get _tag() { return reads++ === 0 ? "credential_unavailable" : "environment_unavailable"; }, certainty: "not_applied", retryable: false, secret: SECRET }; }
function profile() { return { profileId: "p", transportRef: "t", cwd: "/remote" } as const; }
function cleanupCandidate(cwd: string): FakeExecutionEnv & { calls: number } { const value = new FakeExecutionEnv(cwd) as FakeExecutionEnv & { calls: number }; value.calls = 0; Object.defineProperty(value, "cleanup", { value: function(this: typeof value) { this.calls += 1; return Promise.resolve(); } }); return value; }
function hostileCleanupCandidate(): FakeExecutionEnv & { calls: number } { const value = cleanupCandidate("/remote"); let reads = 0; Object.defineProperty(value, "absolutePath", { configurable: true, get() { if (reads++ === 0) return FakeExecutionEnv.prototype.absolutePath; throw new Error("method getter"); } }); return value; }
