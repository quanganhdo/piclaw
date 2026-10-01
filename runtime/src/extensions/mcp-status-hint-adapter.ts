import { loadMetadataCache } from "pi-mcp-adapter/metadata-cache";
import { formatToolName } from "pi-mcp-adapter/types";
import { getPreparedMcpConfig } from "../secure/mcp-keychain.js";

export type McpToolPrefix = "server" | "none" | "short" | "mcp";

export interface McpStatusHintServerDefinition {
  url?: string;
  directTools?: boolean | string[];
  exposeResources?: boolean;
}

export interface McpStatusHintConfig {
  mcpServers: Record<string, McpStatusHintServerDefinition>;
  settings?: {
    toolPrefix?: McpToolPrefix;
    directTools?: boolean;
  };
}

export interface McpStatusHintCachedTool {
  name: string;
  description?: string;
}

export interface McpStatusHintCachedResource {
  uri: string;
  name: string;
  description?: string;
}

export interface McpStatusHintMetadataCache {
  version: number;
  servers: Record<string, {
    configHash: string;
    tools: McpStatusHintCachedTool[];
    resources: McpStatusHintCachedResource[];
    cachedAt: number;
  }>;
}

function resourceNameToToolName(name: string): string {
  let result = name.replace(/[^a-zA-Z0-9]/g, "_").replace(/_+/g, "_").replace(/^_+|_+$/g, "").toLowerCase();
  if (!result || /^\d/.test(result)) result = `resource${result ? `_${result}` : ""}`;
  return result;
}

export interface McpStatusHintRuntimeState {
  config: McpStatusHintConfig;
  cache: McpStatusHintMetadataCache | null;
}

/**
 * Piclaw's audited compatibility seam for MCP status-hint metadata.
 * Keep pi-mcp-adapter implementation paths confined to this module.
 */
export function loadMcpStatusHintRuntimeState(): McpStatusHintRuntimeState {
  return {
    config: getPreparedMcpConfig() as McpStatusHintConfig,
    cache: loadMetadataCache(),
  };
}

export { formatToolName, resourceNameToToolName };
