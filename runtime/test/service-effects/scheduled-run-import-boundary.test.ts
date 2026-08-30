import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import * as scheduledRunModule from "../../src/service-effects/current-piclaw/scheduled-run-store.js";

function tokenShingles(source: string, width = 7): Set<string> {
  const body = source.replace(/^import[\s\S]*?;$/gmu, "").replace(/\/\*[\s\S]*?\*\/|\/\/.*$/gmu, "");
  const tokens = body.match(/[A-Za-z_$][A-Za-z0-9_$]*|\d+|===|!==|=>|[{}()[\].,:?+*|&!<>-]/gu) ?? [];
  return new Set(tokens.slice(0, Math.max(0, tokens.length - width + 1)).map((_, index) => tokens.slice(index, index + width).join(" ")));
}

function sourceSimilarity(left: string, right: string): number {
  const a = tokenShingles(left), b = tokenShingles(right);
  let intersection = 0;
  for (const shingle of a) if (b.has(shingle)) intersection += 1;
  return intersection / Math.max(1, a.size + b.size - intersection);
}

describe("EF-S07 production import boundary", () => {
  test("fake remains independent while the live scheduler uses only the bounded store constructor", () => {
    const root = join(import.meta.dir, "../..");
    for (const relative of ["src/service-effects/testing/fakes/fake-scheduled-run-store.ts", "src/service-effects/testing/fakes/fake-scheduled-run-values.ts"]) {
      const fake = readFileSync(join(root, relative), "utf8");
      expect(fake).not.toContain("bun:sqlite");
      expect(fake).not.toContain("current-piclaw/");
    }
    const fakeValues = readFileSync(join(root, "src/service-effects/testing/fakes/fake-scheduled-run-values.ts"), "utf8");
    const sqliteValues = readFileSync(join(root, "src/service-effects/current-piclaw/scheduled-run-values.ts"), "utf8");
    expect(fakeValues).toContain("class ClosedInput");
    expect(sqliteValues).not.toContain("class ClosedInput");
    expect(sourceSimilarity(fakeValues, sqliteValues)).toBeLessThan(0.45);
    expect(Object.keys(scheduledRunModule)).not.toContain("CurrentPiclawScheduledRunStore");
    const adapter = readFileSync(join(root, "src/service-effects/current-piclaw/scheduled-run-store.ts"), "utf8");
    expect(adapter).toContain("private constructor(");
    expect(adapter).not.toContain("export class CurrentPiclawScheduledRunStore");
  });

  test("production installs and claims EF-S07 while the legacy unclaimed poll path is unreachable", () => {
    const root = join(import.meta.dir, "../..");
    const scheduler = readFileSync(join(root, "src/task-scheduler.ts"), "utf8");
    const connection = readFileSync(join(root, "src/db/connection.ts"), "utf8");
    const tasks = readFileSync(join(root, "src/db/tasks.ts"), "utf8");

    expect(connection).toContain("installScheduledRunCompositionSchema(db)");
    expect(tasks).toContain("createScheduledTaskAuthorityRecord");
    expect(scheduler).toContain("createCurrentPiclawScheduledRunStore");
    expect(scheduler).toContain("store.claimDue");
    expect(scheduler).toContain("lease.record.runId");
    expect(scheduler).not.toContain("getDueTasks(");
    expect(scheduler).not.toContain("enqueueTask(cur.id");

    for (const relative of [
      "src/index.ts",
      "src/task-scheduler-utils.ts",
      "src/queue.ts",
      "src/extensions/scheduled-tasks.ts",
      "src/scheduled-task-query-service.ts",
    ]) {
      const source = readFileSync(join(root, relative), "utf8");
      expect(source).not.toContain("service_effect_s07");
    }
  });
});
