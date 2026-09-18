import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const repoRoot = join(import.meta.dir, "../../..");
const classicComponent = readFileSync(join(repoRoot, "runtime/web/src/components/settings/keyboard.ts"), "utf8");
const classicCss = readFileSync(join(repoRoot, "runtime/web/static/classic/css/settings.css"), "utf8");
const visualComponent = readFileSync(join(repoRoot, "runtime/web/static/visual/frontend/src/panels/settings/KeyboardSection.tsx"), "utf8");
const visualPanel = readFileSync(join(repoRoot, "runtime/web/static/visual/frontend/src/panels/SettingsPanel.tsx"), "utf8");
const visualCss = readFileSync(join(repoRoot, "runtime/web/static/visual/css/shell.css"), "utf8");

test("classic Keyboard uses the shared settings model and no layout-critical inline styles", () => {
  expect(classicComponent).toContain("keyboard-shortcut-settings.js");
  expect(classicComponent).not.toContain("style=");
  expect(classicComponent).not.toContain("grid-template-columns:minmax(240px");
  expect(classicComponent).not.toContain("min-height:46px");
  expect(classicComponent).toContain('class="settings-shortcut-input"');
  expect(classicComponent).toContain('for=${inputId}');
  expect(classicCss).toContain(".settings-shortcut-controls .settings-shortcut-input");
  expect(classicCss).toContain(".settings-dialog-narrow .settings-shortcut-card");
});

test("visual Keyboard is registered and uses visual settings primitives", () => {
  expect(visualPanel).toContain('import "./settings/KeyboardSection"');
  expect(visualComponent).toContain('id: "keyboard"');
  expect(visualComponent).toContain('className="settings-panel__input settings-panel__shortcut-input"');
  expect(visualComponent).toContain('className="settings-panel__provider-btn"');
  expect(visualComponent).toContain('htmlFor={inputId}');
  expect(visualCss).toContain(".settings-panel__shortcut-card");
  expect(visualCss).toContain(".settings-panel__shortcut-input");
  expect(visualCss).toContain(".settings-panel__shortcut-actions");
});
