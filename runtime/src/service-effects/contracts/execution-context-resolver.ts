import type {
  ExecutionEnv,
  Result,
} from "@earendil-works/pi-agent-core";

import type { PiclawEffectError } from "./common.js";

export interface PiclawExecutionAuthority {
  readonly chatJid: string;
  readonly operationId: string;
}

export interface PiclawToolContext extends PiclawExecutionAuthority {
  readonly env: ExecutionEnv;
  readonly localEnv: ExecutionEnv;
}

export interface ResolveExecutionContextRequest {
  readonly chatJid: string;
  readonly operationId: string;
  readonly expectedOperationVersion: number;
  readonly requestedRoute: "current" | "local";
}

export type ExecutionContextErrorTag =
  | "operation_not_found"
  | "version_mismatch"
  | "route_unavailable"
  | "invalid_ssh_profile"
  | "credential_unavailable"
  | "environment_unavailable";

export interface ExecutionContextError extends PiclawEffectError<ExecutionContextErrorTag> {
  readonly certainty: "not_applied";
}

export interface ExecutionContextResolver {
  resolve(
    request: ResolveExecutionContextRequest,
  ): Promise<Result<PiclawToolContext, ExecutionContextError>>;
}
