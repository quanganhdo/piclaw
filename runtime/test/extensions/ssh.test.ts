import { afterEach, expect, test } from "bun:test";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import { createTempWorkspace, setEnv } from "../helpers.js";
import { createFakeExtensionApi } from "./fake-extension-api.ts";
import { setSshToolHandlers, sshTool } from "../../src/extensions/ssh.js";

afterEach(() => {
  setSshToolHandlers(null);
});

test("ssh registers a normalized tool name", () => {
  const fake = createFakeExtensionApi();

  sshTool(fake.api);

  expect(fake.tools.has("ssh")).toBe(true);
});

test("ssh before_agent_start tells the model that SSH tool redirection is turn-scoped", async () => {
  const fake = createFakeExtensionApi();

  sshTool(fake.api);
  const handler = fake.handlers.find((entry) => entry.event === "before_agent_start")?.handler;
  const result = await handler?.({ systemPrompt: "base prompt" });

  expect(result?.systemPrompt).toContain("Live SSH tool redirection and stored SSH profiles are cleared at the end of each agent turn.");
});

test("ssh set stores config through registered handlers", async () => {
  let seen: any = null;
  setSshToolHandlers({
    get: () => null,
    isActive: () => false,
    async set(chatJid, config) {
      seen = { chatJid, config };
      return {
        apply_timing: "next_turn",
        config: {
          chat_jid: chatJid,
          ...config,
          created_at: "2026-04-04T00:00:00.000Z",
          updated_at: "2026-04-04T00:00:00.000Z",
        },
      };
    },
    async clear() {
      return { deleted: false, apply_timing: "next_session" };
    },
  });

  const fake = createFakeExtensionApi();
  sshTool(fake.api);
  const tool = fake.tools.get("ssh");

  const result = await tool.execute("tool-1", {
    action: "set",
    ssh_target: "agent@example.com:/srv/project",
    ssh_port: 2202,
    private_key_keychain: "ssh-prod",
    known_hosts_keychain: "",
    strict_host_key_checking: "accept-new",
  });

  expect(seen).toEqual({
    chatJid: "web:default",
    config: {
      ssh_target: "agent@example.com:/srv/project",
      ssh_port: 2202,
      private_key_keychain: "ssh-prod",
      known_hosts_keychain: null,
      strict_host_key_checking: "accept-new",
    },
  });
  expect(result.details.apply_timing).toBe("next_turn");
  expect(result.details.turn_scoped_redirection).toBe(true);
  expect(result.content[0].text).toContain("Stored SSH config");
});

test("ssh get reports missing config for the current session", async () => {
  setSshToolHandlers({
    get: () => null,
    isActive: () => false,
    async set() {
      throw new Error("unexpected");
    },
    async clear() {
      return { deleted: false, apply_timing: "next_session" };
    },
  });

  const fake = createFakeExtensionApi();
  sshTool(fake.api);
  const tool = fake.tools.get("ssh");

  const result = await tool.execute("tool-2", { action: "get" });

  expect(result.details.configured).toBe(false);
  expect(result.details.live_redirection_active).toBe(false);
  expect(result.content[0].text).toContain("No SSH config stored");
  expect(result.content[0].text).toContain("Live SSH tool redirection is inactive");
});

test("single-user ssh calls retain legacy handler behavior", async () => {
  const workspace = createTempWorkspace("ssh-single-user-");
  const restore = setEnv({ PICLAW_WORKSPACE: workspace.workspace, PICLAW_STORE: workspace.store, PICLAW_DATA: workspace.data });
  mkdirSync(join(workspace.workspace, ".piclaw"));
  writeFileSync(join(workspace.workspace, ".piclaw", "config.json"), JSON.stringify({ domains: { access: { mode: "single-user" } } }));
  try {
    let calls = 0;
    setSshToolHandlers({
      get: () => { calls++; return null; },
      async set() { calls++; throw new Error("unexpected"); },
      async clear() { calls++; return { deleted: false, apply_timing: "next_session" }; },
    });
    const fake = createFakeExtensionApi();
    sshTool(fake.api);
    const result = await fake.tools.get("ssh").execute("tool-3", { action: "get" });
    expect(result.details.configured).toBe(false);
    expect(calls).toBe(1);
  } finally {
    restore(); workspace.cleanup();
  }
});
