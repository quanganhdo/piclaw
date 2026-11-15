/**
 * core/domain-config.ts – typed persistent domain configuration framework.
 *
 * Foundation for #747 domain migrations. It centralises schema registration,
 * precedence, persistence, compatibility env aliases, deprecation telemetry, and
 * secret safety without migrating existing variables in this tranche.
 */

import { readJsonConfig, writeJsonConfig } from "./config-store.js";
import { createLogger } from "../utils/logger.js";

const log = createLogger("core.domain-config");

export type DomainConfigValueType = "boolean" | "integer" | "number" | "string" | "json" | "path" | "enum";
export type DomainConfigSecretClass = "none" | "keychain-ref" | "service-env";
export type DomainConfigPrecedence = "bootstrap-cli-env" | "compat-env" | "persisted" | "default";
export type DomainConfigPersistence = "json-config" | "keychain-ref" | "service-env";

export type DomainConfigSecretReference =
  | { kind: "keychain"; name: string }
  | { kind: "env"; name: string };

export interface DomainConfigCompatibilityEnv {
  envKey: string;
  replacement: string;
  removalVersion: string;
  parse?: (value: string) => unknown;
  /** Continue to the next compatibility alias when parsing or validation fails. */
  skipInvalid?: boolean;
}

export interface DomainConfigField<T> {
  key: string;
  owner: string;
  type: DomainConfigValueType;
  defaultValue: T;
  validate: (value: unknown) => T;
  persistence: DomainConfigPersistence;
  precedence: readonly DomainConfigPrecedence[];
  secretClass: DomainConfigSecretClass;
  bounds?: string;
  allowedValues?: readonly string[];
  compatibilityEnv?: readonly DomainConfigCompatibilityEnv[];
  deprecation?: { replacement: string; removalVersion: string };
  /** Secret fields are required by default. Set false to allow the default sentinel when the reference is unresolved. */
  required?: boolean;
}

export interface DomainConfigSchema<T extends object> {
  domain: string;
  fields: { [K in keyof T]: DomainConfigField<T[K]> };
  /** Historical persisted keys: preserve bytes, never resolve or accept new writes. */
  retiredKeys?: readonly string[];
}

export interface DomainConfigRuntimeOptions {
  configPath: string;
  env?: Record<string, string | undefined>;
  /** Canonical already-parsed bootstrap values such as CLI/env bootstrap paths. */
  bootstrapValues?: Record<string, unknown>;
  emitWarning?: (event: DomainConfigDeprecationEvent) => void;
  resolveKeychainSecret?: (name: string) => string | undefined;
}

export interface DomainConfigDeprecationEvent {
  domain: string;
  key: string;
  envKey: string;
  replacement: string;
  removalVersion: string;
}

export type DomainConfigWritePatch<T extends object> = {
  [K in keyof T]?: T[K] | DomainConfigSecretReference;
};

export interface DomainConfigMigrationResult<T extends object> {
  before: T;
  after: T;
  changed: boolean;
}

const schemas = new Map<string, DomainConfigSchema<Record<string, unknown>>>();
const warnedCompatibilityKeys = new Set<string>();

export function clearDomainConfigRegistryForTests(): void {
  schemas.clear();
  warnedCompatibilityKeys.clear();
}

export function resetDomainConfigWarningsForTests(): void {
  warnedCompatibilityKeys.clear();
}

