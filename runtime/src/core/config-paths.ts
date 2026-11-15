import { existsSync } from "node:fs";
import { resolve } from "node:path";

export interface RuntimeBootstrapPathOverrides {
  workspace?: string;
  store?: string;
  data?: string;
  runtimeRoot?: string;
}

export interface RuntimeConfigPaths {
  workspaceDir: string;
  storeDir: string;
  dataDir: string;
  databasePath: string;
  configPath: string;
  defaultTlsCertPath: string;
  defaultTlsKeyPath: string;
  hasDefaultTls: boolean;
}

/** Read raw bootstrap-path overrides for sentinels and cache identities. */
export function readRuntimeBootstrapPathOverrides(env: NodeJS.ProcessEnv = process.env): RuntimeBootstrapPathOverrides {
  const read = (value: string | undefined): string | undefined => {
    const trimmed = value?.trim();
    return trimmed || undefined;
  };
  return {
    workspace: read(env.PICLAW_WORKSPACE),
    store: read(env.PICLAW_STORE),
    data: read(env.PICLAW_DATA),
    runtimeRoot: read(env.PICLAW_RUNTIME_ROOT),
  };
}

/** Resolve bootstrap paths while preserving the CLI-workspace precedence rules. */
export function resolveRuntimeConfigPaths(options: {
  cliWorkspace?: string;
  env?: NodeJS.ProcessEnv;
} = {}): RuntimeConfigPaths {
  const env = options.env ?? process.env;
  const overrides = readRuntimeBootstrapPathOverrides(env);
  const workspaceDir = resolve(options.cliWorkspace || overrides.workspace || "/workspace");
  const storeDir = resolve(options.cliWorkspace
    ? `${workspaceDir}/.piclaw/store`
    : (overrides.store || `${workspaceDir}/.piclaw/store`));
  const dataDir = resolve(options.cliWorkspace
    ? `${workspaceDir}/.piclaw/data`
    : (overrides.data || `${workspaceDir}/.piclaw/data`));
  const useMemory =
    env.PICLAW_DB_IN_MEMORY === "1" ||
    env.PICLAW_DB_IN_MEMORY === "true" ||
    overrides.store === ":memory:";
  const defaultTlsCertPath = resolve(workspaceDir, ".piclaw", "certs", "sandbox.local.crt");
  const defaultTlsKeyPath = resolve(workspaceDir, ".piclaw", "certs", "sandbox.local.key");
  return {
    workspaceDir,
    storeDir,
    dataDir,
    databasePath: useMemory ? ":memory:" : resolve(storeDir, "messages.db"),
    configPath: resolve(workspaceDir, ".piclaw", "config.json"),
    defaultTlsCertPath,
    defaultTlsKeyPath,
    hasDefaultTls: existsSync(defaultTlsCertPath) && existsSync(defaultTlsKeyPath),
  };
}

/** Resolve a runtime-root override at call time while preserving the caller fallback. */
export function resolveRuntimeRoot(defaultRoot: string, env: NodeJS.ProcessEnv = process.env): string {
  const override = readRuntimeBootstrapPathOverrides(env).runtimeRoot;
  return resolve(override || defaultRoot);
}

/** Resolve the writable config path at call time for isolated workspace tests. */
export function resolveConfigPath(defaultPath: string, env: NodeJS.ProcessEnv = process.env): string {
  const workspace = env.PICLAW_WORKSPACE?.trim();
  return workspace ? resolve(workspace, ".piclaw", "config.json") : defaultPath;
}
