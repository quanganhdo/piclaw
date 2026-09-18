import { BACKGROUND_CONTEXT, Result, type ExecutionEnv } from "@earendil-works/pi-agent-core";
import { NodeExecutionEnv } from "@earendil-works/pi-agent-core/node";

import type { ExecutionContextError } from "../contracts/execution-context-resolver.js";
import { PiclawExecutionEnv, type ShellEnvironmentPreparer } from "./execution-env-adapter.js";
import type { LocalExecutionEnvFactory } from "./execution-context-types.js";

export interface CurrentPiclawLocalExecutionEnvFactoryOptions {
  readonly cwd: string;
  readonly shellPath?: string;
  readonly prepareShellEnvironment: ShellEnvironmentPreparer;
  readonly createNodeEnv?: (options: ConstructorParameters<typeof NodeExecutionEnv>[0]) => ExecutionEnv;
}

export class CurrentPiclawLocalExecutionEnvFactory implements LocalExecutionEnvFactory {
  readonly #cwd: string;
  readonly #shellPath?: string;
  readonly #prepareShellEnvironment: ShellEnvironmentPreparer;
  readonly #createNodeEnv: (options: ConstructorParameters<typeof NodeExecutionEnv>[0]) => ExecutionEnv;

  constructor(options: CurrentPiclawLocalExecutionEnvFactoryOptions) {
    this.#cwd = options.cwd;
    this.#shellPath = options.shellPath;
    this.#prepareShellEnvironment = options.prepareShellEnvironment;
    this.#createNodeEnv = options.createNodeEnv ?? ((nodeOptions) => new NodeExecutionEnv(nodeOptions));
  }

  createLocalEnv() {
    let delegate: ExecutionEnv | undefined;
    try {
      delegate = this.#createNodeEnv({
        cwd: this.#cwd,
        ...(this.#shellPath ? { shellPath: this.#shellPath } : {}),
      });
      return Result.ok(new PiclawExecutionEnv(delegate, this.#prepareShellEnvironment));
    } catch {
      return cleanupUnknown(delegate).then(() => Result.err(error("environment_unavailable", true)));
    }
  }
}

async function cleanupUnknown(value: unknown): Promise<void> {
  try {
    if (!value || typeof value !== "object" || Array.isArray(value)) return;
    const record = value as Record<string, unknown>;
    const first = record.cleanup; const second = record.cleanup;
    if (first === second && typeof first === "function") await first.call(value, BACKGROUND_CONTEXT);
  } catch (error) { void error; /* cleanup is best effort by contract */ }
}

function error(_tag: ExecutionContextError["_tag"], retryable: boolean): ExecutionContextError {
  return Object.freeze({ _tag, certainty: "not_applied", retryable });
}
