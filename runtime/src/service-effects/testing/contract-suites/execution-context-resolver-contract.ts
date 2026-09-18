import {
  applyShellOutputUpdate,
  BACKGROUND_CONTEXT,
  createContextKey,
  ExecutionError,
  withAbortSignal,
  withContextValue,
  type Context,
  type ExecutionEnv,
  type ShellOutputView,
} from "@earendil-works/pi-agent-core";

import type { ExecutionContextResolver, ResolveExecutionContextRequest } from "../../contracts/execution-context-resolver.js";
import { runParameterisedContractSuite, type ContractCaseResult, type ContractSubjectFactory, type ContractTestContext, type ParameterisedContractCase } from "../contract-suite.js";

export interface ExecutionContextResolverContractSubject {
  readonly resolver: ExecutionContextResolver;
  setOperation(value: unknown): void;
  setRoute(value: unknown): void;
  setProfile(value: unknown): void;
  setOperationFault(value: "throw" | "thenable" | null): void;
  setRouteFault(value: "throw" | "thenable" | null): void;
  setProfileFault(value: "throw" | "thenable" | null): void;
  setLocalFactoryFault(value: "throw" | "thenable" | "malformed" | null): void;
  setRemoteFactoryFault(value: "throw" | "thenable" | "malformed" | null): void;
  setPreparedEnvironmentFault(value: "throw" | "thenable" | "malformed" | "changing" | null): void;
  counts(): Readonly<{ operation: number; route: number; profile: number; local: number; remote: number }>;
  createdLocals(): readonly ExecutionEnv[];
  createdRemotes(): readonly ExecutionEnv[];
  mutateProfile(value: unknown): void;
  scriptRemoteDisconnect(afterSubmission: boolean): void;
  traceText(): string;
  secretFixture(): string;
}

export function defineExecutionContextResolverContract(
  factory: ContractSubjectFactory<ExecutionContextResolverContractSubject>,
  createContext: () => ContractTestContext,
): Promise<readonly ContractCaseResult[]> {
  return runParameterisedContractSuite(factory, cases, createContext);
}

