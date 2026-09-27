import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const read = (file: string) => readFileSync(join(import.meta.dir, "../../web/static", file), "utf8");

test("opt-in Settings field styles are loaded in both skins and confined to the add-on host", () => {
  for (const skin of ["classic", "visual"]) {
    expect(read(`${skin}/css/styles.css`)).toContain('@import "../../common/css/settings-addon-controls.css";');
  }
  const css = read("common/css/settings-addon-controls.css");
  for (const role of ["section", "field", "label", "control", "control-group", "help", "actions", "error", "status"]) {
    expect(css).toContain(`.settings-addon-${role}`);
  }
  for (const rule of [":focus-visible", ":disabled", "[readonly]", '[aria-invalid="true"]', "max-width: 100%", "min-width: 0", "flex-wrap: wrap"]) expect(css).toContain(rule);
  expect(css).not.toContain("!important");
  expect(css).not.toContain("min-height: 44px");
});

test("legacy Visual add-on descendant overrides cannot restyle built-in Settings", () => {
  const css = read("visual/css/shell.css");
  const legacy = css.split("/* Legacy add-on markup only.")[1].split("/* Separator between core and addon nav items */")[0];
  expect(legacy).not.toContain(".settings-panel__content");
  expect(legacy).not.toContain("max-height: none");
  expect(legacy).toContain(".settings-addon-pane");
  expect(legacy).toContain(":not(.settings-addon-control)");
  expect(legacy).toContain(":not(.settings-addon-label)");
});

test("narrow-layout overrides are scoped to General, Keychain and the moved settings forms", () => {
  const css = read("visual/css/shell.css");
  expect(css).toContain(":is(.settings-panel__section--general, .settings-panel__section--keychain, .settings-panel__section--authentication, .settings-panel__section--api-access, .settings-panel__section--sessions)");
  expect(css).toContain(".settings-panel__section--general .settings-panel__checkbox-row { margin-left: 0; }");
  expect(css).toContain(".settings-panel__section--keychain .settings-panel__actions-row { flex-wrap: wrap; }");
  expect(css).toContain(".settings-panel__content :is(.settings-panel__input, .settings-panel__select, .settings-panel__stepper-value, .custom-select__trigger):focus-visible");
});