export function registerDomainConfig<T extends object>(schema: DomainConfigSchema<T>): DomainConfigSchema<T> {
  if (!schema.domain.trim()) throw new Error("Domain config schema requires a domain name.");
  if (schemas.has(schema.domain)) throw new Error(`Domain config schema already registered: ${schema.domain}`);
  const fieldKeys = new Set<string>();
  for (const [fieldName, rawField] of Object.entries(schema.fields)) {
    const field = rawField as DomainConfigField<unknown>;
    if (!field.key || field.key !== fieldName) throw new Error(`Domain config field key mismatch for ${schema.domain}.${fieldName}`);
    if (fieldKeys.has(field.key)) throw new Error(`Duplicate domain config field key: ${schema.domain}.${field.key}`);
    fieldKeys.add(field.key);
    if (field.secretClass !== "none" && field.persistence === "json-config") {
      throw new Error(`Secret domain config field cannot use plaintext JSON persistence: ${schema.domain}.${field.key}`);
    }
    if (field.secretClass !== "none" && typeof field.defaultValue === "string" && field.defaultValue.length > 0) {
      throw new Error(`Secret domain config field default must be an empty sentinel: ${schema.domain}.${field.key}`);
    }
    if (field.secretClass === "none" && field.persistence !== "json-config") {
      throw new Error(`Non-secret domain config field must use json-config persistence: ${schema.domain}.${field.key}`);
    }
    if (field.precedence.length === 0) throw new Error(`Domain config field requires precedence: ${schema.domain}.${field.key}`);
  }
  const retired = new Set(schema.retiredKeys ?? []);
  if (retired.size !== (schema.retiredKeys?.length ?? 0) || [...retired].some(key => !key.trim() || fieldKeys.has(key)))
    throw Error('Invalid retired domain config keys: ' + schema.domain);
  schemas.set(schema.domain, schema as unknown as DomainConfigSchema<Record<string, unknown>>);
  return schema;
}

export function getRegisteredDomainConfigSchemas(): readonly DomainConfigSchema<Record<string, unknown>>[] {
  return Array.from(schemas.values());
}

function projectSchemaKeys<T extends object>(schema: DomainConfigSchema<T>, value: Record<string, unknown>): Record<string, unknown> {
  const projected: Record<string, unknown> = {};
  for (const key of Object.keys(schema.fields)) {
    if (Object.prototype.hasOwnProperty.call(value, key)) projected[key] = value[key];
  }
  return projected;
}

function readDomainBlock<T extends object>(schema: DomainConfigSchema<T>, config: Record<string, unknown>): { block: Record<string, unknown>; strict: boolean } {
  const domainConfig = config.domains && typeof config.domains === "object"
    ? (config.domains as Record<string, unknown>)[schema.domain]
    : undefined;
  if (domainConfig && typeof domainConfig === "object") return { block: domainConfig as Record<string, unknown>, strict: true };
  const legacy = config[schema.domain];
  return legacy && typeof legacy === "object"
    ? { block: projectSchemaKeys(schema, legacy as Record<string, unknown>), strict: false }
    : { block: {}, strict: false };
}

function writeDomainBlock(config: Record<string, unknown>, domain: string, block: Record<string, unknown>): Record<string, unknown> {
  const next = { ...config };
  const domains = next.domains && typeof next.domains === "object" ? { ...(next.domains as Record<string, unknown>) } : {};
  domains[domain] = block;
  next.domains = domains;
  return next;
}

function assertNoUnknownPersistedKeys<T extends object>(schema: DomainConfigSchema<T>, persisted: Record<string, unknown>): void {
  const known = new Set([...Object.keys(schema.fields), ...(schema.retiredKeys ?? [])]);
  for (const key of Object.keys(persisted)) {
    if (!known.has(key)) throw new Error(`Unknown persisted domain config key: ${schema.domain}.${key}`);
  }
}

function emitCompatibilityWarning(schema: DomainConfigSchema<Record<string, unknown>>, key: string, alias: DomainConfigCompatibilityEnv, emitWarning?: (event: DomainConfigDeprecationEvent) => void): void {
  const id = `${schema.domain}.${alias.envKey}`;
  if (warnedCompatibilityKeys.has(id)) return;
  warnedCompatibilityKeys.add(id);
  const event: DomainConfigDeprecationEvent = { domain: schema.domain, key, envKey: alias.envKey, replacement: alias.replacement, removalVersion: alias.removalVersion };
  emitWarning?.(event);
  log.warn("Deprecated compatibility environment variable used for domain config", { operation: "domain_config.compat_env", ...event });
}