const cases: readonly ParameterisedContractCase<ExecutionContextResolverContractSubject>[] = [
  {
    name: "EF-H01-C1 exact operation and version authority precedes all other callbacks",
    async run({ subject }) {
      const exact = await subject.resolver.resolve(request());
      assert(exact.ok, "exact operation must resolve");
      const afterExact = subject.counts();
      assert(afterExact.operation === 1 && afterExact.route === 1, "exact authority must precede route resolution");
      subject.setOperation(null);
      const missing = await subject.resolver.resolve(request());
      assert(!missing.ok && missing.error._tag === "operation_not_found" && missing.error.certainty === "not_applied", "missing operation must be a bounded pre-effect failure");
      subject.setOperation({ chatJid: "chat-1", operationId: "operation-1", version: 2 });
      const stale = await subject.resolver.resolve(request());
      assert(!stale.ok && stale.error._tag === "version_mismatch" && stale.error.certainty === "not_applied", "stale version must be a bounded pre-effect failure");
      assert(subject.counts().route === afterExact.route, "missing and stale authority must invoke no route/profile/env callback");
    },
  },
  {
    name: "EF-H01-C2 local and current-local selection create fresh immutable contexts",
    async run({ subject }) {
      subject.setRoute({ kind: "local" });
      const first = await subject.resolver.resolve(request("current")); const second = await subject.resolver.resolve(request("current"));
      const forced = await subject.resolver.resolve(request("local"));
      assert(first.ok && second.ok && forced.ok, "local selections must resolve");
      assert(first.value.env === first.value.localEnv && second.value.env === second.value.localEnv && forced.value.env === forced.value.localEnv, "local route env and localEnv must match within one context");
      assert(first.value.env !== second.value.env && first.value.env !== forced.value.env, "every admitted batch must receive a fresh environment");
      assert(Object.isFrozen(first.value) && Object.keys(first.value).sort().join(",") === "chatJid,env,localEnv,operationId", "context must be frozen and closed");
    },
  },
  {
    name: "EF-H01-C3 SSH route and profile snapshots cannot retarget admitted contexts",
    async run({ subject }) {
      const admitted = await subject.resolver.resolve(request());
      assert(admitted.ok && admitted.value.env !== admitted.value.localEnv, "SSH env must remain distinct from always-local localEnv");
      assert(admitted.ok && admitted.value.env.cwd === "/remote/a" && admitted.value.localEnv.cwd === "/local", "selected remote and local cwd must be exact");
      subject.mutateProfile({ profileId: "profile-1", transportRef: "transport-b", cwd: "/remote/b" });
      const later = await subject.resolver.resolve(request());
      assert(later.ok && later.value.env.cwd === "/remote/b", "later resolution must capture updated profile");
      assert(admitted.ok && admitted.value.env.cwd === "/remote/a", "already admitted environment must not retarget");
    },
  },
  {
    name: "EF-H01-C4 filesystem paths canonical paths and symlinks obey selected environment semantics",
    async run({ subject }) {
      const resolved = await subject.resolver.resolve(request()); assert(resolved.ok, "SSH context must resolve");
      const env = resolved.value.env;
      const written = await env.writeFile("dir/file.txt", "hello", BACKGROUND_CONTEXT); assert(written.ok, "relative write must succeed");
      const addressed = await env.absolutePath("dir/file.txt", BACKGROUND_CONTEXT); assert(addressed.ok && addressed.value === "/remote/a/dir/file.txt", "relative path must address selected cwd");
      const backend = subject.createdRemotes().at(-1) as ExecutionEnv & { link?(path: string, target: string): void };
      backend.link?.("link.txt", "dir/file.txt");
      const linked = await env.fileInfo("link.txt", BACKGROUND_CONTEXT); assert(linked.ok && linked.value.kind === "symlink", "fileInfo must not follow a symlink");
      const canonical = await env.canonicalPath("link.txt", BACKGROUND_CONTEXT); assert(canonical.ok && canonical.value === "/remote/a/dir/file.txt", "canonicalPath must explicitly resolve symlink");
    },
  },
  {
    name: "EF-H01-C5 every filesystem method resolves Result and adapter catches backend rejection",
    async run({ subject }) {
      const resolved = await subject.resolver.resolve(request()); assert(resolved.ok, "context must resolve");
      const env = resolved.value.env; const abort = new AbortController(); abort.abort();
      const abortedContext = withAbortSignal(abort.signal, BACKGROUND_CONTEXT);
      const aborted = await Promise.all([
        env.absolutePath("x", abortedContext), env.joinPath(["x"], abortedContext), env.readTextFile("x", abortedContext), env.readTextLines("x", undefined, abortedContext),
        env.readBinaryFile("x", abortedContext), env.writeFile("x", "x", abortedContext), env.appendFile("x", "x", abortedContext), env.renameFile("x", "y", abortedContext),
        env.fileInfo("x", abortedContext), env.listDir("x", abortedContext), env.canonicalPath("x", abortedContext), env.exists("x", abortedContext), env.createDir("x", undefined, abortedContext),
        env.remove("x", undefined, abortedContext), env.createTempDir("x", abortedContext), env.createTempFile(undefined, abortedContext),
      ]);
      assert(aborted.every((result) => !result.ok && result.error.code === "aborted"), "every FS method must resolve aborted Result");
      const backend = subject.createdRemotes().at(-1) as ExecutionEnv & { rejectAllFiles?: boolean; rejectAllFilesWithThrow?: boolean }; backend.rejectAllFiles = true;
      const directErrors = await allFileMethods(env, BACKGROUND_CONTEXT);
      assert(directErrors.every((result) => !result.ok && result.error.code === "unknown"), "every direct FileError must remain bounded");
      backend.rejectAllFilesWithThrow = true;
      const rejections = await allFileMethods(env, BACKGROUND_CONTEXT);
      assert(rejections.every((result) => !result.ok && result.error.code === "unknown"), "every delegated FS rejection must become FileError unknown");
    },
  },
  {
    name: "EF-H01-C6 shell success nonzero and typed errors stay direct",
    async run({ subject }) {
      const resolved = await subject.resolver.resolve(request()); assert(resolved.ok, "context must resolve");
      const backend = subject.createdRemotes().at(-1) as ExecutionEnv & { script(...steps: unknown[]): void };
      backend.script({ _tag: "result", stdout: "ok", stderr: "", exitCode: 0 }, { _tag: "result", stdout: "", stderr: "bad", exitCode: 7 }, { _tag: "error", error: new ExecutionError("spawn_error", "not started") });
      const success = await resolved.value.env.exec("one", undefined, BACKGROUND_CONTEXT); const nonzero = await resolved.value.env.exec("two", undefined, BACKGROUND_CONTEXT); const failed = await resolved.value.env.exec("three", undefined, BACKGROUND_CONTEXT);
      assert(success.ok && success.value.exitCode === 0 && success.value.truncation.totalBytes === 2, "success must preserve output metadata");
      assert(nonzero.ok && nonzero.value.exitCode === 7 && nonzero.value.truncation.totalBytes === 3, "nonzero exit is a successful shell result with output metadata");
      assert(!failed.ok && failed.error.code === "spawn_error", "typed execution error must remain direct");
    },
  },
  {
    name: "EF-H01-C7 timeout abort and cleanup stop only instance-owned process groups",
    async run({ subject }) {
      const one = await subject.resolver.resolve(request()); const two = await subject.resolver.resolve(request()); assert(one.ok && two.ok, "contexts must resolve");
      const first = subject.createdRemotes().at(-2) as ExecutionEnv & ScriptableProcessEnv; const second = subject.createdRemotes().at(-1) as ExecutionEnv & ScriptableProcessEnv;
      const timeoutGate = gate(); first.script({ _tag: "wait_for_stop", started: timeoutGate.started, release: timeoutGate.promise });
      const timed = one.value.env.exec("timeout", { timeout: 0.001 }, BACKGROUND_CONTEXT); await timeoutGate.waitStarted(); await delay(5); timeoutGate.release();
      const timeout = await timed; assert(!timeout.ok && timeout.error.code === "timeout" && first.killedGroups.length === 1, "timeout must stop its process group");
      const abortGate = gate(); second.script({ _tag: "wait_for_stop", started: abortGate.started, release: abortGate.promise }); const controller = new AbortController();
      const abortedPromise = two.value.env.exec("abort", undefined, withAbortSignal(controller.signal, BACKGROUND_CONTEXT)); await abortGate.waitStarted(); controller.abort(); abortGate.release();
      const aborted = await abortedPromise; assert(!aborted.ok && aborted.error.code === "aborted" && second.killedGroups.length === 1, "abort must stop its process group");
      assert(first.killedGroups.length === 1, "second context abort must not kill first context groups");
      second.throwCleanup = true; await two.value.env.cleanup(BACKGROUND_CONTEXT); await two.value.env.cleanup(BACKGROUND_CONTEXT);
      assert(second.cleanupCalls === 1, "adapter cleanup must be idempotent and non-rejecting");
    },
  },
  {
    name: "EF-H01-C8 SSH disconnect certainty distinguishes before effect and after submission",
    async run({ subject }) {
      subject.scriptRemoteDisconnect(false); const before = await subject.resolver.resolve(request()); assert(before.ok, "context must resolve");
      const notApplied = await before.value.env.exec("before", undefined, BACKGROUND_CONTEXT);
      assert(!notApplied.ok && notApplied.error.code === "spawn_error", "disconnect before submission must be bounded not-applied execution failure");
      subject.scriptRemoteDisconnect(true); const after = await subject.resolver.resolve(request()); assert(after.ok, "second context must resolve");
      const unknown = await after.value.env.exec("after", undefined, BACKGROUND_CONTEXT);
      assert(!unknown.ok && unknown.error.code === "unknown", "disconnect after submission must report unknown");
    },
  },
  {
    name: "EF-H01-C9 credentials remain consumed only by execution and absent from metadata and traces",
    async run({ subject }) {
      const resolved = await subject.resolver.resolve(request()); assert(resolved.ok, "context must resolve");
      const result = await resolved.value.env.exec("env", undefined, BACKGROUND_CONTEXT); assert(result.ok, "execution must consume prepared environment");
      const backend = subject.createdRemotes().at(-1) as ExecutionEnv & { observedShellEnvironments?: Array<Record<string, string> | undefined> };
      assert(backend.observedShellEnvironments?.at(-1)?.EF_H01_FIXTURE_AUTH === subject.secretFixture(), "prepared secret must reach only delegate execution environment");
      const metadata = { chatJid: resolved.value.chatJid, operationId: resolved.value.operationId, route: { kind: "ssh", profileId: "profile-1" }, profile: { profileId: "profile-1", transportRef: "transport-a", cwd: "/remote/a" }, trace: subject.traceText() };
      assert(!JSON.stringify(metadata).includes(subject.secretFixture()) && !("env" in metadata.profile), "secret environment must not enter metadata or traces");
    },
  },
  {
    name: "EF-H01-C10 hostile callbacks and malformed values settle as bounded typed failures",
    async run({ subject }) {
      for (const fault of ["throw", "thenable"] as const) {
        const beforeAuthorityFault = subject.counts(); subject.setOperationFault(fault); const operation = await subject.resolver.resolve(request()); assert(!operation.ok && operation.error._tag === "environment_unavailable", "operation callback fault must be bounded"); subject.setOperationFault(null);
        const afterAuthorityFault = subject.counts(); assert(afterAuthorityFault.route === beforeAuthorityFault.route && afterAuthorityFault.profile === beforeAuthorityFault.profile && afterAuthorityFault.local === beforeAuthorityFault.local && afterAuthorityFault.remote === beforeAuthorityFault.remote, "operation callback fault must invoke no downstream callback");
        subject.setRouteFault(fault); const route = await subject.resolver.resolve(request()); assert(!route.ok && route.error._tag === "route_unavailable", "route callback fault must be bounded"); subject.setRouteFault(null);
        subject.setProfileFault(fault); const profile = await subject.resolver.resolve(request()); assert(!profile.ok && profile.error._tag === "invalid_ssh_profile", "profile callback fault must be bounded"); subject.setProfileFault(null);
        subject.setLocalFactoryFault(fault); const local = await subject.resolver.resolve(request("local")); assert(!local.ok && local.error._tag === "environment_unavailable", "local env callback fault must be bounded"); subject.setLocalFactoryFault(null);
        const beforeRemoteFault = subject.createdLocals().length; subject.setRemoteFactoryFault(fault); const remote = await subject.resolver.resolve(request()); assert(!remote.ok && remote.error._tag === "environment_unavailable", "remote env callback fault must be bounded"); subject.setRemoteFactoryFault(null);
        const failedLocal = subject.createdLocals().at(beforeRemoteFault) as (ExecutionEnv & { cleanupCalls?: number }) | undefined; assert(failedLocal?.cleanupCalls === 1, "remote construction failure must clean its paired local environment");
      }
      subject.setOperation(hostile("version", 1, 2)); const hostileOperation = await subject.resolver.resolve(request()); assert(!hostileOperation.ok && hostileOperation.error._tag === "environment_unavailable", "changing operation getter must be bounded"); subject.setOperation({ chatJid: "chat-1", operationId: "operation-1", version: 1 });
      subject.setRoute(hostile("kind", "ssh", "local")); const route = await subject.resolver.resolve(request()); assert(!route.ok && route.error.certainty === "not_applied", "changing route getter must be bounded"); subject.setRoute({ kind: "ssh", profileId: "profile-1" });
      subject.setProfile(hostile("cwd", "/remote/a", "/leak")); const profile = await subject.resolver.resolve(request()); assert(!profile.ok && profile.error._tag === "invalid_ssh_profile", "changing profile getter must be bounded"); subject.setProfile({ profileId: "profile-1", transportRef: "transport-a", cwd: "/remote/a" });
      subject.setLocalFactoryFault("malformed"); const malformed = await subject.resolver.resolve(request("local")); assert(!malformed.ok && malformed.error._tag === "environment_unavailable", "malformed factory result must be bounded"); subject.setLocalFactoryFault(null);
      for (const fault of ["throw", "thenable", "malformed", "changing"] as const) {
        subject.setPreparedEnvironmentFault(fault); const preparedContext = await subject.resolver.resolve(request()); assert(preparedContext.ok, "prepared environment fault context must resolve");
        const prepared = await preparedContext.value.env.exec("prepared", undefined, BACKGROUND_CONTEXT); assert(!prepared.ok && prepared.error.code === "unknown", "hostile prepared environment callback must become bounded ExecutionError unknown");
      }
      subject.setPreparedEnvironmentFault(null);
    },
  },
  {
    name: "EF-H01-C11 Context identity and bounded shell-update replay are preserved",
    async run({ subject }) {
      const resolved = await subject.resolver.resolve(request()); assert(resolved.ok, "context must resolve");
      const backend = subject.createdRemotes().at(-1) as ExecutionEnv & { script(...steps: unknown[]): void; observedContexts?: readonly Context[] };
      backend.script({ _tag: "result", stdout: "abcdef", stderr: "", exitCode: 0 });
      const key = createContextKey<string>("execution-context-resolver-contract");
      const context = withContextValue(key, "identity", BACKGROUND_CONTEXT);
      let replay: ShellOutputView | undefined; const updateContexts: Context[] = [];
      const result = await resolved.value.env.exec("bounded", {
        capture: { limits: { maxBytes: 3, maxLines: 10, retain: "tail" } },
        onUpdate(update, updateContext) { replay = applyShellOutputUpdate(replay, update); updateContexts.push(updateContext); },
      }, context);
      assert(result.ok && result.value.exitCode === 0 && result.value.truncation.truncated && result.value.truncation.totalBytes === 6, "completion must return bounded-output metadata without fixture stdout/stderr");
      assert(replay?.text === "def" && replay.truncation.totalBytes === 6, "bounded updates must replay to the retained tail");
      assert(updateContexts.length > 0 && updateContexts.every((seen) => seen === context), "onUpdate must receive the exact invocation Context");
      assert(backend.observedContexts?.at(-1) === context, "adapter must preserve Context identity at the execution source");
    },
  },
  {
    name: "EF-H01-R01 SSH disconnect and restore preserve admitted routing and clean owned processes",
    async run(fixture) {
      const admitted = await fixture.subject.resolver.resolve(request()); assert(admitted.ok, "context must resolve");
      const oldBackend = fixture.subject.createdRemotes().at(-1) as ExecutionEnv & ScriptableProcessEnv;
      const process = gate(); oldBackend.script({ _tag: "wait_for_stop", started: process.started, release: process.promise }); const pending = admitted.value.env.exec("owned", undefined, BACKGROUND_CONTEXT); await process.waitStarted();
      fixture.subject.mutateProfile({ profileId: "profile-1", transportRef: "transport-b", cwd: "/remote/b" });
      const restored = await fixture.crashAndRestore(); await admitted.value.env.cleanup(BACKGROUND_CONTEXT); process.release(); await pending;
      assert(oldBackend.killedGroups.length === 1, "crashed instance cleanup must stop its owned process group");
      assert(admitted.value.env.cwd === "/remote/a", "admitted context must preserve its immutable route");
      const fresh = await restored.resolver.resolve(request()); assert(fresh.ok && fresh.value.env.cwd === "/remote/b" && fresh.value.env !== admitted.value.env, "restore must reconstruct a fresh environment from the later profile");
    },
  },
];

