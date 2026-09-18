import "../helpers.js";

import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { describe, expect, test } from "bun:test";
import { Result, applyShellOutputUpdate, type ShellOutputUpdate, type ShellOutputView } from "@earendil-works/pi-agent-core";
import { BACKGROUND_CONTEXT, withAbortSignal } from "@earendil-works/pi-agent-core/harness/context";

import type { NormalisedEffectTrace } from "../../src/service-effects/contracts/common.js";
import { CurrentPiclawExecutionContextResolver } from "../../src/service-effects/current-piclaw/execution-context-resolver.js";
import type {
  ExecutionRouteSnapshotLookup,
  LocalExecutionEnvFactory,
  ServiceOperationSnapshotLookup,
  SshExecutionEnvFactory,
  SshExecutionProfileSnapshotLookup,
} from "../../src/service-effects/current-piclaw/execution-context-types.js";
import { PiclawExecutionEnv } from "../../src/service-effects/current-piclaw/execution-env-adapter.js";
import { CurrentPiclawLocalExecutionEnvFactory } from "../../src/service-effects/current-piclaw/local-execution-env.js";
import { CurrentPiclawSshExecutionEnvFactory } from "../../src/service-effects/current-piclaw/ssh-execution-env.js";
import { defineExecutionContextResolverContract, type ExecutionContextResolverContractSubject } from "../../src/service-effects/testing/contract-suites/execution-context-resolver-contract.js";
import type { ContractSubjectFactory, ContractTestContext } from "../../src/service-effects/testing/contract-suite.js";
import { ManualEffectClock, SequenceEffectIdSource } from "../../src/service-effects/testing/deterministic-controls.js";
import { DeterministicFaultPlan } from "../../src/service-effects/testing/fault-plan.js";
import { FakeExecutionContextResolver } from "../../src/service-effects/testing/fakes/fake-execution-context-resolver.js";
import { FakeExecutionEnv } from "../../src/service-effects/testing/fakes/fake-execution-env.js";

function createContext(): ContractTestContext {
  return { clock: new ManualEffectClock("2026-08-13T00:00:00.000Z"), ids: new SequenceEffectIdSource("context"), faults: new DeterministicFaultPlan() };
}

for (const [name, fake] of [["current-Piclaw adapter", false], ["independent deterministic fake", true]] as const) {
  describe(`EF-H01 ExecutionContextResolver shared contract: ${name}`, () => {
    test("parameterized contract", async () => {
      expect(await defineExecutionContextResolverContract(subjectFactory(name, fake), createContext)).toHaveLength(12);
    });
  });
}

describe("EF-H01 local NodeExecutionEnv adapter under Bun", () => {
  test("creates fresh snapshots and owns timeout, abort, and cleanup process groups", async () => {
    const cwd = await mkdtemp(join(tmpdir(), "piclaw-ef-h01-"));
    const factory = new CurrentPiclawLocalExecutionEnvFactory({ cwd, prepareShellEnvironment: () => ({ PATH: process.env.PATH ?? "/usr/bin:/bin" }) });
    const first = factory.createLocalEnv(); const second = factory.createLocalEnv();
    expect(first.ok && second.ok).toBeTrue();
    if (!first.ok || !second.ok) return;
    expect(first.value).not.toBe(second.value);
    const timeoutPids: number[] = [];
    const capture = { limits: { maxBytes: 4096, maxLines: 20, retain: "head" as const } };
    const timed = await first.value.exec("sleep 30 & echo \"$$ $!\"; wait", { timeout: 0.05, capture, onUpdate: collectPids(timeoutPids) }, BACKGROUND_CONTEXT);
    expect(timed.ok).toBeFalse(); expect(!timed.ok && timed.error.code).toBe("timeout");
    await expectGone(timeoutPids);

    const abort = new AbortController(); const abortPids: number[] = []; let started!: () => void;
    const observed = new Promise<void>((resolve) => { started = resolve; });
    const pending = first.value.exec("sleep 30 & echo \"$$ $!\"; wait", { capture, onUpdate: collectPids(abortPids, started) }, withAbortSignal(abort.signal, BACKGROUND_CONTEXT));
    await observed;
    await second.value.cleanup(BACKGROUND_CONTEXT);
    expect(abortPids.every(isAlive)).toBeTrue();
    abort.abort(); const aborted = await pending;
    expect(aborted.ok).toBeFalse(); expect(!aborted.ok && aborted.error.code).toBe("aborted");
    await expectGone(abortPids);
    await first.value.cleanup(BACKGROUND_CONTEXT); await first.value.cleanup(BACKGROUND_CONTEXT); await rm(cwd, { recursive: true, force: true });
  }, 10_000);
});

