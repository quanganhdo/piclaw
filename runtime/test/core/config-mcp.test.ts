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
