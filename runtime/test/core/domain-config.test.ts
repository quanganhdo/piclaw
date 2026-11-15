import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  boolField,
  clearDomainConfigRegistryForTests,
  getRegisteredDomainConfigSchemas,
  integerField,
  migrateDomainConfig,
  readDomainConfig,
  registerDomainConfig,
  resetDomainConfigWarningsForTests,
  stringField,
  writeDomainConfig,
  type DomainConfigDeprecationEvent,
} from "../../src/core/domain-config.js";

interface DemoConfig { enabled: boolean; limit: number; mode: string; apiToken: string }

function tempConfigPath(): { root: string; path: string; cleanup: () => void } {
  const root = mkdtempSync(join(tmpdir(), "piclaw-domain-config-"));
  return { root, path: join(root, ".piclaw", "config.json"), cleanup: () => rmSync(root, { recursive: true, force: true }) };
}

function writeRawConfig(path: string, value: unknown): void {
  mkdirSync(join(path, ".."), { recursive: true });
  writeFileSync(path, JSON.stringify(value));
}

function createSchema() {
  return registerDomainConfig<DemoConfig>({
    domain: "demo",
    fields: {
      enabled: boolField({ key: "enabled", owner: "test", defaultValue: false, persistence: "json-config", precedence: ["bootstrap-cli-env", "compat-env", "persisted", "default"], secretClass: "none", compatibilityEnv: [{ envKey: "PICLAW_DEMO_ENABLED", replacement: "domains.demo.enabled", removalVersion: "1.0.0" }], deprecation: { replacement: "domains.demo.enabled", removalVersion: "1.0.0" } }),
      limit: integerField({ key: "limit", owner: "test", defaultValue: 5, min: 1, max: 10, bounds: "1..10", persistence: "json-config", precedence: ["persisted", "default"], secretClass: "none" }),
      mode: stringField({ key: "mode", owner: "test", defaultValue: "safe", allowedValues: ["safe", "fast"], persistence: "json-config", precedence: ["persisted", "default"], secretClass: "none" }),
      apiToken: stringField({ key: "apiToken", owner: "security", defaultValue: "", persistence: "service-env", precedence: ["persisted", "default"], secretClass: "service-env" }),
    },
  });
}

