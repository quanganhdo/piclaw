import { BACKGROUND_CONTEXT, Result, type ExecutionEnv, type Result as ResultValue } from "@earendil-works/pi-agent-core";

import type { ExecutionContextError } from "../contracts/execution-context-resolver.js";
import { PiclawExecutionEnv, type ShellEnvironmentPreparer } from "./execution-env-adapter.js";
import type { SshExecutionEnvFactory, SshExecutionProfileSnapshot } from "./execution-context-types.js";

export type CapturedSshExecutionEnvFactory = (
  profile: SshExecutionProfileSnapshot,
) => Promise<ResultValue<ExecutionEnv, ExecutionContextError>> | ResultValue<ExecutionEnv, ExecutionContextError>;

/** Constructs one full remote Earendil environment from a non-secret profile snapshot. */
export class CurrentPiclawSshExecutionEnvFactory implements SshExecutionEnvFactory {
  constructor(
    private readonly connect: CapturedSshExecutionEnvFactory,
    private readonly prepareShellEnvironment: ShellEnvironmentPreparer,
  ) {}

  async createSshEnv(profile: SshExecutionProfileSnapshot): Promise<ResultValue<ExecutionEnv, ExecutionContextError>> {
    const snapshot = normaliseProfile(profile);
    if (!snapshot) return Result.err(error("invalid_ssh_profile", false));
    let connected: unknown;
    try { connected = await Promise.resolve(this.connect(snapshot)); }
    catch { return Result.err(error("environment_unavailable", true)); }
    const result = await normaliseConnectionResult(connected);
    if (!result.ok) return result;
    try {
      const captured = new PiclawExecutionEnv(result.value, this.prepareShellEnvironment);
      if (captured.cwd !== snapshot.cwd) {
        await captured.cleanup(BACKGROUND_CONTEXT);
        return Result.err(error("invalid_ssh_profile", false));
      }
      return Result.ok(captured);
    } catch {
      await cleanupUnknown(result.value);
      return Result.err(error("environment_unavailable", true));
    }
  }
}

async function normaliseConnectionResult(value: unknown): Promise<ResultValue<ExecutionEnv, ExecutionContextError>> {
  try {
    if (!record(value)) return Result.err(error("environment_unavailable", true));
    let ok: unknown;
    try { ok = stable(value, "ok"); }
    catch {
      await cleanupCandidates(boundedField(value, "value").candidates);
      return Result.err(error("environment_unavailable", true));
    }
    if (ok === false) return Result.err(normaliseError(stable(value, "error")));
    const field = boundedField(value, "value");
    if (ok === true && field.stable && record(field.value)) return Result.ok(field.value as unknown as ExecutionEnv);
    await cleanupCandidates(field.candidates);
    return Result.err(error("environment_unavailable", true));
  } catch { return Result.err(error("environment_unavailable", true)); }
}
function normaliseError(value: unknown): ExecutionContextError {
  try {
    if (!record(value)) return error("environment_unavailable", true);
    const tag = stable(value, "_tag"); const certainty = stable(value, "certainty"); const retryable = stable(value, "retryable");
    return TAGS.has(tag as ExecutionContextError["_tag"]) && certainty === "not_applied" && typeof retryable === "boolean"
      ? error(tag as ExecutionContextError["_tag"], retryable)
      : error("environment_unavailable", true);
  } catch { return error("environment_unavailable", true); }
}
function normaliseProfile(value: unknown): SshExecutionProfileSnapshot | null {
  try {
    if (!record(value)) return null;
    const profileId = stable(value, "profileId"); const transportRef = stable(value, "transportRef"); const cwd = stable(value, "cwd");
    if (!nonBlank(profileId) || !nonBlank(transportRef) || !nonBlank(cwd) || !cwd.startsWith("/")) return null;
    return Object.freeze({ profileId, transportRef, cwd });
  } catch { return null; }
}
async function cleanupUnknown(value: unknown): Promise<void> {
  try {
    if (!record(value)) return;
    const cleanup = stable(value, "cleanup");
    if (typeof cleanup === "function") await cleanup.call(value, BACKGROUND_CONTEXT);
  } catch (error) { void error; /* cleanup is best effort by contract */ }
}
async function cleanupCandidates(candidates: readonly unknown[]): Promise<void> {
  const cleaned = new Set<unknown>();
  for (const candidate of candidates) {
    if (cleaned.has(candidate)) continue;
    cleaned.add(candidate);
    await cleanupUnknown(candidate);
  }
}
function record(value: unknown): value is Record<string, unknown> { return Boolean(value && typeof value === "object" && !Array.isArray(value)); }
function stable(value: Record<string, unknown>, key: string): unknown { const first = value[key]; return value[key] === first ? first : CHANGED; }
function boundedField(value: Record<string, unknown>, key: string): { readonly stable: boolean; readonly value: unknown; readonly candidates: readonly unknown[] } {
  const candidates: unknown[] = [];
  let first: unknown; let second: unknown;
  try { first = value[key]; candidates.push(first); } catch { return { stable: false, value: CHANGED, candidates }; }
  try { second = value[key]; candidates.push(second); } catch { return { stable: false, value: CHANGED, candidates }; }
  return { stable: first === second, value: first === second ? first : CHANGED, candidates };
}
function nonBlank(value: unknown): value is string { return typeof value === "string" && value.trim().length > 0; }
function error(_tag: ExecutionContextError["_tag"], retryable: boolean): ExecutionContextError { return Object.freeze({ _tag, certainty: "not_applied", retryable }); }
const CHANGED = Symbol("changed");
const TAGS = new Set<ExecutionContextError["_tag"]>(["operation_not_found", "version_mismatch", "route_unavailable", "invalid_ssh_profile", "credential_unavailable", "environment_unavailable"]);