function isSecretReference(value: unknown): value is DomainConfigSecretReference {
  return Boolean(value) && typeof value === "object" && ((value as { kind?: unknown }).kind === "keychain" || (value as { kind?: unknown }).kind === "env") && typeof (value as { name?: unknown }).name === "string";
}

function normalizeSecretReference(field: DomainConfigField<unknown>, value: unknown): DomainConfigSecretReference {
  if (!isSecretReference(value)) throw new Error(`Secret domain config field requires a safe reference: ${field.key}`);
  if (field.persistence === "keychain-ref" && value.kind !== "keychain") throw new Error(`Secret domain config field requires a keychain reference: ${field.key}`);
  if (field.persistence === "service-env" && value.kind !== "env") throw new Error(`Secret domain config field requires a service env reference: ${field.key}`);
  if (!value.name.trim()) throw new Error(`Secret domain config reference cannot be empty: ${field.key}`);
  return { kind: value.kind, name: value.name.trim() };
}

function resolveSecretReference(schema: DomainConfigSchema<Record<string, unknown>>, field: DomainConfigField<unknown>, value: unknown, options: DomainConfigRuntimeOptions): unknown {
  if (field.secretClass === "none") return value;
  const ref = normalizeSecretReference(field, value);
  const resolved = ref.kind === "env"
    ? (options.env ?? process.env)[ref.name]
    : options.resolveKeychainSecret?.(ref.name);
  if (resolved !== undefined) return resolved;
  if (field.required === false) return field.defaultValue;
  throw new Error(`Required secret reference unresolved for ${schema.domain}.${field.key}: ${ref.kind}:${ref.name}`);
}

function resolveFieldValue(schema: DomainConfigSchema<Record<string, unknown>>, field: DomainConfigField<unknown>, persisted: Record<string, unknown>, options: DomainConfigRuntimeOptions): unknown {
  const env = options.env ?? process.env;
  for (const source of field.precedence) {
    if (source === "bootstrap-cli-env") {
      if (options.bootstrapValues && Object.prototype.hasOwnProperty.call(options.bootstrapValues, field.key)) {
        return field.validate(options.bootstrapValues[field.key]);
      }
      continue;
    }
    if (source === "compat-env") {
      for (const alias of field.compatibilityEnv ?? []) {
        const raw = env[alias.envKey];
        if (raw === undefined) continue;
        try {
          const value = field.validate(alias.parse ? alias.parse(raw) : raw);
          emitCompatibilityWarning(schema, field.key, alias, options.emitWarning);
          return value;
        } catch (error) {
          if (alias.skipInvalid) continue;
          throw error;
        }
      }
      continue;
    }
    if (source === "persisted" && Object.prototype.hasOwnProperty.call(persisted, field.key)) {
      const value = field.secretClass === "none" ? persisted[field.key] : resolveSecretReference(schema, field, persisted[field.key], options);
      return field.validate(value);
    }
    if (source === "default") return field.validate(field.defaultValue);
  }
  return field.validate(field.defaultValue);
}

export function readDomainConfig<T extends object>(schema: DomainConfigSchema<T>, options: DomainConfigRuntimeOptions): T {
  const config = readJsonConfig(options.configPath);
  const { block: persisted, strict } = readDomainBlock(schema, config);
  if (strict) assertNoUnknownPersistedKeys(schema, persisted);
  const result: Record<string, unknown> = {};
  for (const [key, field] of Object.entries(schema.fields)) result[key] = resolveFieldValue(schema as unknown as DomainConfigSchema<Record<string, unknown>>, field as DomainConfigField<unknown>, persisted, options);
  return result as T;
}

