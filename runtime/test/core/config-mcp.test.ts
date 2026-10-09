import { expect, test } from "bun:test";
import { readFileSync, writeFileSync, symlinkSync, linkSync, chmodSync } from "node:fs";
import { join } from "node:path";
import { createTempWorkspace } from "../helpers.js";
import { readMcpInstancePolicy, commitMcpInstancePolicy } from "../../src/core/config-mcp.js";

test("instance MCP settings default to adapter/auto and persist strictly without disturbing other domains", () => {
  const ws = createTempWorkspace("mcp-policy-config-");
  const path = join(ws.base, "config.json");
  try {
    const initial = readMcpInstancePolicy(path);
    expect(initial).toEqual({ policy: { engine: "adapter", codemode: "auto" }, revision: "absent" });
    writeFileSync(path, JSON.stringify({ assistant: { name: "Fixture" }, domains: { web: { enabled: true } } }), { mode: 0o600 });
    const current = readMcpInstancePolicy(path);
    const saved = commitMcpInstancePolicy({ engine: "native", codemode: "on" }, current.revision, path);
    expect(saved.policy).toEqual({ engine: "native", codemode: "on" }); expect(saved.revision).not.toBe(current.revision);
    expect(JSON.parse(readFileSync(path, "utf8"))).toEqual({ assistant: { name: "Fixture" }, domains: { web: { enabled: true }, mcp: { engine: "native", codemode: "on" } } });
    expect(readMcpInstancePolicy(path)).toEqual(saved);
    expect(() => commitMcpInstancePolicy({ engine: "adapter", codemode: "off" }, current.revision, path)).toThrow("changed");
    expect(readMcpInstancePolicy(path)).toEqual(saved);
  } finally { ws.cleanup(); }
});

test("MCP settings reject invalid input and corrupted config without overwriting it", () => {
  const ws = createTempWorkspace("mcp-policy-invalid-");
  const path = join(ws.base, "config.json");
  try {
    for (const value of [{ engine: "other", codemode: "auto" }, { engine: "native", codemode: "other" }, { engine: "adapter", codemode: "auto", secret: "PRIVATE-SENTINEL" }]) {
      expect(() => commitMcpInstancePolicy(value, "absent", path)).toThrow();
    }
    for (const content of ["{bad", "42", "[]", '{"domains":[]}', '{"domains":{"mcp":[]}}', '{"domains":{"mcp":{"engine":"other"}}}', '{"domains":{"mcp":{"secret":"PRIVATE-SENTINEL"}}}']) {
      writeFileSync(path, content, { mode: 0o600 });
      expect(() => readMcpInstancePolicy(path)).toThrow();
      expect(() => commitMcpInstancePolicy({ engine: "adapter", codemode: "auto" }, "absent", path)).toThrow();
      expect(readFileSync(path, "utf8")).toBe(content);
    }
  } finally { ws.cleanup(); }
});

test("MCP settings reject symlinks and hardlinks and detect unrelated configuration edits", () => {
  const ws = createTempWorkspace("mcp-policy-links-");
  try {
    const original = join(ws.base, "original.json"), linked = join(ws.base, "linked.json"), hard = join(ws.base, "hard.json");
    writeFileSync(original, "{}", { mode: 0o600 }); symlinkSync(original, linked);
    expect(() => readMcpInstancePolicy(linked)).toThrow("regular");
    linkSync(original, hard); expect(() => readMcpInstancePolicy(hard)).toThrow("regular");
    const path = join(ws.base, "config.json"); writeFileSync(path, "{}", { mode: 0o600 });
    const snapshot = readMcpInstancePolicy(path);
    writeFileSync(path, '{"domains":{"web":{"enabled":false}}}');
    expect(() => commitMcpInstancePolicy({ engine: "native", codemode: "auto" }, snapshot.revision, path)).toThrow("changed");
    expect(JSON.parse(readFileSync(path, "utf8"))).toEqual({ domains: { web: { enabled: false } } });
  } finally { ws.cleanup(); }
});

test("MCP instance policy refuses non-private config permissions without changing contents", () => {
  const ws = createTempWorkspace("mcp-policy-permissions-");
  const path = join(ws.base, "config.json");
  try {
    writeFileSync(path, "{}", { mode: 0o600 });
    const initial = readMcpInstancePolicy(path);
    for (const mode of [0o640, 0o644, 0o620, 0o666]) {
      chmodSync(path, mode);
      expect(() => readMcpInstancePolicy(path)).toThrow("private");
      expect(() => commitMcpInstancePolicy({ engine: "native", codemode: "auto" }, initial.revision, path)).toThrow("private");
      expect(readFileSync(path, "utf8")).toBe("{}");
    }
    chmodSync(path, 0o600);
    expect(readMcpInstancePolicy(path)).toEqual(initial);
  } finally { ws.cleanup(); }
});

