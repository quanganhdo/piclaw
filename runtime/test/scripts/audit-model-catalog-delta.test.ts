import { expect, test } from "bun:test";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import { createTempWorkspace } from "../helpers.js";

const repoRoot = join(import.meta.dir, "..", "..", "..");
const scriptPath = join(repoRoot, "scripts", "audit-model-catalog-delta.ts");

function writeJson(path: string, value: unknown): void {
  mkdirSync(join(path, ".."), { recursive: true });
  writeFileSync(path, JSON.stringify(value, null, 2));
}

async function audit(base: string, head: string, output: string, extra: string[] = []) {
  const process = Bun.spawn(["bun", "run", scriptPath, "--base", base, "--head", head, "--json", output, ...extra], {
    cwd: repoRoot,
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stdout, stderr, exitCode] = await Promise.all([
    new Response(process.stdout).text(),
    new Response(process.stderr).text(),
    process.exited,
  ]);
  return { stdout, stderr, exitCode, report: JSON.parse(readFileSync(output, "utf8")) };
}

test("flattens provider/API/model catalogs, ignores manifests, and reports API moves without netting gross deltas", async () => {
  const workspace = createTempWorkspace("piclaw-catalog-api-delta-");
  try {
    const base = join(workspace.base, "base");
    const head = join(workspace.base, "head");
    const output = join(workspace.base, "delta.json");
    const common = {
      id: "same",
      provider: "fixture",
      api: "api-one",
      name: "Same",
      compat: { nested: { alpha: 1, beta: 2 }, enabled: true },
      cost: { input: 1, output: 2 },
    };

    writeJson(join(base, "fixture.json"), {
      "api-one": {
        moved: { ...common, id: "moved" },
        removed: { ...common, id: "removed" },
        same: common,
        id: { id: "id", name: "Model literally named id" },
      },
    });
    writeJson(join(head, "fixture.json"), {
      "api-one": {
        added: { ...common, id: "added" },
        id: { id: "id", name: "Model literally named id" },
        same: {
          cost: { output: 2, input: 1 },
          compat: { enabled: true, nested: { beta: 2, alpha: 1 } },
          name: "Same",
          api: "api-one",
          provider: "fixture",
          id: "same",
        },
      },
      "api-two": { moved: { ...common, id: "moved", api: "api-two" } },
    });
    // A manifest is metadata, not a provider, even when it does not start with a dot.
    writeJson(join(base, "catalog.manifest.json"), ["not", "a", "provider"]);
    writeJson(join(head, ".manifest.json"), ["not", "a", "provider"]);

    const result = await audit(base, head, output);
    expect(result.exitCode).toBe(0);
    expect(result.stderr).toBe("");
    expect(result.report.summary).toMatchObject({
      base_entries: 4,
      head_entries: 4,
      models_added: 2,
      models_removed: 2,
      models_changed: 0,
      api_moves: 1,
      field_changes: 0,
    });
    expect(result.report.provider_deltas).toEqual([
      expect.objectContaining({
        provider: "fixture",
        base_model_count: 4,
        head_model_count: 4,
        added_models: ["api-one/added", "api-two/moved"],
        removed_models: ["api-one/moved", "api-one/removed"],
      }),
    ]);
    expect(result.report.api_moves).toEqual([
      { provider: "fixture", model: "moved", from_api: "api-one", to_api: "api-two" },
    ]);
    expect(result.report.model_deltas.filter((delta: { model: string }) => delta.model === "same")).toEqual([]);
  } finally {
    workspace.cleanup();
  }
});

test("keeps repeated model IDs on distinct routes and compares ordered arrays and overlapping fields", async () => {
  const workspace = createTempWorkspace("piclaw-catalog-repeated-id-");
  try {
    const base = join(workspace.base, "base");
    const head = join(workspace.base, "head");
    const model = { id: "same", cost: { input: 1, output: 2 }, input: ["text", "image"], contextWindow: 100 };
    writeJson(join(base, "fixture.json"), { a: { same: model }, b: { same: model } });
    writeJson(join(head, "fixture.json"), {
      a: { same: { ...model, cost: { input: 3, output: 2 }, input: ["image", "text"], contextWindow: 200 } },
      b: { same: model },
    });
    const result = await audit(base, head, join(workspace.base, "out.json"), ["--include-unchanged", "--fail-on", "fields"]);
    expect(result.exitCode).toBe(1);
    expect(result.report.summary).toMatchObject({ base_entries: 2, head_entries: 2, models_changed: 1, field_changes: 3,
      changed_entries_by_field: { cost: 1, input: 1, contextWindow: 1 } });
    expect(result.report.model_deltas.map((entry: { api: string; status: string }) => [entry.api, entry.status])).toEqual([["a", "changed"], ["b", "unchanged"]]);
    const filtered = await audit(base, head, join(workspace.base, "filtered.json"), ["--fields", "cost", "--fail-on", "models"]);
    expect(filtered.exitCode).toBe(1);
    expect(filtered.report.summary.field_changes).toBe(1);
  } finally { workspace.cleanup(); }
});

test("does not infer API moves for ambiguous multiple removed and added routes", async () => {
  const workspace = createTempWorkspace("piclaw-catalog-ambiguous-");
  try {
    const base = join(workspace.base, "base"), head = join(workspace.base, "head");
    const models = { repeated: { id: "repeated", name: "Repeated" } };
    writeJson(join(base, "fixture.json"), { oldA: models, oldB: models });
    writeJson(join(head, "fixture.json"), { newA: models, newB: models });
    const result = await audit(base, head, join(workspace.base, "out.json"), ["--fail-on", "any"]);
    expect(result.exitCode).toBe(1);
    expect(result.report.summary).toMatchObject({ models_added: 2, models_removed: 2, api_moves: 0 });
    expect(result.report.api_moves).toEqual([]);
  } finally { workspace.cleanup(); }
});

test("provider filters and field filters preserve gross entry totals even for unchanged providers", async () => {
  const workspace = createTempWorkspace("piclaw-catalog-provider-filter-");
  try {
    const base = join(workspace.base, "base"), head = join(workspace.base, "head");
    writeJson(join(base, "fixture.json"), { api: { a: { id: "a", name: "A" } } });
    writeJson(join(head, "fixture.json"), { api: { a: { id: "a", name: "A", cost: { input: 5 } } } });
    writeJson(join(head, "other.json"), { api: { b: { id: "b" } } });
    const result = await audit(base, head, join(workspace.base, "out.json"), ["--providers", "fixture", "--fields", "name", "--fail-on", "any"]);
    expect(result.exitCode).toBe(0);
    expect(result.report.summary).toMatchObject({ base_entries: 1, head_entries: 1, providers_added: 0, models_changed: 0 });
    expect(result.report.provider_deltas).toEqual([]);
    const all = await audit(base, head, join(workspace.base, "all.json"), ["--fail-on", "providers"]);
    expect(all.exitCode).toBe(1);
    expect(all.report.summary.providers_added).toBe(1);
  } finally { workspace.cleanup(); }
});
