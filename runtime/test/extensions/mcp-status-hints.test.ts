import { describe, expect, test } from "bun:test";

import {
  buildMcpStatusHintLabel,
  buildMcpToolServerIndex,
  resolveMcpServerName,
} from "../../extensions/integrations/mcp-status-hints/index.js";
import type {
  McpStatusHintConfig,
  McpStatusHintMetadataCache,
} from "../../src/extensions/mcp-status-hint-adapter.js";

const config: McpStatusHintConfig = {
  settings: { toolPrefix: "server" },
  mcpServers: {
    docs: { url: "https://docs.example.test/mcp", directTools: true },
    files: { command: "files-mcp", directTools: ["search"] },
  },
};

const cache: McpStatusHintMetadataCache = {
  version: 1,
  servers: {
    docs: {
      configHash: "docs-hash",
      cachedAt: 1,
      tools: [{ name: "search", description: "Search docs" }],
      resources: [{ uri: "file://guide", name: "Guide" }],
    },
    files: {
      configHash: "files-hash",
      cachedAt: 1,
      tools: [{ name: "search", description: "Search files" }],
      resources: [],
    },
  },
};

describe("MCP status hints", () => {
  test("maps direct tools and exposed resources through cached adapter metadata", () => {
    const index = buildMcpToolServerIndex(config, cache);

    expect(resolveMcpServerName("docs_search", {}, index)).toBe("docs");
    expect(resolveMcpServerName("docs_get_guide", {}, index)).toBe("docs");
    expect(resolveMcpServerName("files_search", {}, index)).toBe("files");
  });

  test("uses explicit proxy server arguments and rejects ambiguous cached names", () => {
    const index = buildMcpToolServerIndex(config, cache);

    expect(resolveMcpServerName("mcp", { server: "files", tool: "search" }, index)).toBe("files");
    expect(resolveMcpServerName("mcp", { tool: "search" }, index)).toBeNull();
    expect(resolveMcpServerName("mcp", { describe: "get_guide" }, index)).toBe("docs");
  });

  test("handles missing metadata and formats sanitized server labels", () => {
    const empty = buildMcpToolServerIndex(config, null);

    expect(resolveMcpServerName("docs_search", {}, empty)).toBeNull();
    expect(buildMcpStatusHintLabel("docs", config)).toEqual({
      label: "docs",
      title: "MCP server • docs • docs.example.test",
    });
    expect(buildMcpStatusHintLabel("files", config)).toEqual({
      label: "files",
      title: "MCP server • files",
    });
    expect(buildMcpStatusHintLabel(null, config)).toBeNull();
  });
});
