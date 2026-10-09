import { readFileSync as readFileSyncForTarget } from "node:fs";

const historicalTest = JSON.parse(readFileSyncForTarget(new URL("../../../node_modules/@earendil-works/pi-coding-agent/package.json", import.meta.url), "utf8")).version === "1.0.3" ? test : test.skip;

import { expect, test } from "bun:test";
import { CodemodeSandbox, MAX_OUTPUT_CHARS, MAX_OUTPUT_ITEMS } from "@earendil-works/pi-codemode";
historicalTest("1.0.3 codemode output character cap terminates caught overflow and remains usable", async () => {
  expect(MAX_OUTPUT_CHARS).toBe(16 * 1024 * 1024); const sandbox = new CodemodeSandbox({ timeoutMs: 5000, memoryLimitBytes: 128 * 1024 * 1024 });
  try {
    const result = await sandbox.execute(`try{text('x'.repeat(${MAX_OUTPUT_CHARS + 1}));}catch(e){text('catch must not resume output');}text('after must not emit');`);
    expect(result.ok).toBe(false);
    if (!result.ok) { expect(result.error.kind).toBe("script"); expect(result.error.message).toContain("output exceeded the limit"); }
    expect(result.output).toEqual([]);
    const next = await sandbox.execute("text('next isolated run');return 7;"); expect(next.ok).toBe(true); expect(next.output).toEqual([{ type: "text", text: "next isolated run" }]);
  } finally { await sandbox.close(); }
}, 15_000);
historicalTest("1.0.3 codemode output item cap terminates empty-output loop", async () => {
  expect(MAX_OUTPUT_ITEMS).toBe(100_000); const sandbox = new CodemodeSandbox({ timeoutMs: 10_000, memoryLimitBytes: 128 * 1024 * 1024 });
  try {
    const result = await sandbox.execute(`for(let n=0;n<${MAX_OUTPUT_ITEMS + 1};n++)text('');`);
    expect(result.ok).toBe(false); if (!result.ok) { expect(result.error.kind).toBe("script"); expect(result.error.message).toContain("output exceeded the limit"); }
    expect(result.output).toHaveLength(MAX_OUTPUT_ITEMS); expect(result.calls).toEqual([]);
    const next = await sandbox.execute("text('usable after item overflow');return 9;"); expect(next.ok).toBe(true); expect(next.output).toEqual([{ type: "text", text: "usable after item overflow" }]);
  } finally { await sandbox.close(); }
}, 20_000);
