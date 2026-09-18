import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import {
  formatToolName,
  loadMcpStatusHintRuntimeState,
  resourceNameToToolName,
  type McpStatusHintConfig,
  type McpStatusHintMetadataCache,
} from "../../../src/extensions/mcp-status-hint-adapter.js";
import { registerToolStatusHintProvider } from "../../../src/tool-status-hints.js";

export const MCP_STATUS_ICON_SVG = `<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false"><circle cx="7" cy="12" r="2.5"></circle><circle cx="17" cy="7" r="2.5"></circle><circle cx="17" cy="17" r="2.5"></circle><path d="M9.2 11 14.8 8"></path><path d="M9.2 13 14.8 16"></path></svg>`;

type ToolServerIndex = {
  directToolToServer: Map<string, string>;
  proxyToolToServers: Map<string, string[]>;
};

function readTrimmedString(...values: unknown[]): string | null {
  for (const value of values) {
    if (typeof value === "string" && value.trim()) return value.trim();
  }
  return null;
}

function extractHostLabelFromUrl(value: unknown): string | null {
  const raw = readTrimmedString(value);
  if (!raw) return null;
  try {
    return new URL(raw).host || null;
  } catch {
    const withoutProtocol = raw.replace(/^[a-z]+:\/\//i, "");
    return withoutProtocol.split("/")[0]?.trim() || null;
  }
}

function pushProxyTool(map: Map<string, string[]>, toolName: string, serverName: string): void {
  if (!toolName) return;
  const existing = map.get(toolName) ?? [];
  if (!existing.includes(serverName)) existing.push(serverName);
  map.set(toolName, existing);
}

export function buildMcpToolServerIndex(config: McpStatusHintConfig, cache: McpStatusHintMetadataCache | null): ToolServerIndex {
  const directToolToServer = new Map<string, string>();
  const proxyToolToServers = new Map<string, string[]>();
  if (!config || !cache) return { directToolToServer, proxyToolToServers };

  const prefix = config.settings?.toolPrefix ?? "server";
  const globalDirect = config.settings?.directTools;

  for (const [serverName, definition] of Object.entries(config.mcpServers || {})) {
    const serverCache = cache.servers?.[serverName];
    if (!serverCache) continue;
    const toolFilter = definition.directTools !== undefined ? definition.directTools : globalDirect;

    if (toolFilter) {
      for (const tool of serverCache.tools ?? []) {
        if (!tool?.name) continue;
        if (toolFilter !== true && Array.isArray(toolFilter) && !toolFilter.includes(tool.name)) continue;
        directToolToServer.set(formatToolName(tool.name, serverName, prefix), serverName);
      }
      if (definition.exposeResources !== false) {
        for (const resource of serverCache.resources ?? []) {
          if (!resource?.name) continue;
          const resourceToolName = `get_${resourceNameToToolName(resource.name)}`;
          if (toolFilter !== true && Array.isArray(toolFilter) && !toolFilter.includes(resourceToolName)) continue;
          directToolToServer.set(formatToolName(resourceToolName, serverName, prefix), serverName);
        }
      }
    }

    for (const tool of serverCache.tools ?? []) {
      if (!tool?.name) continue;
      pushProxyTool(proxyToolToServers, tool.name, serverName);
    }
    if (definition.exposeResources !== false) {
      for (const resource of serverCache.resources ?? []) {
        if (!resource?.name) continue;
        pushProxyTool(proxyToolToServers, `get_${resourceNameToToolName(resource.name)}`, serverName);
      }
    }
  }

  return { directToolToServer, proxyToolToServers };
}

export function resolveMcpServerName(
  toolName: string,
  args: unknown,
  index: ToolServerIndex,
): string | null {
  const record = args && typeof args === "object" ? args as Record<string, unknown> : null;
  const explicitServer = readTrimmedString(record?.server, record?.connect, record?.serverName, record?.server_name);
  if (explicitServer) return explicitServer;

  if (toolName !== "mcp") {
    return index.directToolToServer.get(toolName) ?? null;
  }

  const proxyToolName = readTrimmedString(record?.tool, record?.describe);
  if (!proxyToolName) return null;
  const matches = index.proxyToolToServers.get(proxyToolName) ?? [];
  return matches.length === 1 ? matches[0] : null;
}

export function buildMcpStatusHintLabel(
  serverName: string | null,
  config: McpStatusHintConfig,
): { label: string; title: string } | null {
  if (!serverName) return null;
  const definition = config.mcpServers?.[serverName];
  const host = extractHostLabelFromUrl(definition?.url);
  return {
    label: serverName,
    title: host ? `MCP server • ${serverName} • ${host}` : `MCP server • ${serverName}`,
  };
}

function loadMcpStatusHintState(): { config: McpStatusHintConfig; index: ToolServerIndex } {
  const { config, cache } = loadMcpStatusHintRuntimeState();
  return { config, index: buildMcpToolServerIndex(config, cache) };
}

registerToolStatusHintProvider({
  id: "mcp-local-wrapper",
  buildHints: ({ toolName, args }) => {
    const state = loadMcpStatusHintState();
    const serverName = resolveMcpServerName(toolName, args, state.index);
    const label = buildMcpStatusHintLabel(serverName, state.config);
    if (label) {
      return {
        key: "mcp",
        icon_svg: MCP_STATUS_ICON_SVG,
        label: label.label,
        title: label.title,
        kind: "service",
      };
    }
    // If the tool is the MCP proxy or a known MCP-prefixed tool, show the icon
    // even without a resolved server name (cache may not be ready yet).
    const record = args && typeof args === "object" ? args as Record<string, unknown> : null;
    if (toolName === "mcp") {
      const proxyToolName = typeof record?.tool === "string" ? record.tool : (typeof record?.describe === "string" ? record.describe : null);
      const serverArg = typeof record?.server === "string" ? record.server : null;
      const displayLabel = serverArg || proxyToolName || "mcp";
      return {
        key: "mcp",
        icon_svg: MCP_STATUS_ICON_SVG,
        label: displayLabel,
        title: serverArg ? `MCP server \u2022 ${serverArg}` : `MCP tool \u2022 ${displayLabel}`,
        kind: "service",
      };
    }
    // Check if tool name looks like a direct MCP tool (has the configured prefix)
    const prefix = state.config.settings?.toolPrefix ?? "server";
    if (prefix && toolName.includes(`_${prefix}_`)) {
      const parts = toolName.split(`_${prefix}_`);
      const inferredServer = parts.length > 1 ? parts[0] : null;
      return {
        key: "mcp",
        icon_svg: MCP_STATUS_ICON_SVG,
        label: inferredServer || toolName,
        title: inferredServer ? `MCP server \u2022 ${inferredServer}` : `MCP tool \u2022 ${toolName}`,
        kind: "service",
      };
    }
    return null;
  },
});

export default function mcpStatusHintsExtension(_pi: ExtensionAPI): void {
  // No-op: importing this extension registers the MCP status hint provider.
}
