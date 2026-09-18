import { createRequire } from "node:module";
import { dirname, join } from "node:path";

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

const require = createRequire(import.meta.url);
const adapterDir = dirname(require.resolve("pi-mcp-adapter"));
const { loadMcpConfig } = require(join(adapterDir, "config.ts")) as {
  loadMcpConfig(overridePath?: string, cwd?: string): McpStatusHintConfig;
};
const { loadMetadataCache } = require(join(adapterDir, "metadata-cache.ts")) as {
  loadMetadataCache(): McpStatusHintMetadataCache | null;
};
const { resourceNameToToolName } = require(join(adapterDir, "resource-tools.ts")) as {
  resourceNameToToolName(name: string): string;
};
const { formatToolName } = require(join(adapterDir, "types.ts")) as {
  formatToolName(toolName: string, serverName: string, prefix: McpToolPrefix): string;
};
const { getConfigPathFromArgv } = require(join(adapterDir, "utils.ts")) as {
  getConfigPathFromArgv(): string | undefined;
};

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
    config: loadMcpConfig(getConfigPathFromArgv()),
    cache: loadMetadataCache(),
  };
}

export { formatToolName, resourceNameToToolName };