function assertKnownPatchKeys<T extends object>(schema: DomainConfigSchema<T>, patch: Partial<T>): void {
  const known = new Set(Object.keys(schema.fields));
  for (const key of Object.keys(patch)) if (!known.has(key)) throw new Error(`Unknown domain config key: ${schema.domain}.${key}`);
}

export function writeDomainConfig<T extends object>(schema: DomainConfigSchema<T>, options: DomainConfigRuntimeOptions, patch: DomainConfigWritePatch<T>): T {
  assertKnownPatchKeys(schema, patch as Partial<T>);
  const config = readJsonConfig(options.configPath);
  const { block: currentBlock, strict } = readDomainBlock(schema, config);
  if (strict) assertNoUnknownPersistedKeys(schema, currentBlock);
  const nextBlock = { ...currentBlock };
  for (const [key, value] of Object.entries(patch)) {
    const field = schema.fields[key as keyof T] as DomainConfigField<unknown> | undefined;
    if (!field) continue;
    nextBlock[key] = field.secretClass === "none" ? field.validate(value) : normalizeSecretReference(field, value);
  }
  writeJsonConfig(options.configPath, writeDomainBlock(config, schema.domain, nextBlock));
  return readDomainConfig(schema, options);
}

export function writeDomainConfigField<T extends object, K extends keyof T>(
  schema: DomainConfigSchema<T>,
  options: DomainConfigRuntimeOptions,
  key: K,
  value: T[K] | DomainConfigSecretReference,
): T {
  const patch: DomainConfigWritePatch<T> = {};
  patch[key] = value;
  return writeDomainConfig(schema, options, patch);
}

export function migrateDomainConfig<T extends object>(schema: DomainConfigSchema<T>, options: DomainConfigRuntimeOptions, migrate: (current: T) => DomainConfigWritePatch<T>): DomainConfigMigrationResult<T> {
  const before = readDomainConfig(schema, options);
  const patch = migrate(before);
  const changed = Object.keys(patch).length > 0;
  const after = changed ? writeDomainConfig(schema, options, patch) : before;
  return { before, after, changed };
}

export function boolField(options: Omit<DomainConfigField<boolean>, "type" | "validate">): DomainConfigField<boolean> {
  return { ...options, type: "boolean", validate(value: unknown) { if (typeof value === "boolean") return value; if (typeof value === "string") { const normalized = value.trim().toLowerCase(); if (["1", "true", "yes", "on"].includes(normalized)) return true; if (["0", "false", "no", "off"].includes(normalized)) return false; } throw new Error(`Invalid boolean domain config value for ${options.key}`); } };
}
export function integerField(options: Omit<DomainConfigField<number>, "type" | "validate"> & { min?: number; max?: number }): DomainConfigField<number> {
  return { ...options, type: "integer", validate(value: unknown) { const parsed = typeof value === "number" ? value : Number(value); if (!Number.isInteger(parsed)) throw new Error(`Invalid integer domain config value for ${options.key}`); if (options.min !== undefined && parsed < options.min) throw new Error(`Domain config value below minimum for ${options.key}`); if (options.max !== undefined && parsed > options.max) throw new Error(`Domain config value above maximum for ${options.key}`); return parsed; } };
}
export function stringField(options: Omit<DomainConfigField<string>, "type" | "validate"> & { nonEmpty?: boolean; allowedValues?: readonly string[] }): DomainConfigField<string> {
  return { ...options, type: options.allowedValues && options.allowedValues.length > 0 ? "enum" : "string", validate(value: unknown) { if (typeof value !== "string") throw new Error(`Invalid string domain config value for ${options.key}`); const next = value.trim(); if (options.nonEmpty && !next) throw new Error(`Domain config value cannot be empty for ${options.key}`); if (options.allowedValues && options.allowedValues.length > 0 && !options.allowedValues.includes(next)) throw new Error(`Domain config value is not allowed for ${options.key}`); return next; } };
}
