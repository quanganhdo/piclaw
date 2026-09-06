import { describe, expect, test } from "bun:test";

import type {
  EarendilV3ContextShape,
  EarendilV3ExecutionEnvShape,
  EarendilV3JsonlSessionRepoOptionsShape,
  EarendilV3MemorySessionRepoOptionsShape,
  EarendilV3HarnessActivationBlockShape,
  EarendilV3PiclawToolContextShape,
  EarendilV3ResultShape,
  EarendilV3SelectionGateShape,
  EarendilV3SessionRepoShape,
  EarendilV3ShellExecOptionsShape,
  EarendilV3ShellOutputUpdateShape,
  EarendilV3ToolExecuteShape,
  EarendilV3ToolInvocationShape,
  EarendilV3ToolResultShape,
  EarendilV3UsageEventShape,
  PiclawV3ProjectionEnvelopeShape,
  EarendilV3UsageRowShape,
} from "../../src/service-effects/earendil-harness-v3-compatibility/preparation-contract.js";

function assignable<TExpected, _TActual extends TExpected>(): true {
  return true;
}

type MethodArities<T> = {
  readonly [TKey in keyof T]: T[TKey] extends (...args: infer TArgs) => unknown ? TArgs["length"] : 0;
};

type FileResult<T> = Promise<EarendilV3ResultShape<T, Error>>;

