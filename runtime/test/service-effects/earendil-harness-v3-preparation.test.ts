import { describe, expect, test } from "bun:test";

import type {
  AgentHarness,
  AgentHarnessToolUpdateCallback,
  AgentToolResult,
  ExecutionEnv,
  ExecutionError,
  FileError,
  HarnessEvent,
  Result,
  SessionSnapshot,
  ShellExecResult,
  WatchHandle,
} from "@earendil-works/pi-agent-core";
import type { Context, ContextKey } from "@earendil-works/pi-agent-core/harness/context";
import type {
  ForkOptions,
  JsonlSessionRepoOptions,
  MemorySessionRepoOptions,
  Session,
  SessionCreateOptions,
  SessionMetadata,
  SessionRepo,
  UsageRow,
} from "@earendil-works/pi-agent-core/harness/session";

import type {
  EarendilV3ContextKeyShape,
  EarendilV3ContextShape,
  EarendilV3ExecutionEnvShape,
  EarendilV3HarnessActivationBlockShape,
  EarendilV3Historical0850AssessmentShape,
  EarendilV3JsonlSessionRepoOptionsShape,
  EarendilV3MemorySessionRepoOptionsShape,
  EarendilV3PiclawToolContextShape,
  EarendilV3PublicWatchSessionShape,
  EarendilV3ResultShape,
  EarendilV3RuntimeWatchSessionStubShape,
  EarendilV3SelectionGateShape,
  EarendilV3SessionRepoShape,
  EarendilV3ShellExecOptionsShape,
  EarendilV3ShellOutputUpdateShape,
  EarendilV3ToolExecuteShape,
  EarendilV3ToolInvocationShape,
  EarendilV3ToolResultShape,
  EarendilV3UsageEventShape,
  EarendilV3UsageRowShape,
  EarendilV3UsageShape,
  PiclawV3ProjectionEnvelopeShape,
} from "../../src/service-effects/earendil-harness-v3-compatibility/preparation-contract.js";

type Equal<TLeft, TRight> =
  (<T>() => T extends TLeft ? 1 : 2) extends (<T>() => T extends TRight ? 1 : 2)
    ? (<T>() => T extends TRight ? 1 : 2) extends (<T>() => T extends TLeft ? 1 : 2) ? true : false
    : false;

function exact<_T extends true>(): true { return true; }

type MethodArguments<T> = {
  readonly [TKey in keyof T]: T[TKey] extends (...args: infer TArgs) => unknown ? TArgs : never;
};

