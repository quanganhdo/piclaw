import type { McpBridgeReadSnapshot } from "../secure/mcp-keychain.js";
import { readAccessConfig } from '../core/config-access.js';
import { nativeHeadersCompatible } from './mcp-native-header-policy';
import { parseMcpEnginePolicy, resolveMcpCodemode, type McpEnginePolicy } from "./mcp-engine-policy.js";

export interface McpEngineReadiness {
  /** Verified host lifecycle/execution wiring, not merely an available export. */
  native: boolean;
  adapter: boolean;
  codemode: boolean;
}
export interface McpEnginePlanIssue {
  serverName: string | null;
  field: string;
  code: "runtime_unavailable" | "native_incompatible" | "configuration_quarantined" | "codemode_required";
  message: string;
}
export interface McpEnginePlan {
  policy: Readonly<McpEnginePolicy>;
  bridgeRevision: string;
  applicable: boolean;
  codemodeEnabled: boolean;
  enabledServerNames: string[];
  issues: McpEnginePlanIssue[];
}
const SECRET_REFERENCE = /\$\{|\$env:|\{env:|^!(?!!)/;
const NATIVE_ONLY_EXPOSURES = new Set(["codemode", "codemode-deferred"]);

/** Non-secret capability plan. Never returns server values or raw diagnostics. */
export function planMcpEnginePolicy(value: unknown, snapshot: McpBridgeReadSnapshot, readiness: McpEngineReadiness): McpEnginePlan {
  const policy = parseMcpEnginePolicy(value);
  const issues: McpEnginePlanIssue[] = [];
  const add = (serverName: string | null, field: string, code: McpEnginePlanIssue["code"], message: string) => {
    if (!issues.some(issue => issue.serverName === serverName && issue.field === field && issue.code === code)) issues.push({ serverName, field, code, message });
  };
  if (!readiness[policy.engine]) add(null, "engine", "runtime_unavailable", "The selected MCP engine lifecycle is not available in this runtime.");
  const enabled = Object.entries(snapshot.adapterConfig.mcpServers).filter(([, config]) => config.disabled !== true);
  const enabledServerNames = enabled.map(([name]) => name).sort();
  for (const row of snapshot.dryRun.rows) if (row.status === "quarantined") {
    add(row.serverName, "configuration", "configuration_quarantined", "Server configuration is quarantined; repair it before applying instance settings.");
  }
  if (snapshot.dryRun.secretValuesPresent !== false) {
    add(null, "configuration", "configuration_quarantined", "MCP configuration sanitization could not be confirmed.");
  }
  if ([...snapshot.diagnostics, ...snapshot.dryRun.diagnostics].some(diagnostic => diagnostic.serverName === "(configuration)")) {
    add(null, "configuration", "configuration_quarantined", "MCP configuration could not be loaded safely.");
  }
  const mapped = new Map(snapshot.nativePreview.servers.map(server => [server.name, server]));
  let requiresCodemode = false;
  if (policy.engine === "native") {
    if (process.platform === 'win32') add(null, 'platform', 'native_incompatible', 'Experimental Native requires POSIX process-group cleanup; use Adapter on Windows.');
    if (readAccessConfig().mode !== 'single-user') add(null, 'access', 'native_incompatible', 'Experimental Native MCP is limited to single-user mode.');
    if (snapshot.nativePreview.errors.length) add(null, "configuration", "native_incompatible", "The native projection contains errors.");
    const projectedNames = new Set<string>();
    for (const server of snapshot.nativePreview.servers) {
      if (projectedNames.has(server.name)) add(server.name, "configuration", "native_incompatible", "Duplicate native server projection.");
      projectedNames.add(server.name);
      const original = Object.hasOwn(snapshot.adapterConfig.mcpServers, server.name) ? snapshot.adapterConfig.mcpServers[server.name] : undefined;
      if (!original || (original.disabled !== true) !== (server.config.enabled !== false)) {
        add(server.name, "enabled", "native_incompatible", "Native server enablement must exactly match the selected configuration.");
      }
    }
    for (const name of Object.keys(snapshot.adapterConfig.mcpServers)) if (!projectedNames.has(name)) {
      add(name, "configuration", "native_incompatible", "Native projection must retain every configured server, including disabled entries.");
    }
    for (const [name, config] of enabled) {
      const native = mapped.get(name);
      if (!native || snapshot.dryRun.rows.find(row => row.serverName === name)?.status !== "mapped") {
        add(name, "configuration", "native_incompatible", "This enabled server cannot be represented by the native MCP bridge.");
      }
      if (Object.hasOwn(config, 'url') && !nativeHeadersCompatible(native && 'url' in native.config ? native.config.headers : undefined)) add(name, 'auth', 'native_incompatible', 'Native HTTP requires explicit Authorization. Browser OAuth is disabled.');
      if (config.bearerTokenEnv && (!native || !('url' in native.config))) add(name, 'auth', 'native_incompatible', 'Native bearer credentials require a mapped HTTP server.');
      if (Object.hasOwn(config, "requestTimeoutMs")) add(name, "requestTimeoutMs", "native_incompatible", "Native request timeout does not establish Piclaw's absolute operation deadline.");
      if (typeof config.command === "string" && SECRET_REFERENCE.test(config.command)) add(name, "command", "native_incompatible", "Native command environment references require a qualified runtime resolver.");
      for (const field of ["url", "cwd"] as const) if (typeof config[field] === "string" && SECRET_REFERENCE.test(config[field])) {
        add(name, field, "native_incompatible", "Native environment references require a qualified runtime resolver.");
      }
      if (config.args?.some(arg => SECRET_REFERENCE.test(arg))) add(name, "args", "native_incompatible", "Native argument references require a qualified runtime resolver.");
      if (Object.values(config.env ?? {}).some(entry => SECRET_REFERENCE.test(entry))) add(name, "env", "native_incompatible", "Native secret environment resolution is not qualified.");
      if (["bearerToken", "bearerTokenStore", "oauth", "auth"].some(field => Object.hasOwn(config, field))) add(name, "auth", "native_incompatible", "Native credential settings are incompatible with the approved Piclaw bridge.");
      if (native && native.config.enabled !== false) {
        const exposure = native.config.exposure ?? "codemode";
        if (NATIVE_ONLY_EXPOSURES.has(exposure) || Object.values(native.config.toolExposure ?? {}).some(entry => NATIVE_ONLY_EXPOSURES.has(entry))) requiresCodemode = true;
      }
    }
  }
  let codemodeEnabled = false;
  try { codemodeEnabled = resolveMcpCodemode(policy, requiresCodemode); }
  catch { add(null, "codemode", "codemode_required", "Configured native tool exposure requires codemode; choose Auto or On."); }
  if (codemodeEnabled && !readiness.codemode) add(null, "codemode", "runtime_unavailable", "Codemode integration is not available in this runtime.");
  return { policy, bridgeRevision: snapshot.revision, applicable: issues.length === 0, codemodeEnabled, enabledServerNames, issues };
}