function subjectFactory(name: string, fake: boolean): ContractSubjectFactory<ExecutionContextResolverContractSubject> {
  let state = new SubjectState(fake);
  return {
    name,
    create() { state = new SubjectState(fake); return state.subject(); },
    async crashAndRestore(subject, context) {
      await Promise.all([...subject.createdLocals(), ...subject.createdRemotes()].map((env) => env.cleanup(BACKGROUND_CONTEXT)));
      state = state.restore();
      return { subject: state.subject(), context };
    },
    inspectTrace() { return state.traceSnapshot(); },
  };
}

class SubjectState {
  private operation: unknown = { chatJid: "chat-1", operationId: "operation-1", version: 1 };
  private route: unknown = { kind: "ssh", profileId: "profile-1" };
  private profile: unknown = { profileId: "profile-1", transportRef: "transport-a", cwd: "/remote/a" };
  private operationFault: CallbackFault = null; private routeFault: CallbackFault = null; private profileFault: CallbackFault = null;
  private localFault: FactoryFault = null; private remoteFault: FactoryFault = null; private preparedEnvironmentFault: PreparedEnvironmentFault = null;
  private readonly callbackCounts = { operation: 0, route: 0, profile: 0, local: 0, remote: 0 };
  private readonly locals: FakeExecutionEnv[] = []; private readonly remotes: FakeExecutionEnv[] = [];
  private readonly traces: NormalisedEffectTrace[] = [];
  private nextRemoteDisconnect: boolean | null = null;
  private readonly secret = "fixture-auth-value";

  constructor(private readonly fake: boolean) {}

  restore(): SubjectState {
    const restored = new SubjectState(this.fake);
    restored.operation = this.operation; restored.route = this.route; restored.profile = this.profile;
    restored.traces.push(...this.traces);
    return restored;
  }

  subject(): ExecutionContextResolverContractSubject {
    const operationLookup: ServiceOperationSnapshotLookup = { getOperationSnapshot: () => { this.callbackCounts.operation += 1; return callback(this.operationFault, this.operation); } };
    const routeLookup: ExecutionRouteSnapshotLookup = { getCurrentRoute: () => { this.callbackCounts.route += 1; return callback(this.routeFault, this.route); } };
    const profileLookup: SshExecutionProfileSnapshotLookup = { getSshProfile: () => { this.callbackCounts.profile += 1; return callback(this.profileFault, this.profile); } };
    const localFactory: LocalExecutionEnvFactory = { createLocalEnv: () => { this.callbackCounts.local += 1; return this.createEnvironment("local"); } };
    const remoteFactory: SshExecutionEnvFactory = this.fake
      ? { createSshEnv: (profile) => { this.callbackCounts.remote += 1; return this.createEnvironment("remote", profile.cwd, profile.transportRef); } }
      : new CurrentPiclawSshExecutionEnvFactory(
        (profile) => {
          this.callbackCounts.remote += 1;
          if (this.remoteFault === "throw") throw new Error("remote factory fault");
          if (this.remoteFault === "thenable") return rejectingThenable() as PromiseLike<never> as Promise<never>;
          if (this.remoteFault === "malformed") return { ok: true, value: { cwd: profile.cwd } } as unknown as ReturnType<SshExecutionEnvFactory["createSshEnv"]>;
          return this.createEnvironment("remote", profile.cwd, profile.transportRef);
        },
        () => this.prepareEnvironment(),
      );
    const resolver = this.fake
      ? new FakeExecutionContextResolver(operationLookup, routeLookup, profileLookup, localFactory, remoteFactory)
      : new CurrentPiclawExecutionContextResolver(operationLookup, routeLookup, profileLookup, localFactory, remoteFactory);
    return {
      resolver,
      setOperation: (value) => { this.operation = value; }, setRoute: (value) => { this.route = value; }, setProfile: (value) => { this.profile = value; }, mutateProfile: (value) => { this.profile = value; },
      setOperationFault: (value) => { this.operationFault = value; }, setRouteFault: (value) => { this.routeFault = value; }, setProfileFault: (value) => { this.profileFault = value; },
      setLocalFactoryFault: (value) => { this.localFault = value; }, setRemoteFactoryFault: (value) => { this.remoteFault = value; }, setPreparedEnvironmentFault: (value) => { this.preparedEnvironmentFault = value; },
      counts: () => Object.freeze({ ...this.callbackCounts }), createdLocals: () => this.locals, createdRemotes: () => this.remotes,
      scriptRemoteDisconnect: (afterSubmission) => { this.nextRemoteDisconnect = afterSubmission; },
      traceText: () => JSON.stringify(this.traces), secretFixture: () => this.secret,
    };
  }

