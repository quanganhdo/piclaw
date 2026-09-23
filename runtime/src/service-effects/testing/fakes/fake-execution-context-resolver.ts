import { BACKGROUND_CONTEXT, Result, type ExecutionEnv, type Result as ResultValue } from "@earendil-works/pi-agent-core";

import type {
  ExecutionContextError,
  ExecutionContextResolver,
  PiclawToolContext,
  ResolveExecutionContextRequest,
} from "../../contracts/execution-context-resolver.js";
import type {
  ExecutionRouteSnapshotLookup,
  LocalExecutionEnvFactory,
  ServiceOperationSnapshotLookup,
  SshExecutionEnvFactory,
  SshExecutionProfileSnapshotLookup,
} from "../../current-piclaw/execution-context-types.js";

/** Independent deterministic resolver used to keep the shared suite honest. */
export class FakeExecutionContextResolver implements ExecutionContextResolver {
  constructor(
    private readonly operations: ServiceOperationSnapshotLookup,
    private readonly routes: ExecutionRouteSnapshotLookup,
    private readonly profiles: SshExecutionProfileSnapshotLookup,
    private readonly locals: LocalExecutionEnvFactory,
    private readonly remotes: SshExecutionEnvFactory,
  ) {}

  async resolve(input: ResolveExecutionContextRequest): Promise<ResultValue<PiclawToolContext, ExecutionContextError>> {
    const request = requestSnapshot(input);
    if (!request) return Result.err(failure("environment_unavailable", false));
    let operation: unknown;
    try { operation = await Promise.resolve(this.operations.getOperationSnapshot(request.chatJid, request.operationId)); }
    catch { return Result.err(failure("environment_unavailable", true)); }
    const owner = operationSnapshot(operation);
    if (operation !== null && !owner) return Result.err(failure("environment_unavailable", false));
    if (!owner || owner.chatJid !== request.chatJid || owner.operationId !== request.operationId) return Result.err(failure("operation_not_found", false));
    if (owner.version !== request.expectedOperationVersion) return Result.err(failure("version_mismatch", false));

    if (request.requestedRoute === "local") return this.localContext(request);
    let route: unknown;
    try { route = await Promise.resolve(this.routes.getCurrentRoute(request.chatJid)); }
    catch { return Result.err(failure("route_unavailable", true)); }
    const selected = routeSnapshot(route);
    if (route !== null && !selected) return Result.err(failure("route_unavailable", false));
    if (!selected) return Result.err(failure("route_unavailable", true));
    if (selected.kind === "local") return this.localContext(request);

    let profile: unknown;
    try { profile = await Promise.resolve(this.profiles.getSshProfile(selected.profileId)); }
    catch { return Result.err(failure("invalid_ssh_profile", true)); }
    const captured = profileSnapshot(profile);
    if (!captured || captured.profileId !== selected.profileId) return Result.err(failure("invalid_ssh_profile", false));
    const local = await this.create(this.locals.createLocalEnv.bind(this.locals));
    if (!local.ok) return local;
    const remote = await this.create(() => this.remotes.createSshEnv(captured));
    if (!remote.ok) { await cleanup(local.value); return remote; }
    return Result.ok(Object.freeze({ chatJid: request.chatJid, operationId: request.operationId, env: remote.value, localEnv: local.value }));
  }

  private async localContext(request: Readonly<ResolveExecutionContextRequest>): Promise<ResultValue<PiclawToolContext, ExecutionContextError>> {
    const local = await this.create(this.locals.createLocalEnv.bind(this.locals));
    return local.ok ? Result.ok(Object.freeze({ chatJid: request.chatJid, operationId: request.operationId, env: local.value, localEnv: local.value })) : local;
  }

  private async create(factory: () => unknown): Promise<ResultValue<ExecutionEnv, ExecutionContextError>> {
    let result: unknown;
    let cleanupRequired = false;
    let inspectedValue = false;
    const candidates = new Set<unknown>();
    const inspectValue = () => {
      inspectedValue = true;
      if (!record(result)) return CHANGED;
      let first: unknown;
      try { first = result.value; candidates.add(first); } catch { return CHANGED; }
      try { const second = result.value; candidates.add(second); return first === second ? first : CHANGED; }
      catch { return CHANGED; }
    };
    try {
      result = await Promise.resolve(factory());
      if (!record(result)) return Result.err(failure("environment_unavailable", true));
      cleanupRequired = true;
      const ok = once(result, "ok");
      if (ok === false) {
        cleanupRequired = false;
        return Result.err(normaliseFailure(once(result, "error")));
      }
      const value = inspectValue();
      const captured = ok === true && value !== CHANGED ? captureEnvironment(value) : null;
      if (!captured) return Result.err(failure("environment_unavailable", true));
      cleanupRequired = false;
      return Result.ok(captured);
    } catch { return Result.err(failure("environment_unavailable", true)); }
    finally {
      if (cleanupRequired) {
        if (!inspectedValue) inspectValue();
        for (const candidate of candidates) {
          if (!record(candidate)) continue;
          try {
            const release = once(candidate, "cleanup");
            if (typeof release === "function") await release.call(candidate, BACKGROUND_CONTEXT);
          } catch (error) { void error; /* rejected owned candidates require best-effort cleanup */ }
        }
      }
    }
  }
}