test("upgrade migration tightens legacy owner files and preserves bytes/revision", async () => {
  const { migrateMcpInstanceConfigPermissions } = await import("../../src/core/config-mcp.js");
  const { statSync } = await import("node:fs");
  const ws = createTempWorkspace("mcp-policy-migrate-");
  const path = join(ws.base, "config.json");
  const content = '{"assistant":{"name":"KEEP"},"domains":{"mcp":{"engine":"adapter","codemode":"on"}}}\n';
  try {
    expect(migrateMcpInstanceConfigPermissions(path)).toBe("absent");
    writeFileSync(path, content, { mode: 0o600 });
    const initial = readMcpInstancePolicy(path);
    for (const mode of [0o640, 0o644, 0o664, 0o666]) {
      chmodSync(path, mode);
      expect(migrateMcpInstanceConfigPermissions(path)).toBe("migrated");
      expect(statSync(path).mode & 0o777).toBe(0o600);
      expect(readFileSync(path, "utf8")).toBe(content);
      expect(readMcpInstancePolicy(path)).toEqual(initial);
      expect(migrateMcpInstanceConfigPermissions(path)).toBe("unchanged");
    }
  } finally { ws.cleanup(); }
});

test("upgrade migration never follows symlinks or modifies hardlinked/non-regular files", async () => {
  const { migrateMcpInstanceConfigPermissions } = await import("../../src/core/config-mcp.js");
  const { statSync, mkdirSync } = await import("node:fs");
  const ws = createTempWorkspace("mcp-policy-migration-links-");
  try {
    const original = join(ws.base, "original.json"), link = join(ws.base, "link.json"), hard = join(ws.base, "hard.json"), directory = join(ws.base, "directory");
    writeFileSync(original, "{}", { mode: 0o644 }); chmodSync(original, 0o644);
    symlinkSync(original, link);
    expect(() => migrateMcpInstanceConfigPermissions(link)).toThrow("regular");
    expect(statSync(original).mode & 0o777).toBe(0o644);
    linkSync(original, hard);
    expect(() => migrateMcpInstanceConfigPermissions(hard)).toThrow("owned private regular");
    expect(statSync(original).mode & 0o777).toBe(0o644);
    mkdirSync(directory);
    expect(() => migrateMcpInstanceConfigPermissions(directory)).toThrow("regular");
    const fifo = join(ws.base, "fifo");
    const process = Bun.spawnSync(["mkfifo", fifo]);
    expect(process.exitCode).toBe(0);
    expect(() => migrateMcpInstanceConfigPermissions(fifo)).toThrow("regular");
    expect(() => readMcpInstancePolicy(fifo)).toThrow("regular");
  } finally { ws.cleanup(); }
});

test("startup migration failure is nonfatal and never trusts foreign or unknown owners", async () => {
  const { prepareMcpInstanceConfig, migrateMcpInstanceConfigPermissions, McpInstanceConfigError } = await import("../../src/core/config-mcp.js");
  const { statSync } = await import("node:fs");
  const ws = createTempWorkspace("mcp-migration-owner-");
  const path = join(ws.base, "config.json");
  const getuid = process.getuid;
  try {
    writeFileSync(path, '{"PRIVATE_SENTINEL":true}', { mode: 0o644 }); chmodSync(path, 0o644);
    process.getuid = (() => statSync(path).uid + 1) as typeof process.getuid;
    expect(() => migrateMcpInstanceConfigPermissions(path)).toThrow("owned private regular");
    expect(prepareMcpInstanceConfig(path).migration).toBe("unavailable");
    expect(statSync(path).mode & 0o777).toBe(0o644);
    process.getuid = undefined;
    expect(prepareMcpInstanceConfig(path).migration).toBe("unavailable");
    expect(() => readMcpInstancePolicy(path)).toThrow(McpInstanceConfigError);
    expect(readFileSync(path, "utf8")).toBe('{"PRIVATE_SENTINEL":true}');
  } finally { process.getuid = getuid; ws.cleanup(); }
});
