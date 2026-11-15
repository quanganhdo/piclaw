/**
 * test/agent-control/agent-control-helpers.test.ts – Tests for helper functions.
 *
 * Covers formatCompactNumber(), formatCurrency(), formatShellBlock(),
 * truncateText(), extractTextFromContent(), normalizeModelMatch(),
 * and thinking metadata aliases.
 */

import { resolve } from "path";
import { beforeEach, expect, test } from "bun:test";

import { createTempWorkspace } from "../helpers.js";
import {
  extractTextFromContent,
  formatCompactNumber,
  formatCurrency,
  formatShellBlock,
  formatThinkingLevelForDisplay,
  normalizeModelMatch,
  resolveThinkingAlias,
  truncateText,
} from "../../src/agent-control/agent-control-helpers.js";
import { initDatabase } from "../../src/db.js";

beforeEach(() => initDatabase());

test("formatting helpers format numbers and currency", () => {
  expect(formatCompactNumber(950)).toBe("950");
  expect(formatCompactNumber(1500)).toBe("1.5K");
  expect(formatCompactNumber(2_500_000)).toBe("2.5M");
  expect(formatCurrency(0)).toBe("$0");
  expect(formatCurrency(0.009)).toBe("$0.0090");
  expect(formatCurrency(1.5)).toBe("$1.50");
});

test("formatShellBlock renders command with metadata", () => {
  const block = formatShellBlock("echo hi", "hi\n", ["(exit code 0)"]);
  expect(block).toContain("$ echo hi");
  expect(block).toContain("hi");
  expect(block).toContain("(exit code 0)");
});

test("resolveShellCwd prefers configured WORKSPACE_DIR over legacy /workspace", () => {
  const ws = createTempWorkspace("piclaw-shell-cwd-");

  try {
    const run = Bun.spawnSync({
      cmd: [
        "bun",
        "-e",
        'import { resolveShellCwd } from "./src/agent-control/agent-control-helpers.js"; console.log(resolveShellCwd());',
      ],
      cwd: resolve(import.meta.dir, "../.."),
      env: {
        ...process.env,
        PICLAW_WORKSPACE: ws.workspace,
        PICLAW_STORE: ws.store,
        PICLAW_DATA: ws.data,
        PICLAW_DB_IN_MEMORY: "1",
      },
    });

    expect(run.exitCode, run.stderr.toString() || run.stdout.toString()).toBe(0);
    expect(run.stdout.toString().trim()).toBe(ws.workspace);
  } finally {
    ws.cleanup();
  }
});

test("truncateText and extractTextFromContent", () => {
  expect(truncateText("hello", 10)).toBe("hello");
  expect(truncateText("hello world", 6)).toBe("hello…");
  expect(extractTextFromContent([{ type: "text", text: "A" }, { type: "image" }, { type: "text", text: "B" }]))
    .toBe("AB");
});

test("normalizeModelMatch finds provider/id case-insensitively", () => {
  const models = [
    { provider: "OpenAI", id: "gpt-test" },
    { provider: "Anthropic", id: "claude" },
  ] as any;
  const match = normalizeModelMatch(models, "openai", "GPT-TEST");
  expect(match?.provider).toBe("OpenAI");
});

test("thinking aliases preserve native max while supporting legacy model metadata", () => {
  const legacy = { provider: "anthropic", thinkingLevelMap: { xhigh: "max" } } as any;
  const legacyWithExplicitNull = { provider: "anthropic", thinkingLevelMap: { xhigh: "max", max: null } } as any;
  const native = { provider: "anthropic", thinkingLevelMap: { xhigh: "xhigh", max: "max" } } as any;
  expect(resolveThinkingAlias("max", legacy)).toBe("xhigh");
  expect(resolveThinkingAlias("max", legacyWithExplicitNull)).toBe("xhigh");
  expect(resolveThinkingAlias("max", native)).toBe("max");
  expect(resolveThinkingAlias("high", legacy)).toBe("high");
  expect(formatThinkingLevelForDisplay("xhigh", legacy)).toBe("max");
  expect(formatThinkingLevelForDisplay("xhigh", native)).toBe("xhigh");
  expect(formatThinkingLevelForDisplay("max", native)).toBe("max");
});