function requestSnapshot(value: unknown): Readonly<ResolveExecutionContextRequest> | null {
  try {
    if (!record(value)) return null;
    const chatJid = once(value, "chatJid"); const operationId = once(value, "operationId"); const expectedOperationVersion = once(value, "expectedOperationVersion"); const requestedRoute = once(value, "requestedRoute");
    if (!text(chatJid) || !text(operationId) || !Number.isSafeInteger(expectedOperationVersion) || (expectedOperationVersion as number) < 1 || (requestedRoute !== "local" && requestedRoute !== "current")) return null;
    return Object.freeze({ chatJid, operationId, expectedOperationVersion: expectedOperationVersion as number, requestedRoute });
  } catch { return null; }
}
function operationSnapshot(value: unknown) {
  try { if (!record(value)) return null; const chatJid = once(value, "chatJid"); const operationId = once(value, "operationId"); const version = once(value, "version"); return text(chatJid) && text(operationId) && Number.isSafeInteger(version) && (version as number) > 0 ? Object.freeze({ chatJid, operationId, version: version as number }) : null; } catch { return null; }
}
function routeSnapshot(value: unknown) {
  try { if (!record(value)) return null; const kind = once(value, "kind"); if (kind === "local") return Object.freeze({ kind }); const profileId = once(value, "profileId"); return kind === "ssh" && text(profileId) ? Object.freeze({ kind, profileId }) : null; } catch { return null; }
}
function profileSnapshot(value: unknown) {
  try { if (!record(value)) return null; const profileId = once(value, "profileId"); const transportRef = once(value, "transportRef"); const cwd = once(value, "cwd"); return text(profileId) && text(transportRef) && text(cwd) && cwd.startsWith("/") ? Object.freeze({ profileId, transportRef, cwd }) : null; } catch { return null; }
}
function normaliseFailure(value: unknown): ExecutionContextError { try { if (!record(value)) return failure("environment_unavailable", true); const tag = once(value, "_tag"); const certainty = once(value, "certainty"); const retryable = once(value, "retryable"); return TAGS.has(tag as ExecutionContextError["_tag"]) && certainty === "not_applied" && typeof retryable === "boolean" ? failure(tag as ExecutionContextError["_tag"], retryable) : failure("environment_unavailable", true); } catch { return failure("environment_unavailable", true); } }
function captureEnvironment(value: unknown): ExecutionEnv | null { try { if (!record(value)) return null; const cwd = once(value, "cwd"); if (!text(cwd) || !cwd.startsWith("/")) return null; const methods = Object.fromEntries(METHODS.map((method) => { const fn = once(value, method); if (typeof fn !== "function") throw new TypeError("invalid environment"); return [method, fn.bind(value)]; })) as unknown as Omit<ExecutionEnv, "cwd">; return Object.freeze({ cwd, ...methods }); } catch { return null; } }
function record(value: unknown): value is Record<string, unknown> { return Boolean(value && typeof value === "object" && !Array.isArray(value)); }
function once(value: Record<string, unknown>, key: string): unknown { const first = value[key]; return value[key] === first ? first : CHANGED; }
function text(value: unknown): value is string { return typeof value === "string" && value.trim().length > 0; }
async function cleanup(env: ExecutionEnv): Promise<void> { try { await env.cleanup(BACKGROUND_CONTEXT); } catch (error) { void error; /* cleanup is best effort by contract */ } }
function failure(_tag: ExecutionContextError["_tag"], retryable: boolean): ExecutionContextError { return Object.freeze({ _tag, certainty: "not_applied", retryable }); }
const CHANGED = Symbol("changed");
const TAGS = new Set<ExecutionContextError["_tag"]>(["operation_not_found", "version_mismatch", "route_unavailable", "invalid_ssh_profile", "credential_unavailable", "environment_unavailable"]);
const METHODS = ["absolutePath", "joinPath", "readTextFile", "openTextLineReader", "readTextLines", "readBinaryFile", "writeFile", "appendFile", "renameFile", "fileInfo", "listDir", "canonicalPath", "exists", "createDir", "remove", "createTempDir", "createTempFile", "exec", "cleanup"] as const;