  traceSnapshot(): readonly NormalisedEffectTrace[] { return Object.freeze(this.traces.map((entry) => Object.freeze({ ...entry }))); }

  private createEnvironment(kind: "local" | "remote", cwd = "/local", routeId = "local") {
    const fault = kind === "local" ? this.localFault : this.remoteFault;
    if (fault === "throw") throw new Error(`${kind} factory fault`);
    if (fault === "thenable") return rejectingThenable();
    if (fault === "malformed") return { ok: true, value: { cwd } } as unknown as ReturnType<LocalExecutionEnvFactory["createLocalEnv"]>;
    const env = new FakeExecutionEnv(cwd, routeId, this.fake ? { EF_H01_FIXTURE_AUTH: this.secret } : {});
    if (kind === "remote" && this.nextRemoteDisconnect !== null) {
      env.script({ _tag: "disconnect", afterSubmission: this.nextRemoteDisconnect });
      this.nextRemoteDisconnect = null;
    }
    (kind === "local" ? this.locals : this.remotes).push(env);
    this.traces.push(Object.freeze({ contract: "EF-H01", method: "create", effectId: `${kind}-${kind === "local" ? this.locals.length : this.remotes.length}`, operationId: null, sourceSeq: null, version: null, certainty: null, resultTag: kind }));
    return Result.ok(new PiclawExecutionEnv(env, () => this.prepareEnvironment()));
  }

  private prepareEnvironment(): Record<string, string> | Promise<Record<string, string>> {
    if (this.preparedEnvironmentFault === "throw") throw new Error("prepared environment fault");
    if (this.preparedEnvironmentFault === "thenable") return rejectingThenable() as PromiseLike<never> as Promise<never>;
    if (this.preparedEnvironmentFault === "malformed") return { EF_H01_FIXTURE_AUTH: 1 } as unknown as Record<string, string>;
    if (this.preparedEnvironmentFault === "changing") return changingEnvironment() as unknown as Record<string, string>;
    return { EF_H01_FIXTURE_AUTH: this.secret };
  }
}

type CallbackFault = "throw" | "thenable" | null;
type FactoryFault = CallbackFault | "malformed";
type PreparedEnvironmentFault = CallbackFault | "malformed" | "changing";
function callback(fault: CallbackFault, value: unknown): never | unknown {
  if (fault === "throw") throw new Error("callback fault");
  if (fault === "thenable") return rejectingThenable();
  return value;
}
function rejectingThenable(): PromiseLike<never> { return { then(_resolve, reject) { reject?.(new Error("thenable fault")); } }; }
function changingEnvironment(): object { let reads = 0; return { get EF_H01_FIXTURE_AUTH() { return reads++ === 0 ? "first" : "second"; } }; }
function collectPids(pids: number[], started?: () => void): (update: ShellOutputUpdate) => void {
  let view: ShellOutputView | undefined;
  return (update) => {
    view = applyShellOutputUpdate(view, update);
    pids.splice(0, pids.length, ...readPids(view.text));
    if (pids.length >= 2) started?.();
  };
}
function readPids(chunk: string): number[] { return chunk.trim().split(/\s+/).map(Number).filter((value) => Number.isInteger(value) && value > 1); }
function isAlive(pid: number): boolean { try { process.kill(pid, 0); return true; } catch { return false; } }
async function expectGone(pids: readonly number[]): Promise<void> {
  expect(pids.length).toBeGreaterThanOrEqual(2);
  for (let attempt = 0; attempt < 100 && pids.some(isAlive); attempt += 1) await Bun.sleep(10);
  expect(pids.some(isAlive)).toBeFalse();
}
