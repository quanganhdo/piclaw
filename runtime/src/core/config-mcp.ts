/** Non-secret instance MCP owner/codemode settings. Runtime apply is separate. */
import { createHash, randomUUID } from "node:crypto";
import { closeSync, constants, fchmodSync, fstatSync, fsyncSync, openSync, readFileSync, renameSync, unlinkSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { getDomainConfigOptions } from "./config-context.js";
import { registerDomainConfig, stringField, type DomainConfigField } from "./domain-config.js";
import { DEFAULT_MCP_ENGINE_POLICY, parseMcpEnginePolicy, type McpCodemodePolicy, type McpEngine, type McpEnginePolicy } from "../agent-pool/mcp-engine-policy.js";

registerDomainConfig<McpEnginePolicy>({ domain: "mcp", fields: {
  engine: stringField({ key: "engine", owner: "mcp", defaultValue: DEFAULT_MCP_ENGINE_POLICY.engine, allowedValues: ["adapter", "native"],
    persistence: "json-config", precedence: ["persisted", "default"], secretClass: "none" }) as DomainConfigField<McpEngine>,
  codemode: stringField({ key: "codemode", owner: "mcp", defaultValue: DEFAULT_MCP_ENGINE_POLICY.codemode, allowedValues: ["auto", "on", "off"],
    persistence: "json-config", precedence: ["persisted", "default"], secretClass: "none" }) as DomainConfigField<McpCodemodePolicy>,
} });

export interface McpInstancePolicySnapshot {
  policy: Readonly<McpEnginePolicy>;
  /** Entire config revision fences unrelated concurrent edits as well. */
  revision: string;
}
/** Safe diagnostic: never includes config contents or secrets. */
export class McpInstanceConfigError extends Error {}

/** Tighten legacy owner-owned config files without following links or changing bytes. */
export function migrateMcpInstanceConfigPermissions(configPath = getDomainConfigOptions().configPath): "absent" | "unchanged" | "migrated" {
  let fd: number;
  try { fd = openSync(configPath, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK); }
  catch (error) {
    if ((error as NodeJS.ErrnoException)?.code === "ENOENT") return "absent";
    throw new McpInstanceConfigError("MCP settings require a private regular configuration file.");
  }
  try {
    const stat = fstatSync(fd);
    if (!stat.isFile() || stat.nlink !== 1 || stat.uid !== process.getuid?.()) {
      throw new McpInstanceConfigError("MCP settings require an owned private regular configuration file.");
    }
    if ((stat.mode & 0o077) === 0) return "unchanged";
    try { fchmodSync(fd, 0o600); }
    catch { throw new McpInstanceConfigError("MCP settings permissions could not be migrated."); }
    if ((fstatSync(fd).mode & 0o777) !== 0o600) throw new McpInstanceConfigError("MCP settings permissions could not be migrated.");
    return "migrated";
  } finally { closeSync(fd); }
}
/** Startup upgrade check is non-fatal; unsafe files remain untouched for MCP-only degradation. */
export function prepareMcpInstanceConfig(configPath = getDomainConfigOptions().configPath): { migration: "absent" | "unchanged" | "migrated" | "unavailable"; reason?: string } {
  try { return { migration: migrateMcpInstanceConfigPermissions(configPath) }; }
  catch { return { migration: "unavailable", reason: "Instance configuration permissions could not be safely migrated." }; }
}
function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}
function readConfig(path: string): { config: Record<string, unknown>; revision: string } {
  let fd: number;
  try { fd = openSync(path, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK); }
  catch (error) {
    if ((error as NodeJS.ErrnoException)?.code === "ENOENT") return { config: {}, revision: "absent" };
    // Avoid exposing path/config diagnostics through settings responses.
    // eslint-disable-next-line preserve-caught-error
    throw new McpInstanceConfigError("MCP settings require a private regular configuration file.");
  }
  try {
    const stat = fstatSync(fd);
    if (!stat.isFile() || stat.nlink !== 1 || stat.uid !== process.getuid?.() || (stat.mode & 0o077) !== 0) throw new McpInstanceConfigError("MCP settings require an owned private regular configuration file.");
    const bytes = readFileSync(fd);
    let config: unknown;
    try { config = JSON.parse(bytes.toString("utf8")); }
    catch { throw new McpInstanceConfigError("Invalid instance configuration JSON."); }
    if (!isRecord(config)) throw new McpInstanceConfigError("Invalid instance configuration object.");
    if (config.domains !== undefined && !isRecord(config.domains)) throw new McpInstanceConfigError("Invalid instance configuration domains.");
    return { config, revision: createHash("sha256").update(bytes).digest("hex") };
  } finally { closeSync(fd); }
}
function snapshot(value: ReturnType<typeof readConfig>): McpInstancePolicySnapshot {
  const domains = value.config.domains as Record<string, unknown> | undefined;
  const block = domains?.mcp;
  if (block !== undefined && !isRecord(block)) throw new McpInstanceConfigError("Invalid MCP settings block.");
  let policy: Readonly<McpEnginePolicy>;
  try { policy = parseMcpEnginePolicy({ ...DEFAULT_MCP_ENGINE_POLICY, ...(block as Record<string, unknown> | undefined) }); }
  catch { throw new McpInstanceConfigError("Invalid MCP settings policy."); }
  return { policy, revision: value.revision };
}
export function readMcpInstancePolicy(configPath = getDomainConfigOptions().configPath): McpInstancePolicySnapshot {
  return snapshot(readConfig(configPath));
}

/**
 * Commit desired policy after runtime validation/fencing; no activation here.
 * Reads use one verified descriptor; replacement is exclusive staged JSON.
 * Revision/write is synchronous and scoped to a trusted owned parent on Bun
 * POSIX. It is not a cross-process CAS or ancestor/power-loss safety guarantee.
 */
export function commitMcpInstancePolicy(value: unknown, expectedRevision: string, configPath = getDomainConfigOptions().configPath): McpInstancePolicySnapshot {
  const policy = parseMcpEnginePolicy(value);
  const current = readConfig(configPath);
  snapshot(current); // Refuse corrupt persisted policy rather than replace it.
  if (current.revision !== expectedRevision) throw new Error("MCP settings changed; reload before applying.");
  const domains = current.config.domains as Record<string, unknown> | undefined;
  const next = { ...current.config, domains: { ...domains, mcp: { ...policy } } };
  const staged = join(dirname(configPath), `.mcp-settings-${randomUUID()}.tmp`);
  let stagedExists = false;
  try {
    const fd = openSync(staged, constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW, 0o600);
    stagedExists = true;
    try { writeFileSync(fd, `${JSON.stringify(next, null, 2)}\n`); fsyncSync(fd); } finally { closeSync(fd); }
    if (readConfig(configPath).revision !== expectedRevision) throw new Error("MCP settings changed; reload before applying.");
    renameSync(staged, configPath);
    stagedExists = false;
    // Do not reopen and attribute a subsequent writer's policy to this commit.
    return snapshot({ config: next, revision: createHash("sha256").update(`${JSON.stringify(next, null, 2)}\n`).digest("hex") });
  } finally { if (stagedExists) unlinkSync(staged); }
}
