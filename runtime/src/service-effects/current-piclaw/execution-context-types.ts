import type {
  ExecutionEnv,
  Result,
} from "../contracts/execution-env.js";

import type { ExecutionContextError } from "../contracts/execution-context-resolver.js";

export interface ServiceOperationSnapshot {
  readonly chatJid: string;
  readonly operationId: string;
  readonly version: number;
}

export interface ServiceOperationSnapshotLookup {
  getOperationSnapshot(
    chatJid: string,
    operationId: string,
  ): Promise<ServiceOperationSnapshot | null> | ServiceOperationSnapshot | null;
}

export interface LocalExecutionRouteSnapshot {
  readonly kind: "local";
}

export interface SshExecutionRouteSnapshot {
  readonly kind: "ssh";
  readonly profileId: string;
}

export type ExecutionRouteSnapshot = LocalExecutionRouteSnapshot | SshExecutionRouteSnapshot;

export interface ExecutionRouteSnapshotLookup {
  getCurrentRoute(
    chatJid: string,
  ): Promise<ExecutionRouteSnapshot | null> | ExecutionRouteSnapshot | null;
}

/** Non-secret immutable locator consumed by the injected SSH transport factory. */
export interface SshExecutionProfileSnapshot {
  readonly profileId: string;
  readonly transportRef: string;
  readonly cwd: string;
}

export interface SshExecutionProfileSnapshotLookup {
  getSshProfile(
    profileId: string,
  ): Promise<SshExecutionProfileSnapshot | null> | SshExecutionProfileSnapshot | null;
}

export interface LocalExecutionEnvFactory {
  createLocalEnv(): Promise<Result<ExecutionEnv, ExecutionContextError>> | Result<ExecutionEnv, ExecutionContextError>;
}

export interface SshExecutionEnvFactory {
  createSshEnv(
    profile: SshExecutionProfileSnapshot,
  ): Promise<Result<ExecutionEnv, ExecutionContextError>> | Result<ExecutionEnv, ExecutionContextError>;
}
