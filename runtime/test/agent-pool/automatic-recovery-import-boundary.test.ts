import { expect, test } from "bun:test";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, resolve } from "node:path";

const sourceRoot = resolve(import.meta.dir, "../../src");

function walk(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    const stat = statSync(full);
    if (stat.isDirectory()) {
      walk(full, out);
      continue;
    }
    if (stat.isFile() && full.endsWith(".ts")) out.push(full);
  }
  return out;
}

test("automatic-recovery production imports are restricted to the retirement boundary", () => {
  const expected: string[] = [];

  const importers = walk(sourceRoot)
    .filter((file) => readFileSync(file, "utf8").includes("automatic-recovery.js"))
    .map((file) => file.slice(sourceRoot.length + 1).replaceAll("\\", "/"))
    .filter((file) => file !== "agent-pool/automatic-recovery.ts")
    .sort();

  expect(importers).toEqual(expected);
});
