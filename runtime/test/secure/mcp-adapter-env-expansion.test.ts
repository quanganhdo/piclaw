import { afterEach, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { McpServerManager } from "../../../node_modules/pi-mcp-adapter/server-manager.ts";
import { acquireMcpSessionBridge, clearHydratedMcpCredentials, hydrateMcpKeychainCredentials, resetMcpStartupStateForTests } from "../../src/secure/mcp-keychain.js";

const touched = ["PICLAW_MCP_TEST_VALUE", "PICLAW_MCP_TEST_CWD"];
afterEach(() => {
  for (const name of touched) delete process.env[name];
  resetMcpStartupStateForTests();
});

test("pi-mcp-adapter expands supported environment forms into a stdio child", async () => {
  const cwd = mkdtempSync(join(tmpdir(), "piclaw-mcp-env-child-"));
  process.env.PICLAW_MCP_TEST_VALUE = "expanded-value";
  process.env.PICLAW_MCP_TEST_CWD = cwd;
  const manager = new McpServerManager(cwd);
  try {
    const connection = await manager.connect("env-echo", {
      command: process.execPath,
      args: [resolve(import.meta.dir, "../fixtures/mcp-env-echo-server.mjs"), "$PLAIN_ARG"],
      cwd: "${PICLAW_MCP_TEST_CWD}",
      env: {
        MCP_FROM_BRACES: "${PICLAW_MCP_TEST_VALUE}",
        MCP_FROM_ENV_PREFIX: "$env:PICLAW_MCP_TEST_VALUE",
        MCP_FROM_ADAPTER_FORM: "{env:PICLAW_MCP_TEST_VALUE}",
        MCP_PLAIN_LITERAL: "$PICLAW_MCP_TEST_VALUE",
        MCP_ESCAPED_BANG: "!!${PICLAW_MCP_TEST_VALUE}",
      },
    });
    const result = await connection.client.callTool({ name: "inspect_env", arguments: {} });
    const details = result.structuredContent as Record<string, string>;
    expect(details).toEqual({
      cwd,
      braces: "expanded-value",
      envPrefix: "expanded-value",
      adapterForm: "expanded-value",
      plain: "$PICLAW_MCP_TEST_VALUE",
      escapedBang: "!expanded-value",
      arg: "$PLAIN_ARG",
    });
  } finally {
    await manager.closeAll();
    rmSync(cwd, { recursive: true, force: true });
  }
}, 15_000);

test("keychain-hydrated environment values reach the stdio child without persisting the secret", async () => {
  const root = mkdtempSync(join(tmpdir(), "piclaw-mcp-keychain-child-"));
  const cwd = join(root, "cwd");
  const configDir = join(root, ".pi");
  mkdirSync(cwd, { recursive: true });
  mkdirSync(configDir, { recursive: true });
  const config = {
    mcpServers: {
      "env-echo": {
        command: process.execPath,
        args: [resolve(import.meta.dir, "../fixtures/mcp-env-echo-server.mjs"), "$PLAIN_ARG"],
        cwd,
        env: { MCP_FROM_BRACES: "${PICLAW_MCP_KEYCHAIN_TOKEN}" },
        bearerTokenKeychain: "mcp/test-token",
        bearerTokenEnv: "PICLAW_MCP_KEYCHAIN_TOKEN",
      },
    },
  };
  const configPath = join(configDir, "mcp.json");
  writeFileSync(configPath, JSON.stringify(config));
  const hydrated = await hydrateMcpKeychainCredentials(root, async (name) => ({
    name,
    type: "token",
    secret: "keychain-secret-sentinel",
    username: null,
  }));
  const lease=acquireMcpSessionBridge();
  const manager = new McpServerManager(cwd, serverName=>lease.resolveRuntimeEnv(serverName));
  try {
    const connection = await manager.connect("env-echo", config.mcpServers["env-echo"]);
    const result = await connection.client.callTool({ name: "inspect_env", arguments: {} });
    expect((result.structuredContent as Record<string, string>).braces).toBe("keychain-secret-sentinel");
    expect(readFileSync(configPath, "utf8")).not.toContain("keychain-secret-sentinel");
  } finally {
    await manager.closeAll();
    lease.release();
    clearHydratedMcpCredentials(hydrated);
    expect(process.env.PICLAW_MCP_KEYCHAIN_TOKEN).toBeUndefined();
    rmSync(root, { recursive: true, force: true });
  }
}, 15_000);

test("MCP fixture teardown leaves a fresh bridge for subsequent sessions", () => {
  const lease = acquireMcpSessionBridge();
  try {
    expect(lease.config.mcpServers).toEqual({});
  } finally {
    lease.release();
  }
});
