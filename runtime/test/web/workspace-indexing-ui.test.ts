import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { workspaceIndexPolicyFromText } from "../../web/src/components/settings/workspace-indexing.js";

const runtimeRoot = join(import.meta.dir, "../..");
const ui = readFileSync(join(runtimeRoot, "web/src/components/settings/workspace-indexing.ts"), "utf8");
const api = readFileSync(join(runtimeRoot, "web/src/api.ts"), "utf8");

test("workspace indexing text model preserves an explicitly empty root list", () => {
  expect(workspaceIndexPolicyFromText("", "# generated files\n**/generated/**\n"))
    .toEqual({ roots: [], ignorePatterns: ["# generated files", "**/generated/**"] });
});

test("Workspace settings exposes explicit indexing controls and status", () => {
  expect(ui).toContain('aria-label="Indexed roots"');
  expect(ui).toContain('aria-label="Index ignore patterns"');
  expect(ui).toContain("run('preview')");
  expect(ui).toContain("run('save')");
  expect(ui).toContain("run('refresh')");
  expect(ui).toContain("Refresh now");
  expect(ui).toContain("indexed_file_count");
  expect(ui).toContain("last_error");
  expect(ui).toContain("Unsaved changes");
  expect(ui).not.toContain("setTimeout");
  expect(api).toContain("/agent/settings/workspace/indexing/preview");
  expect(api).toContain("/agent/settings/workspace/indexing/save");
  expect(api).toContain("/agent/settings/workspace/indexing/refresh");
});
