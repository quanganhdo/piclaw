/** Logging, retention, and notification integration configuration. */

import { pickNumber, pickString } from "./config-helpers.js";
import { envConfig, getDomainConfigOptions, pushoverConfig } from "./config-context.js";
import { readDomainConfig, registerDomainConfig, stringField, type DomainConfigField } from "./domain-config.js";
import { createLogger } from "../utils/logger.js";
import { parseLogLevel, setConfiguredLogLevelFallback, type LogLevel } from "../utils/log-level.js";

const log = createLogger("core.config");
function warnDeprecatedEnv(oldName: string, newName: string): void {
  const oldValue = process.env[oldName] ?? envConfig[oldName];
  const newValue = process.env[newName] ?? envConfig[newName];
  if (oldValue && !newValue) {
    log.warn("Deprecated environment variable is set", {
      operation: "core_config.warn_deprecated_env",
      oldName,
      newName,
    });
  }
}
warnDeprecatedEnv("LOG_LEVEL", "PICLAW_LOG_LEVEL");

export interface LoggingConfig { level: LogLevel; }
const loggingDomainSchema = registerDomainConfig<LoggingConfig>({
  domain: "logging",
  // Preserve historical JSON bytes without resolving these retired controls.
  retiredKeys: ["retentionMs", "cleanupIntervalMs"],
  fields: {
    level: {
      ...stringField({ key: "level", owner: "core", defaultValue: "info", allowedValues: ["debug", "info", "warn", "error"], persistence: "json-config", precedence: ["compat-env", "persisted", "default"], secretClass: "none", compatibilityEnv: [
        { envKey: "PICLAW_LOG_LEVEL", replacement: "domains.logging.level", removalVersion: "3.0.0", parse: (raw) => parseLogLevel(raw) },
        { envKey: "LOG_LEVEL", replacement: "domains.logging.level", removalVersion: "3.0.0", parse: (raw) => parseLogLevel(raw) },
      ] }),
      validate: (value: unknown) => parseLogLevel(value),
    } as DomainConfigField<LogLevel>,
  },
});

export const LOGGING_CONFIG = Object.freeze<LoggingConfig>(readDomainConfig(loggingDomainSchema, getDomainConfigOptions()));
setConfiguredLogLevelFallback(LOGGING_CONFIG.level);
export function getLoggingConfig(): Readonly<LoggingConfig> { return LOGGING_CONFIG; }

const configAppToken = pickString(pushoverConfig, ["appToken", "app_token", "PUSHOVER_APP_TOKEN"]);
const configUserKey = pickString(pushoverConfig, ["userKey", "user_key", "PUSHOVER_USER_KEY"]);
const configDevice = pickString(pushoverConfig, ["device", "PUSHOVER_DEVICE"]);
const configSound = pickString(pushoverConfig, ["sound", "PUSHOVER_SOUND"]);
const configPriority = pickNumber(pushoverConfig, ["priority", "PUSHOVER_PRIORITY"]);

export interface PushoverConfig { appToken: string; userKey: string; device: string; priority: number; sound: string; }
export const PUSHOVER_CONFIG = Object.freeze<PushoverConfig>({
  appToken: process.env.PUSHOVER_APP_TOKEN || envConfig.PUSHOVER_APP_TOKEN || configAppToken || "",
  userKey: process.env.PUSHOVER_USER_KEY || envConfig.PUSHOVER_USER_KEY || configUserKey || "",
  device: process.env.PUSHOVER_DEVICE || envConfig.PUSHOVER_DEVICE || configDevice || "",
  priority: parseInt(process.env.PUSHOVER_PRIORITY || envConfig.PUSHOVER_PRIORITY || (configPriority !== undefined ? String(configPriority) : "0"), 10),
  sound: process.env.PUSHOVER_SOUND || envConfig.PUSHOVER_SOUND || configSound || "",
});
export function getPushoverConfig(): Readonly<PushoverConfig> { return PUSHOVER_CONFIG; }