describe("domain config framework", () => {
  let inheritedSchemas: ReturnType<typeof getRegisteredDomainConfigSchemas>;
  beforeEach(() => { inheritedSchemas = getRegisteredDomainConfigSchemas(); });
  afterEach(() => {
    clearDomainConfigRegistryForTests();
    for (const schema of inheritedSchemas) registerDomainConfig(schema);
  });

  test("registers typed schemas and rejects duplicate domains", () => {
    clearDomainConfigRegistryForTests();
    const schema = createSchema();
    expect(getRegisteredDomainConfigSchemas()).toEqual([schema]);
    expect(() => registerDomainConfig(schema)).toThrow(/already registered/);
  });

  test("persists values and reads them after restart", () => {
    clearDomainConfigRegistryForTests();
    const schema = createSchema();
    const temp = tempConfigPath();
    try {
      const first = writeDomainConfig(schema, { configPath: temp.path, env: { TOKEN_REF: "secret-value" } }, { enabled: true, limit: 7, mode: "fast", apiToken: { kind: "env", name: "TOKEN_REF" } });
      expect(first).toEqual({ enabled: true, limit: 7, mode: "fast", apiToken: "secret-value" });
      const persistedText = readFileSync(temp.path, "utf8");
      expect(persistedText).not.toContain("secret-value");
      expect(JSON.parse(persistedText).domains.demo).toEqual({ enabled: true, limit: 7, mode: "fast", apiToken: { kind: "env", name: "TOKEN_REF" } });
      expect(readDomainConfig(schema, { configPath: temp.path, env: { TOKEN_REF: "secret-value" } })).toEqual(first);
    } finally { temp.cleanup(); }
  });

  test("honors schema precedence table", () => {
    clearDomainConfigRegistryForTests(); resetDomainConfigWarningsForTests();
    const schema = createSchema(); const temp = tempConfigPath();
    try {
      writeDomainConfig(schema, { configPath: temp.path, env: {} }, { enabled: false });
      const cases = [
        [{ bootstrapValues: { enabled: true }, env: { PICLAW_DEMO_ENABLED: "0" } }, true],
        [{ env: { PICLAW_DEMO_ENABLED: "1" } }, true],
        [{ env: {} }, false],
      ] as const;
      for (const [options, expected] of cases) expect(readDomainConfig(schema, { configPath: temp.path, ...options }).enabled).toBe(expected);
    } finally { temp.cleanup(); }
  });

  test("skips invalid compatibility aliases only when explicitly configured", () => {
    clearDomainConfigRegistryForTests(); resetDomainConfigWarningsForTests();
    const schema = registerDomainConfig<{ retentionMs: number }>({
      domain: "retention-demo",
      fields: {
        retentionMs: integerField({
          key: "retentionMs",
          owner: "test",
          defaultValue: 30,
          min: 1,
          persistence: "json-config",
          precedence: ["compat-env", "persisted", "default"],
          secretClass: "none",
          compatibilityEnv: [
            { envKey: "PICLAW_RETENTION_MS", replacement: "domains.retention-demo.retentionMs", removalVersion: "1.0.0", skipInvalid: true },
            { envKey: "PICLAW_RETENTION_DAYS", replacement: "domains.retention-demo.retentionMs", removalVersion: "1.0.0", parse: (raw) => Number(raw) * 24 },
          ],
        }),
      },
    });
    const temp = tempConfigPath(); const warnings: DomainConfigDeprecationEvent[] = [];
    try {
      const value = readDomainConfig(schema, {
        configPath: temp.path,
        env: { PICLAW_RETENTION_MS: "bad", PICLAW_RETENTION_DAYS: "2" },
        emitWarning: (event) => warnings.push(event),
      });
      expect(value.retentionMs).toBe(48);
      expect(warnings.map((event) => event.envKey)).toEqual(["PICLAW_RETENTION_DAYS"]);
    } finally { temp.cleanup(); }
  });

  test("deduplicates one compatibility env warning shared by multiple fields", () => {
    clearDomainConfigRegistryForTests(); resetDomainConfigWarningsForTests();
    const shared = { envKey: "PICLAW_SHARED_LIMIT", replacement: "domains.shared.first and second", removalVersion: "1.0.0" };
    const schema = registerDomainConfig<{ first: number; second: number }>({
      domain: "shared",
      fields: {
        first: integerField({ key: "first", owner: "test", defaultValue: 1, min: 1, persistence: "json-config", precedence: ["compat-env", "persisted", "default"], secretClass: "none", compatibilityEnv: [shared] }),
        second: integerField({ key: "second", owner: "test", defaultValue: 2, min: 1, persistence: "json-config", precedence: ["compat-env", "persisted", "default"], secretClass: "none", compatibilityEnv: [shared] }),
      },
    });
    const temp = tempConfigPath(); const warnings: DomainConfigDeprecationEvent[] = [];
    try {
      expect(readDomainConfig(schema, { configPath: temp.path, env: { PICLAW_SHARED_LIMIT: "7" }, emitWarning: (event) => warnings.push(event) })).toEqual({ first: 7, second: 7 });
      expect(warnings).toHaveLength(1);
      expect(warnings[0]?.envKey).toBe("PICLAW_SHARED_LIMIT");
    } finally { temp.cleanup(); }
  });

  test("emits compatibility warning once with replacement and removal metadata", () => {
    clearDomainConfigRegistryForTests(); resetDomainConfigWarningsForTests();
    const schema = createSchema(); const temp = tempConfigPath(); const warnings: DomainConfigDeprecationEvent[] = [];
    try {
      const options = { configPath: temp.path, env: { PICLAW_DEMO_ENABLED: "1" }, emitWarning: (event: DomainConfigDeprecationEvent) => warnings.push(event) };
      expect(readDomainConfig(schema, options).enabled).toBe(true);
      expect(readDomainConfig(schema, options).enabled).toBe(true);
      expect(warnings).toEqual([{ domain: "demo", key: "enabled", envKey: "PICLAW_DEMO_ENABLED", replacement: "domains.demo.enabled", removalVersion: "1.0.0" }]);
    } finally { temp.cleanup(); }
  });

  test("rejects unknown patch keys, invalid persisted values, and unknown persisted keys", () => {
    clearDomainConfigRegistryForTests(); const schema = createSchema(); const temp = tempConfigPath();
    try {
      const unknownPatch = JSON.parse('{"missing":true}') as Record<string, unknown>;
      expect(() => writeDomainConfig(schema, { configPath: temp.path, env: {} }, unknownPatch)).toThrow(/Unknown domain config key/);
      expect(() => writeDomainConfig(schema, { configPath: temp.path, env: {} }, { limit: 99 })).toThrow(/above maximum/);
      writeRawConfig(temp.path, { domains: { demo: { limit: 4, extra: true } } });
      expect(() => readDomainConfig(schema, { configPath: temp.path, env: {} })).toThrow(/Unknown persisted domain config key/);
      writeRawConfig(temp.path, { domains: { demo: { limit: 99 } } });
      expect(() => readDomainConfig(schema, { configPath: temp.path, env: {} })).toThrow(/above maximum/);
    } finally { temp.cleanup(); }
  });

  test("legacy top-level blocks project schema keys while current domain blocks stay strict", () => {
    clearDomainConfigRegistryForTests(); const schema = createSchema(); const temp = tempConfigPath();
    try {
      writeRawConfig(temp.path, { demo: { limit: 6, unrelated: true } });
      expect(readDomainConfig(schema, { configPath: temp.path, env: {} }).limit).toBe(6);
      const result = migrateDomainConfig(schema, { configPath: temp.path, env: {} }, (current) => current.mode === "safe" ? { mode: "fast" } : {});
      expect(result.changed).toBe(true);
      expect(JSON.parse(readFileSync(temp.path, "utf8")).domains.demo).toEqual({ limit: 6, mode: "fast" });

      writeRawConfig(temp.path, { domains: { demo: { limit: 6, unrelated: true } } });
      expect(() => readDomainConfig(schema, { configPath: temp.path, env: {} })).toThrow(/Unknown persisted domain config key/);
    } finally { temp.cleanup(); }
  });

  test("migrates legacy top-level blocks into domains", () => {
    clearDomainConfigRegistryForTests(); const schema = createSchema(); const temp = tempConfigPath();
    try {
      writeRawConfig(temp.path, { demo: { limit: 6 } });
      const result = migrateDomainConfig(schema, { configPath: temp.path, env: {} }, (current) => current.mode === "safe" ? { mode: "fast" } : {});
      expect(result.changed).toBe(true);
      expect(result.before.limit).toBe(6);
      expect(JSON.parse(readFileSync(temp.path, "utf8")).domains.demo).toEqual({ limit: 6, mode: "fast" });
    } finally { temp.cleanup(); }
  });

  test("resolves service-env and keychain references but rejects raw secret writes", () => {
    clearDomainConfigRegistryForTests(); const schema = createSchema(); const temp = tempConfigPath();
    try {
      process.env.TOKEN_REF = "ambient-should-not-leak";
      try {
        expect(() => writeDomainConfig(schema, { configPath: temp.path, env: {} }, { apiToken: "raw-secret" })).toThrow(/requires a safe reference/);
        writeDomainConfig(schema, { configPath: temp.path, env: { TOKEN_REF: "resolved" } }, { apiToken: { kind: "env", name: "TOKEN_REF" } });
        expect(readDomainConfig(schema, { configPath: temp.path, env: { TOKEN_REF: "resolved" } }).apiToken).toBe("resolved");
        expect(() => readDomainConfig(schema, { configPath: temp.path, env: {} })).toThrow(/Required secret reference unresolved for demo\.apiToken: env:TOKEN_REF/);
      } finally {
        delete process.env.TOKEN_REF;
      }
    } finally { temp.cleanup(); }

    clearDomainConfigRegistryForTests();
    const keychainSchema = registerDomainConfig<{ token: string }>({ domain: "keychain-demo", fields: { token: stringField({ key: "token", owner: "security", defaultValue: "", persistence: "keychain-ref", precedence: ["persisted", "default"], secretClass: "keychain-ref" }) } });
    const keychainTemp = tempConfigPath();
    try {
      writeDomainConfig(keychainSchema, { configPath: keychainTemp.path, env: {}, resolveKeychainSecret: (name) => name === "secret/name" ? "keychain-secret" : undefined }, { token: { kind: "keychain", name: "secret/name" } });
      expect(readDomainConfig(keychainSchema, { configPath: keychainTemp.path, env: {}, resolveKeychainSecret: (name) => name === "secret/name" ? "keychain-secret" : undefined }).token).toBe("keychain-secret");
      expect(() => readDomainConfig(keychainSchema, { configPath: keychainTemp.path, env: {}, resolveKeychainSecret: () => undefined })).toThrow(/Required secret reference unresolved for keychain-demo\.token: keychain:secret\/name/);
    } finally { keychainTemp.cleanup(); }
  });

  test("optional secret fields may return their empty sentinel when unresolved", () => {
    clearDomainConfigRegistryForTests();
    const optionalSchema = registerDomainConfig<{ token: string }>({
      domain: "optional-secret-demo",
      fields: {
        token: stringField({
          key: "token",
          owner: "security",
          defaultValue: "",
          persistence: "service-env",
          precedence: ["persisted", "default"],
          secretClass: "service-env",
          required: false,
        }),
      },
    });
    const temp = tempConfigPath();
    try {
      writeDomainConfig(optionalSchema, { configPath: temp.path, env: {} }, { token: { kind: "env", name: "OPTIONAL_TOKEN" } });
      expect(readDomainConfig(optionalSchema, { configPath: temp.path, env: {} }).token).toBe("");
    } finally { temp.cleanup(); }
  });

  test("prevents plaintext JSON persistence declarations for secret fields", () => {
    clearDomainConfigRegistryForTests();
    expect(() => registerDomainConfig({ domain: "secret-demo", fields: { token: stringField({ key: "token", owner: "security", defaultValue: "", persistence: "json-config", precedence: ["persisted", "default"], secretClass: "service-env" }) } })).toThrow(/Secret domain config field cannot use plaintext JSON persistence/);
    expect(() => registerDomainConfig({ domain: "secret-default-demo", fields: { token: stringField({ key: "token", owner: "security", defaultValue: "raw-default", persistence: "service-env", precedence: ["persisted", "default"], secretClass: "service-env" }) } })).toThrow(/default must be an empty sentinel/);
  });
});