interface ScriptableProcessEnv { script(...steps: unknown[]): void; readonly killedGroups: number[]; throwCleanup: boolean; cleanupCalls: number; }
async function allFileMethods(env: ExecutionEnv, context: Context) {
  return Promise.all([env.absolutePath("x", context), env.joinPath(["x"], context), env.readTextFile("x", context), env.readTextLines("x", undefined, context), env.readBinaryFile("x", context), env.writeFile("x", "x", context), env.appendFile("x", "x", context), env.renameFile("x", "y", context), env.fileInfo("x", context), env.listDir("x", context), env.canonicalPath("x", context), env.exists("x", context), env.createDir("x", undefined, context), env.remove("x", undefined, context), env.createTempDir(undefined, context), env.createTempFile(undefined, context)]);
}
function request(requestedRoute: "current" | "local" = "current"): ResolveExecutionContextRequest { return { chatJid: "chat-1", operationId: "operation-1", expectedOperationVersion: 1, requestedRoute }; }
function hostile(field: string, first: unknown, second: unknown): object { let reads = 0; return { kind: "ssh", profileId: "profile-1", transportRef: "transport-a", cwd: "/remote/a", get [field]() { return reads++ === 0 ? first : second; } }; }
function assert(condition: unknown, message: string): asserts condition { if (!condition) throw new Error(message); }
function delay(milliseconds: number): Promise<void> { return new Promise((resolve) => setTimeout(resolve, milliseconds)); }
function gate() {
  let release!: () => void; let started!: () => void;
  const promise = new Promise<void>((resolve) => { release = resolve; }); const startedPromise = new Promise<void>((resolve) => { started = resolve; });
  return { promise, release, started, waitStarted: () => startedPromise };
}