describe("selected 0.85.1 Harness v3 preparation contract", () => {
  test("aliases public Context and every ExecutionEnv argument tuple", () => {
    expect(exact<Equal<EarendilV3ContextShape, Context>>()).toBeTrue();
    expect(exact<Equal<EarendilV3ContextKeyShape<string>, ContextKey<string>>>()).toBeTrue();
    expect(exact<Equal<EarendilV3ExecutionEnvShape, ExecutionEnv>>()).toBeTrue();

    type Expected = Readonly<{
      cwd: never;
      absolutePath: [string, Context];
      joinPath: [string[], Context];
      readTextFile: [string, Context];
      readTextLines: [string, { maxLines?: number } | undefined, Context];
      readBinaryFile: [string, Context];
      writeFile: [string, string | Uint8Array, Context];
      appendFile: [string, string | Uint8Array, Context];
      renameFile: [string, string, Context];
      fileInfo: [string, Context];
      listDir: [string, Context];
      canonicalPath: [string, Context];
      exists: [string, Context];
      createDir: [string, { recursive?: boolean } | undefined, Context];
      remove: [string, { recursive?: boolean; force?: boolean } | undefined, Context];
      createTempDir: [string | undefined, Context];
      createTempFile: [{ prefix?: string; suffix?: string } | undefined, Context];
      cleanup: [Context];
      exec: [string, EarendilV3ShellExecOptionsShape | undefined, Context];
    }>;
    expect(exact<Equal<MethodArguments<EarendilV3ExecutionEnvShape>, Expected>>()).toBeTrue();
  });

  test("uses the actual selected six-argument tool and result contracts", () => {
    type Actual = Parameters<EarendilV3ToolExecuteShape>;
    type Expected = [
      string,
      unknown,
      AgentHarnessToolUpdateCallback<unknown>,
      EarendilV3PiclawToolContextShape,
      EarendilV3ToolInvocationShape,
      Context,
    ];
    expect(exact<Equal<Actual, Expected>>()).toBeTrue();
    expect(exact<Equal<EarendilV3ToolResultShape<{ phase: number }>, AgentToolResult<{ phase: number }>>>()).toBeTrue();
    expect(exact<Equal<EarendilV3ResultShape<number, FileError>, Result<number, FileError>>>()).toBeTrue();
    expect(6 satisfies Actual["length"]).toBe(6);
  });

  test("retains selected bounded shell shapes", () => {
    type Options = EarendilV3ShellExecOptionsShape;
    type Update = EarendilV3ShellOutputUpdateShape;
    const capture: NonNullable<Options["capture"]> = {
      limits: { maxBytes: 64 * 1024, maxLines: 2_000, retain: "tail" },
      spill: true,
    };
    const updateKinds: Update["kind"][] = ["replace", "append", "slide", "metadata"];
    expect(exact<Equal<Awaited<ReturnType<ExecutionEnv["exec"]>>, Result<ShellExecResult, ExecutionError>>>()).toBeTrue();
    expect(capture).toEqual({ limits: { maxBytes: 65_536, maxLines: 2_000, retain: "tail" }, spill: true });
    expect(updateKinds).toEqual(["replace", "append", "slide", "metadata"]);
  });

  test("aliases selected Usage, UsageRow, and usage event records", () => {
    expect(exact<Equal<EarendilV3UsageRowShape, UsageRow>>()).toBeTrue();
    expect(exact<Equal<EarendilV3UsageShape, UsageRow["usage"]>>()).toBeTrue();
    expect(exact<Equal<EarendilV3UsageEventShape, Extract<HarnessEvent, { type: "usage" }>>>()).toBeTrue();

    const usage: EarendilV3UsageShape = {
      input: 1, output: 2, cacheRead: 3, cacheWrite: 4, totalTokens: 10,
      cost: { input: 0.1, output: 0.2, cacheRead: 0, cacheWrite: 0, total: 0.3 },
    };
    const row: EarendilV3UsageRowShape = { id: "usage-1", seq: 1, usage, adjustment: false };
    const event: EarendilV3UsageEventShape = { type: "usage", lane: "main", row, totals: usage };
    expect(event.row).toBe(row);
    expect(event.totals.totalTokens).toBe(10);
  });

  test("aliases selected SessionRepo and backend options without the old generic dialect", () => {
    expect(exact<Equal<EarendilV3SessionRepoShape, SessionRepo>>()).toBeTrue();
    expect(exact<Equal<EarendilV3MemorySessionRepoOptionsShape, MemorySessionRepoOptions>>()).toBeTrue();
    expect(exact<Equal<EarendilV3JsonlSessionRepoOptionsShape, JsonlSessionRepoOptions>>()).toBeTrue();

    type Expected = Readonly<{
      create: [SessionCreateOptions, Context];
      open: [SessionMetadata, Context];
      list: [void | undefined, Context];
      delete: [SessionMetadata, Context];
      fork: [SessionMetadata, ForkOptions, Context];
    }>;
    expect(exact<Equal<MethodArguments<EarendilV3SessionRepoShape>, Expected>>()).toBeTrue();
    expect(exact<Equal<Awaited<ReturnType<EarendilV3SessionRepoShape["fork"]>>, Session>>()).toBeTrue();
  });

  test("keeps typed Harness events behind Piclaw authority and generation fencing", () => {
    const usage: EarendilV3UsageShape = {
      input: 1, output: 2, cacheRead: 0, cacheWrite: 0, totalTokens: 3,
      cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
    };
    const envelope: PiclawV3ProjectionEnvelopeShape = {
      chatJid: "chat-1",
      operationId: "piclaw-operation-1",
      harnessOperationId: "earendil-operation-1",
      watchGeneration: 2,
      receiptSeq: 3,
      event: {
        type: "usage", lane: "main",
        row: { id: "usage-1", seq: 1, usage, adjustment: false }, totals: usage,
      },
    };
    expect(envelope.operationId).toBe("piclaw-operation-1");
    expect(envelope.harnessOperationId).toBe("earendil-operation-1");
    expect(envelope.watchGeneration).toBe(2);
  });

  test("distinguishes public watchSession return from the selected runtime stub", () => {
    type PublicReturn = ReturnType<EarendilV3PublicWatchSessionShape>;
    type StubReturn = ReturnType<EarendilV3RuntimeWatchSessionStubShape>;
    expect(exact<Equal<EarendilV3PublicWatchSessionShape, AgentHarness["watchSession"]>>()).toBeTrue();
    expect(exact<Equal<PublicReturn, Promise<WatchHandle<SessionSnapshot>>>>()).toBeTrue();
    expect(exact<Equal<StubReturn, Promise<never>>>()).toBeTrue();
    expect(exact<Equal<PublicReturn, StubReturn> extends false ? true : false>()).toBeTrue();
    expect(exact<Equal<EarendilV3HarnessActivationBlockShape["publicContract"], EarendilV3PublicWatchSessionShape>>()).toBeTrue();
    expect(exact<Equal<EarendilV3HarnessActivationBlockShape["selectedRuntimeStub"], EarendilV3RuntimeWatchSessionStubShape>>()).toBeTrue();
  });

  test("selects 0.85.1 while isolating historical 0.85.0 and gating live deployment", () => {
    const historical: EarendilV3Historical0850AssessmentShape = {
      assessedVersion: "0.85.0",
      assessedReleaseCommit: "107d79f11072bbc8a3a757ed7fd69596bee7d68c",
      disposition: "rejected",
      sourceOnlyExperimentalExports: "not_admitted",
      directPiServerWorkaround: "forbidden",
    };
    const gate: EarendilV3SelectionGateShape = {
      productionVersion: "0.84.4",
      selectedVersion: "0.85.1",
      selectedReleaseCommit: "d981de1229ef899957bbe968bc8dcda02a21f477",
      selectionScope: "candidate_branch_only",
      liveDeploymentRequiresApproval: true,
      packageClosure: "fresh_supported_coding_agent_root_imports_in_bun_and_supported_node_without_workarounds",
      watchSession: "public_contract_present_selected_runtime_stub_unsupported",
      harnessActivation: "blocked",
      productionImporter: "forbidden",
    };
    expect(gate.productionVersion).toBe("0.84.4");
    expect(gate.selectedVersion).toBe("0.85.1");
    expect(gate.liveDeploymentRequiresApproval).toBeTrue();
    expect(historical.disposition).toBe("rejected");
  });
});
