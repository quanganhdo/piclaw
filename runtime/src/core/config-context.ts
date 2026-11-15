import { createCliArgReader } from "./config-cli.js";
import {
  resolveConfigPath,
  resolveRuntimeConfigPaths,
  resolveRuntimeRoot,
  type RuntimeConfigPaths,
} from "./config-paths.js";
import { loadPiclawEnvConfig, nestedConfig } from "./config-sources.js";
import { readJsonConfig } from "./config-store.js";
import type { DomainConfigRuntimeOptions } from "./domain-config.js";

export const readCliArg = createCliArgReader(process.argv.slice(2));
const CLI_WORKSPACE = readCliArg("--workspace", "-w");

/** Environment-file values captured once during configuration bootstrap. */
export const envConfig = loadPiclawEnvConfig();

const RUNTIME_CONFIG_PATHS = resolveRuntimeConfigPaths({ cliWorkspace: CLI_WORKSPACE });

/** Resolve candidate paths at call time; resource owners bind their own bootstrap snapshot. */
export function getRuntimeConfigPaths(): RuntimeConfigPaths {
  return resolveRuntimeConfigPaths({ cliWorkspace: CLI_WORKSPACE });
}

export function getWorkspaceDir(): string {
  return getRuntimeConfigPaths().workspaceDir;
}

export function getStoreDir(): string {
  return getRuntimeConfigPaths().storeDir;
}

export function getDataDir(): string {
  return getRuntimeConfigPaths().dataDir;
}

export function getRuntimeRoot(defaultRoot: string): string {
  return resolveRuntimeRoot(defaultRoot);
}

export const WORKSPACE_DIR = RUNTIME_CONFIG_PATHS.workspaceDir;
export const STORE_DIR = RUNTIME_CONFIG_PATHS.storeDir;
export const DATA_DIR = RUNTIME_CONFIG_PATHS.dataDir;
export const DEFAULT_TLS_CERT_PATH = RUNTIME_CONFIG_PATHS.defaultTlsCertPath;
export const DEFAULT_TLS_KEY_PATH = RUNTIME_CONFIG_PATHS.defaultTlsKeyPath;
export const HAS_DEFAULT_TLS = RUNTIME_CONFIG_PATHS.hasDefaultTls;
export const PICLAW_CONFIG_PATH = RUNTIME_CONFIG_PATHS.configPath;

export function getConfigPath(): string {
  return resolveConfigPath(PICLAW_CONFIG_PATH);
}

/** JSON configuration snapshot captured once during configuration bootstrap. */
export const piclawConfig = readJsonConfig(PICLAW_CONFIG_PATH);

export const pushoverConfig = nestedConfig(piclawConfig, "pushover");
export const assistantConfig = nestedConfig(piclawConfig, "assistant");
export const userConfig = nestedConfig(piclawConfig, "user");
export const webConfig = nestedConfig(piclawConfig, "web");
export const toolsConfig = nestedConfig(piclawConfig, "tools");
export const modelsConfig = nestedConfig(piclawConfig, "models");
export const compactionConfig = nestedConfig(piclawConfig, "compaction");

export function getDomainConfigOptions(): DomainConfigRuntimeOptions {
  return {
    configPath: getConfigPath(),
    env: { ...envConfig, ...process.env },
  };
}
