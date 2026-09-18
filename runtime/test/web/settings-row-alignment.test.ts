import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const repoRoot = join(import.meta.dir, "../../..");
const classicComponent = readFileSync(join(repoRoot, "runtime/web/src/components/settings/compaction.ts"), "utf8");
const classicCss = readFileSync(join(repoRoot, "runtime/web/static/classic/css/settings.css"), "utf8");
const visualComponent = readFileSync(join(repoRoot, "runtime/web/static/visual/frontend/src/panels/settings/CompactionSection.tsx"), "utf8");
const visualCss = readFileSync(join(repoRoot, "runtime/web/static/visual/css/shell.css"), "utf8");

test("Classic Compaction opts into dense rows without changing shared Settings rows", () => {
  expect(classicComponent).toContain('class="settings-section settings-dense-form"');
  expect(classicComponent.match(/settings-dense-row/g)?.length).toBeGreaterThanOrEqual(17);
  expect(classicComponent).toContain("settings-dense-row-compound compaction-model-picker");
  expect(classicCss).toContain(".settings-dense-row {");
  expect(classicCss).toContain("grid-template-columns: var(--settings-dense-label-width) var(--settings-dense-control-width) minmax(0, 1fr)");
  expect(classicCss).toContain(".settings-dense-row-compound");
  expect(classicCss).toContain(".settings-row {\n    display: flex;");
});

test("Visual Compaction uses a Visual-specific dense row primitive", () => {
  expect(visualComponent).toContain('className="settings-panel__section settings-panel__dense-form"');
  expect(visualComponent.match(/settings-panel__dense-row/g)?.length).toBeGreaterThanOrEqual(15);
  expect(visualComponent).toContain("settings-panel__dense-row--compound compaction-model-picker");
  expect(visualCss).toContain(".settings-panel__dense-row {");
  expect(visualCss).toContain("--settings-panel-dense-label-width: 180px");
  expect(visualCss).toContain("--settings-panel-dense-control-width: 200px");
  expect(visualCss).toContain(".settings-panel__dense-row--compound");
  expect(visualCss).toContain(".settings-panel__field { display: flex;");
});
