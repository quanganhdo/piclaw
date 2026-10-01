/**
 * test/extensions/extensions-keychain-tools.test.ts – Tests for keychain-tools extension.
 */

import { beforeEach, afterEach, describe, expect, test } from "bun:test";
import { createTempWorkspace, importFresh, setEnv } from "../helpers.js";
import { createFakeExtensionApi } from "./fake-extension-api.js";

describe("keychain-tools extension", () => {
  let ws: ReturnType<typeof createTempWorkspace>;
  let restoreEnv: (() => void) | null = null;

  beforeEach(async () => {
    ws = createTempWorkspace("piclaw-keychain-tools-");
    restoreEnv = setEnv({
      PICLAW_WORKSPACE: ws.workspace,
      PICLAW_STORE: ws.store,
      PICLAW_DATA: ws.data,
      PICLAW_KEYCHAIN_KEY: "test-keychain-tools",
    });

    const db = await importFresh<typeof import("../src/db.js")>("../src/db.js");
    db.initDatabase();
    const keychain = await importFresh<typeof import("../src/secure/keychain.js")>("../src/secure/keychain.js");
    await keychain.setKeychainEntry({
      name: "ssh/piclaw",
      type: "secret",
      secret: "PRIVATE_KEY_DATA",
      username: "git",
    });
  });

  afterEach(() => {
    restoreEnv?.();
    restoreEnv = null;
    ws.cleanup();
  });

  async function registerKeychainExtension() {
    const { keychainTools } = await importFresh<typeof import("../src/extensions/keychain-tools.js")>(
      "../src/extensions/keychain-tools.js",
    );
    const fake = createFakeExtensionApi();
    keychainTools(fake.api);
    return fake;
  }

  async function getTool() {
    const fake = await registerKeychainExtension();
    return fake.tools.get("keychain");
  }

  test("lists keychain entries", async () => {
    const tool = await getTool();
    const result = await tool.execute("k1", { action: "list" });
    expect(result.content[0].text).toContain("Keychain entries");
    expect(result.content[0].text).toContain("ssh/piclaw");
    expect(result.content[0].text).toContain("Injection is command-scoped");
    expect(result.content[0].text).toContain("Dynamic lookups and env enumeration do not trigger it");
    expect(result.details.count).toBe(1);
  });

  test("retrieves secret and username fields while marking direct get as last resort", async () => {
    const tool = await getTool();

    const secretResult = await tool.execute("k2", { action: "get", name: "ssh/piclaw" });
    expect(secretResult.content[0].text).toBe("PRIVATE_KEY_DATA");
    expect(secretResult.details.name).toBe("ssh/piclaw");
    expect(secretResult.details.field).toBe("secret");
    expect(secretResult.details.access_method).toBe("direct_get_last_resort");

    const userResult = await tool.execute("k3", { action: "get", name: "ssh/piclaw", field: "username" });
    expect(userResult.content[0].text).toBe("git");
    expect(userResult.details.name).toBe("ssh/piclaw");
    expect(userResult.details.field).toBe("username");
    expect(userResult.details.access_method).toBe("direct_get_last_resort");
  });

  test("sets a keychain entry and can read it back", async () => {
    const tool = await getTool();

    const setResult = await tool.execute("k4", {
      action: "set",
      name: "proxmox/piclaw",
      type: "token",
      secret: "tok_123",
      username: "root@pam!piclaw",
    });
    expect(setResult.content[0].text).toContain("Stored keychain entry proxmox/piclaw (token).");

    const secretResult = await tool.execute("k5", { action: "get", name: "proxmox/piclaw" });
    expect(secretResult.content[0].text).toBe("tok_123");

    const userResult = await tool.execute("k6", { action: "get", name: "proxmox/piclaw", field: "username" });
    expect(userResult.content[0].text).toBe("root@pam!piclaw");
  });

  test("deletes a keychain entry", async () => {
    const tool = await getTool();

    const removed = await tool.execute("k7", { action: "delete", name: "ssh/piclaw" });
    expect(removed.content[0].text).toContain("Deleted keychain entry ssh/piclaw.");

    const missing = await tool.execute("k8", { action: "delete", name: "ssh/piclaw" });
    expect(missing.content[0].text).toContain("Keychain entry not found: ssh/piclaw");
  });

  test("before_agent_start includes env and integration profile hints and last-resort guidance", async () => {
    const db = await importFresh<typeof import("../src/db.js")>("../src/db.js");
    const keychain = await importFresh<typeof import("../src/secure/keychain.js")>("../src/secure/keychain.js");
    db.initDatabase();
    await keychain.setKeychainEntry({
      name: "STRIPE_KEY",
      type: "token",
      secret: "stripe-secret",
    });
    await keychain.setKeychainEntry({
      name: "proxmox/lab",
      type: "secret",
      secret: "token-secret",
      username: "root@pam!lab",
    });
    await keychain.setKeychainEntry({
      name: "portainer/relay",
      type: "secret",
      secret: "portainer-token",
      username: "https://portainer.example.com:9443",
    });

    const fake = await registerKeychainExtension();
    const beforeAgentStart = fake.handlers.find((entry) => entry.event === "before_agent_start")?.handler;
    const result = await beforeAgentStart?.({ systemPrompt: "base prompt" });
    expect(result?.systemPrompt).toContain("$STRIPE_KEY");
    expect(result?.systemPrompt).toContain("ssh/piclaw");
    expect(result?.systemPrompt).toContain("proxmox/lab");
    expect(result?.systemPrompt).toContain("portainer/relay");
    expect(result?.systemPrompt).toContain("Use keychain get only as an absolute last resort");
    expect(result?.systemPrompt).toContain("Shell injection is command-scoped");
    expect(result?.systemPrompt).toContain("Dynamic lookups and env enumeration do not request injection");
  });

  test("status hints only expose entry names, not secrets", async () => {
    await registerKeychainExtension();
    const { resolveToolStatusHints } = await import("../../src/tool-status-hints.js");

    const hints = resolveToolStatusHints({
      chatJid: "web:keychain",
      toolName: "keychain",
      args: {
        action: "set",
        name: "ssh/piclaw",
        secret: "PRIVATE_KEY_DATA",
        username: "git",
      },
      payload: {},
    });

    expect(hints).toEqual([
      expect.objectContaining({
        key: "keychain",
        label: "ssh/piclaw",
        title: "Keychain entry • ssh/piclaw",
      }),
    ]);
    expect(JSON.stringify(hints)).not.toContain("PRIVATE_KEY_DATA");
    expect(JSON.stringify(hints)).not.toContain("git");
  });

  test("set/delete actions validate required fields", async () => {
    const tool = await getTool();

    const missingNameSet = await tool.execute("k9", { action: "set", secret: "abc" });
    expect(missingNameSet.content[0].text).toContain("Provide name for action=set");

    const missingSecret = await tool.execute("k10", { action: "set", name: "foo/bar" });
    expect(missingSecret.content[0].text).toContain("Provide secret for action=set");

    const missingNameDelete = await tool.execute("k11", { action: "delete" });
    expect(missingNameDelete.content[0].text).toContain("Provide name for action=delete");
  });
});
