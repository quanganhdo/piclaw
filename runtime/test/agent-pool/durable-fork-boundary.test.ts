import { expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { resolve } from "node:path";

const source = resolve(import.meta.dir, "../../src");
const fixture = resolve(import.meta.dir, "../model-services-fixture.ts");

test("durable createForkedChatBranch fails before branch-seeding/import-time legacy flow", async () => {
  const root = mkdtempSync(resolve(tmpdir(), "durable-fork-boundary-"));

  const script = `
    import { plugin } from "bun";
    const source = ${JSON.stringify(source)};
    const attempts = [];
    plugin({ name: "durable-fork-branch-seeding-fence", setup(build) {
      build.onLoad({ filter: /\\/agent-pool\\/branch-seeding\\.(ts|js)$/ }, args => {
        if (!args.path.startsWith(source + "/")) return;
        attempts.push(args.path);
        throw new Error("DURABLE_FORK_BRANCH_SEEDING_FENCE:" + args.path);
      });
    }});

    const { AgentPool } = await import(source + "/agent-pool.ts");
    const { initDatabase, storeChatMetadata, ensureChatBranch, getDb } = await import(source + "/db.js");
    const { createAgentPoolModelOptions } = await import(${JSON.stringify(fixture)});

    initDatabase();
    const chatJid = "web:durable-fork-source";
    storeChatMetadata(chatJid, "2026-01-01T00:00:00.000Z", "source");
    ensureChatBranch({ chat_jid: chatJid, agent_name: "source" });

    const pool = new AgentPool({
      ...createAgentPoolModelOptions(),
      getDurableSession: () => undefined,
    });

    const beforeBranches = getDb().query("SELECT chat_jid, root_chat_jid, parent_branch_id, archived_at FROM chat_branches ORDER BY chat_jid").all();
    let failure = "";
    try {
      await pool.createForkedChatBranch(chatJid, { agentName: "forked" });
      throw new Error("Expected durable createForkedChatBranch to fail closed");
    } catch (error) {
      failure = String(error);
    }

    if (!failure.includes("Durable branch fork unavailable")) {
      throw new Error("Unexpected durable fork failure: " + failure);
    }
    const afterBranches = getDb().query("SELECT chat_jid, root_chat_jid, parent_branch_id, archived_at FROM chat_branches ORDER BY chat_jid").all();
    if (JSON.stringify(afterBranches) !== JSON.stringify(beforeBranches)) {
      throw new Error("Durable fork failure must not create or reparent branch metadata");
    }

    await pool.shutdown();
    console.log(JSON.stringify({ attempts, failure }));
  `;

  try {
    const child = Bun.spawn([process.execPath, "--eval", script], {
      cwd: root,
      env: {
        PATH: process.env.PATH,
        HOME: root,
        PICLAW_WORKSPACE: resolve(root, "workspace"),
        PICLAW_STORE: resolve(root, "store"),
        PICLAW_DATA: resolve(root, "data"),
        PI_CODING_AGENT_DIR: resolve(root, "agent"),
        PICLAW_DB_IN_MEMORY: "1",
      },
      stdout: "pipe",
      stderr: "pipe",
    });

    const [stdout, stderr, exitCode] = await Promise.all([
      new Response(child.stdout).text(),
      new Response(child.stderr).text(),
      child.exited,
    ]);

    expect({ exitCode, stderr: exitCode ? stderr : "" }).toEqual({ exitCode: 0, stderr: "" });
    const result = JSON.parse(stdout.trim().split("\n").at(-1)!);
    expect(result.attempts).toEqual([]);
    expect(String(result.failure)).toContain("Durable branch fork unavailable");
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}, 30000);

test("durable createRootChatSession fails closed without mutating branch metadata", async () => {
  const root = mkdtempSync(resolve(tmpdir(), "durable-root-boundary-"));

  const script = `
    const { AgentPool } = await import(${JSON.stringify(resolve(source, "agent-pool.ts"))});
    const { initDatabase, getDb } = await import(${JSON.stringify(resolve(source, "db.ts"))});
    const { createAgentPoolModelOptions } = await import(${JSON.stringify(fixture)});

    initDatabase();
    const pool = new AgentPool({
      ...createAgentPoolModelOptions(),
      getDurableSession: () => undefined,
    });

    const beforeBranches = getDb().query("SELECT chat_jid, root_chat_jid, parent_branch_id, archived_at FROM chat_branches ORDER BY chat_jid").all();
    let failure = "";
    try {
      await pool.createRootChatSession("research-root");
      throw new Error("Expected durable createRootChatSession to fail closed");
    } catch (error) {
      failure = String(error);
    }

    if (!failure.includes("Durable root session creation unavailable")) {
      throw new Error("Unexpected durable root failure: " + failure);
    }

    const afterBranches = getDb().query("SELECT chat_jid, root_chat_jid, parent_branch_id, archived_at FROM chat_branches ORDER BY chat_jid").all();
    if (JSON.stringify(afterBranches) !== JSON.stringify(beforeBranches)) {
      throw new Error("Durable root creation failure must not mutate branch metadata");
    }

    await pool.shutdown();
    console.log(JSON.stringify({ failure }));
  `;

  try {
    const child = Bun.spawn([process.execPath, "--eval", script], {
      cwd: root,
      env: {
        PATH: process.env.PATH,
        HOME: root,
        PICLAW_WORKSPACE: resolve(root, "workspace"),
        PICLAW_STORE: resolve(root, "store"),
        PICLAW_DATA: resolve(root, "data"),
        PI_CODING_AGENT_DIR: resolve(root, "agent"),
        PICLAW_DB_IN_MEMORY: "1",
      },
      stdout: "pipe",
      stderr: "pipe",
    });

    const [stdout, stderr, exitCode] = await Promise.all([
      new Response(child.stdout).text(),
      new Response(child.stderr).text(),
      child.exited,
    ]);

    expect({ exitCode, stderr: exitCode ? stderr : "" }).toEqual({ exitCode: 0, stderr: "" });
    const result = JSON.parse(stdout.trim().split("\n").at(-1)!);
    expect(String(result.failure)).toContain("Durable root session creation unavailable");
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}, 30000);

test("durable permanentPurgeChatBranch fails closed without mutating branch metadata", async () => {
  const root = mkdtempSync(resolve(tmpdir(), "durable-purge-boundary-"));

  const script = `
    const { AgentPool } = await import(${JSON.stringify(resolve(source, "agent-pool.ts"))});
    const { initDatabase, getDb } = await import(${JSON.stringify(resolve(source, "db.ts"))});
    const { createAgentPoolModelOptions } = await import(${JSON.stringify(fixture)});

    initDatabase();
    const pool = new AgentPool({
      ...createAgentPoolModelOptions(),
      getDurableSession: () => undefined,
    });

    const beforeBranches = getDb().query("SELECT chat_jid, root_chat_jid, parent_branch_id, archived_at FROM chat_branches ORDER BY chat_jid").all();
    let failure = "";
    try {
      await pool.permanentPurgeChatBranch("web:durable-purge-target");
      throw new Error("Expected durable permanentPurgeChatBranch to fail closed");
    } catch (error) {
      failure = String(error);
    }

    if (!failure.includes("Durable branch purge unavailable")) {
      throw new Error("Unexpected durable purge failure: " + failure);
    }

    const afterBranches = getDb().query("SELECT chat_jid, root_chat_jid, parent_branch_id, archived_at FROM chat_branches ORDER BY chat_jid").all();
    if (JSON.stringify(afterBranches) !== JSON.stringify(beforeBranches)) {
      throw new Error("Durable purge failure must not mutate branch metadata");
    }

    await pool.shutdown();
    console.log(JSON.stringify({ failure }));
  `;

  try {
    const child = Bun.spawn([process.execPath, "--eval", script], {
      cwd: root,
      env: {
        PATH: process.env.PATH,
        HOME: root,
        PICLAW_WORKSPACE: resolve(root, "workspace"),
        PICLAW_STORE: resolve(root, "store"),
        PICLAW_DATA: resolve(root, "data"),
        PI_CODING_AGENT_DIR: resolve(root, "agent"),
        PICLAW_DB_IN_MEMORY: "1",
      },
      stdout: "pipe",
      stderr: "pipe",
    });

    const [stdout, stderr, exitCode] = await Promise.all([
      new Response(child.stdout).text(),
      new Response(child.stderr).text(),
      child.exited,
    ]);

    expect({ exitCode, stderr: exitCode ? stderr : "" }).toEqual({ exitCode: 0, stderr: "" });
    const result = JSON.parse(stdout.trim().split("\n").at(-1)!);
    expect(String(result.failure)).toContain("Durable branch purge unavailable");
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}, 30000);
