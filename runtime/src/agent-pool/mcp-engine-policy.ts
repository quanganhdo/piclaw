export type McpEngine = "adapter" | "native";
export type McpCodemodePolicy = "auto" | "on" | "off";
export interface McpEnginePolicy {
  engine: McpEngine;
  codemode: McpCodemodePolicy;
}
export const DEFAULT_MCP_ENGINE_POLICY: Readonly<McpEnginePolicy> = Object.freeze({ engine: "adapter", codemode: "auto" });
export const MCP_ENGINE_SWITCH_EFFECT = "abort_active_turns_and_reload_all_extensions" as const;

/** Strict non-secret instance policy. Server compatibility is validated separately. */
export function parseMcpEnginePolicy(value: unknown): Readonly<McpEnginePolicy> {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("Invalid MCP engine policy.");
  const record = value as Record<string, unknown>;
  if (Object.keys(record).some(key => key !== "engine" && key !== "codemode")) throw new Error("Unknown MCP engine policy field.");
  if (record.engine !== "adapter" && record.engine !== "native") throw new Error("Invalid MCP engine selection.");
  if (record.codemode !== "auto" && record.codemode !== "on" && record.codemode !== "off") throw new Error("Invalid MCP codemode selection.");
  return Object.freeze({ engine: record.engine, codemode: record.codemode });
}

/** Whether the selected engine's enabled server exposure requires codemode. */
export function resolveMcpCodemode(policy: Readonly<McpEnginePolicy>, requiresCodemode: boolean): boolean {
  if (policy.codemode === "off" && requiresCodemode) throw new Error("Configured MCP exposure requires codemode.");
  return policy.codemode === "on" || policy.codemode === "auto" && requiresCodemode;
}