describe("latent corrected-0.85.x Harness v3 preparation contract", () => {
  test("keeps immutable Context cancellation explicit on every effect boundary", () => {
    expect(assignable<Readonly<{ abortSignal: AbortSignal | undefined }>, EarendilV3ContextShape>()).toBeTrue();
    expect(assignable<"abortSignal" | "value" | "toString", keyof EarendilV3ContextShape>()).toBeTrue();
    const methods: MethodArities<EarendilV3ExecutionEnvShape> = {
      cwd: 0,
      absolutePath: 2,
      joinPath: 2,
      readTextFile: 2,
      readTextLines: 3,
      readBinaryFile: 2,
      writeFile: 3,
      appendFile: 3,
      renameFile: 3,
      fileInfo: 2,
      listDir: 2,
      canonicalPath: 2,
      exists: 2,
      createDir: 3,
      remove: 3,
      createTempDir: 2,
      createTempFile: 2,
      exec: 3,
      cleanup: 1,
    };
    expect(methods).toEqual({
      cwd: 0,
      absolutePath: 2,
      joinPath: 2,
      readTextFile: 2,
      readTextLines: 3,
      readBinaryFile: 2,
      writeFile: 3,
      appendFile: 3,
      renameFile: 3,
      fileInfo: 2,
      listDir: 2,
      canonicalPath: 2,
      exists: 2,
      createDir: 3,
      remove: 3,
      createTempDir: 2,
      createTempFile: 2,
      exec: 3,
      cleanup: 1,
    });
  });

  test("records the six-argument tool call and durable invocation identity", () => {
    type Execute = EarendilV3ToolExecuteShape<Record<string, unknown>, unknown>;
    type ParametersUnderTest = Parameters<Execute>;
    expect(assignable<
      readonly [
        string,
        Record<string, unknown>,
        ParametersUnderTest[2],
        EarendilV3PiclawToolContextShape,
        EarendilV3ToolInvocationShape,
        EarendilV3ContextShape,
      ],
      Readonly<ParametersUnderTest>
    >()).toBeTrue();
    const parameterCount: ParametersUnderTest["length"] = 6;
    expect(parameterCount).toBe(6);
  });

  test("keeps bounded shell capture and Context-aware updates in the target shape", () => {
    type Options = EarendilV3ShellExecOptionsShape;
    type Update = EarendilV3ShellOutputUpdateShape;
    const capture: NonNullable<Options["capture"]> = {
      limits: { maxBytes: 64 * 1024, maxLines: 2_000, retain: "tail" },
      spill: true,
    };
    const updateKinds: Update["kind"][] = ["replace", "append", "slide", "metadata"];
    expect(capture).toEqual({ limits: { maxBytes: 65_536, maxLines: 2_000, retain: "tail" }, spill: true });
    expect(updateKinds).toEqual(["replace", "append", "slide", "metadata"]);
  });

  test("uses no-throw Result shapes and typed usage/event records", () => {
    const ok: EarendilV3ResultShape<number, Error> = { ok: true, value: 1 };
    const failure: EarendilV3ResultShape<number, Error> = { ok: false, error: new Error("failed") };
    const usage = {
      input: 1,
      output: 2,
      cacheRead: 3,
      cacheWrite: 4,
      totalTokens: 10,
      cost: { input: 0.1, output: 0.2, cacheRead: 0, cacheWrite: 0, total: 0.3 },
    } as const;
    const row: EarendilV3UsageRowShape = { id: "usage-1", seq: 1, usage, adjustment: false };
    const event: EarendilV3UsageEventShape = { type: "usage", lane: "main", row, totals: usage };
    expect(ok.ok).toBeTrue();
    expect(failure.ok).toBeFalse();
    expect(event.row).toBe(row);
    expect(event.totals.totalTokens).toBe(10);
  });

  test("records Memory/JSONL-compatible SessionRepo method shape without selecting a backend", () => {
    type Repo = EarendilV3SessionRepoShape<
      Readonly<{ id: string; storageVersion: number }>,
      Readonly<{ id?: string; cwd?: string }>,
      Readonly<{ cwd?: string }>,
      Readonly<{ scope: "branch" | "tree" }>,
      Readonly<{ metadata: unknown }>
    >;
    type Expected = Readonly<{
      create: 2;
      open: 2;
      list: 2;
      delete: 2;
      fork: 3;
    }>;
    const arity: Expected = { create: 2, open: 2, list: 2, delete: 2, fork: 3 };
    expect(assignable<Expected, MethodArities<Repo>>()).toBeTrue();
    expect(assignable<keyof Expected, keyof Repo>()).toBeTrue();
    const memory: EarendilV3MemorySessionRepoOptionsShape = { now: () => 1 };
    const jsonl = { sessionsRoot: "/sessions", now: () => 1 } as unknown as EarendilV3JsonlSessionRepoOptionsShape;
    expect(arity).toEqual({ create: 2, open: 2, list: 2, delete: 2, fork: 3 });
    expect(memory.now?.()).toBe(1);
    expect(jsonl.sessionsRoot).toBe("/sessions");
  });

  test("keeps typed Harness events behind Piclaw owner and generation fencing", () => {
    const usage = {
      input: 1,
      output: 2,
      cacheRead: 0,
      cacheWrite: 0,
      totalTokens: 3,
      cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
    } as const;
    const envelope: PiclawV3ProjectionEnvelopeShape = {
      chatJid: "chat-1",
      operationId: "piclaw-operation-1",
      harnessOperationId: "earendil-operation-1",
      watchGeneration: 2,
      receiptSeq: 3,
      event: {
        type: "usage",
        lane: "main",
        row: { id: "usage-1", seq: 1, usage, adjustment: false },
        totals: usage,
      },
    };
    expect(envelope.operationId).toBe("piclaw-operation-1");
    expect(envelope.harnessOperationId).toBe("earendil-operation-1");
    expect(envelope.watchGeneration).toBe(2);
  });

  test("keeps 0.85.0, watchSession, and Harness activation blocked", () => {
    type Watch = EarendilV3HarnessActivationBlockShape["watchSession"];
    type Gate = EarendilV3SelectionGateShape;
    expect(assignable<
      (context: EarendilV3ContextShape) => Promise<never>,
      Watch
    >()).toBeTrue();
    const gate: Gate = {
      productionVersion: "0.84.4",
      assessedVersion: "0.85.0",
      assessedReleaseCommit: "107d79f11072bbc8a3a757ed7fd69596bee7d68c",
      nextCandidate: "corrected_0.85.1_or_later",
      packageClosure: "fresh_coding_agent_root_import_must_resolve_pi_server_transitively",
      directPiServerWorkaround: "forbidden",
      watchSession: "must_be_implemented_or_explicitly_excluded",
      harnessActivation: "blocked",
      productionImporter: "forbidden",
    };
    expect(gate).toEqual({
      productionVersion: "0.84.4",
      assessedVersion: "0.85.0",
      assessedReleaseCommit: "107d79f11072bbc8a3a757ed7fd69596bee7d68c",
      nextCandidate: "corrected_0.85.1_or_later",
      packageClosure: "fresh_coding_agent_root_import_must_resolve_pi_server_transitively",
      directPiServerWorkaround: "forbidden",
      watchSession: "must_be_implemented_or_explicitly_excluded",
      harnessActivation: "blocked",
      productionImporter: "forbidden",
    });
  });

  test("does not turn typed records into runtime implementations", () => {
    expect(assignable<
      Promise<EarendilV3ToolResultShape<unknown>>,
      ReturnType<EarendilV3ToolExecuteShape<unknown, unknown>>
    >()).toBeTrue();
    expect(assignable<FileResult<string>, FileResult<string>>()).toBeTrue();
  });
});
