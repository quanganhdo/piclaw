/**
 * Stable public configuration façade.
 *
 * Domain implementations live in focused `config-*` modules. Existing callers
 * continue importing from this file so the external API remains unchanged.
 */

import type { RuntimeTimingConfig } from "./config-helpers.js";

export { pickString, pickNumber, pickBoolean, pickStringArray } from "./config-helpers.js";
export type { RuntimeTimingConfig } from "./config-helpers.js";
export {
  DATA_DIR,
  getConfigPath,
  getDataDir,
  getRuntimeBootstrapPathOverrides,
  getRuntimeConfigPaths,
  getRuntimeRoot,
  getStoreDir,
  getWorkspaceDir,
  PICLAW_CONFIG_PATH,
  STORE_DIR,
  WORKSPACE_DIR,
} from "./config-context.js";
export * from "./config-access.js";
export * from "./config-identity.js";
export * from "./config-integrations.js";
export * from "./config-network-bootstrap.js";
export * from "./config-secrets.js";
export * from "./config-web.js";
export * from "./config-tools.js";
export * from "./config-runtime.js";

/** Grouped runtime timing settings. */
export const RUNTIME_TIMING_CONFIG = Object.freeze<RuntimeTimingConfig>({
  pollIntervalMs: 2000,
  schedulerPollIntervalMs: 60000,
  ipcPollIntervalMs: 1000,
  timezone: process.env.TZ || Intl.DateTimeFormat().resolvedOptions().timeZone,
});

/** Return grouped runtime timing settings for runtime wiring and tests. */
export function getRuntimeTimingConfig(): Readonly<RuntimeTimingConfig> {
  return RUNTIME_TIMING_CONFIG;
}
