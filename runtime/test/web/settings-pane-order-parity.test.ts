import { afterEach, describe, expect, test } from "bun:test";

import {
  getRegisteredSettingsPanes,
  registerSettingsPane as registerClassicPane,
  unregisterSettingsPane as unregisterClassicPane,
} from "../../web/src/components/settings/pane-registry.js";
import {
  getRegisteredPanes as getVisualPanes,
  registerAddonSettingsPane as registerVisualAddonPane,
  registerSettingsPane as registerVisualCorePane,
  unregisterSettingsPane as unregisterVisualPane,
} from "../../web/static/visual/frontend/src/panels/settings/pane-registry.js";

const ids = [
  "settings-order-alpha-a",
  "settings-order-alpha-b",
  "settings-order-zulu",
  "settings-order-core-a",
  "settings-order-core-b",
];

function definition(id: string, label: string, order?: number) {
  return { id, label, icon: null, component: null, ...(order === undefined ? {} : { order }) };
}

function listedIds(panes: Array<{ id: string }>): string[] {
  return panes.filter((pane) => ids.includes(pane.id)).map((pane) => pane.id);
}

function clearRegistries(): void {
  for (const id of ids) {
    unregisterClassicPane(id);
    unregisterVisualPane(id);
  }
}

afterEach(clearRegistries);

describe("settings pane order parity", () => {
  test("both skins sort add-on panes by label then id and ignore legacy order", () => {
    clearRegistries();
    const panes = [
      definition(ids[2], "Zulu", 1),
      definition(ids[1], "alpha", 10),
      definition(ids[0], "Alpha", 999),
    ];

    for (const pane of panes) {
      registerClassicPane(pane);
      registerVisualAddonPane(pane);
    }

    const expected = [ids[0], ids[1], ids[2]];
    expect(listedIds(getRegisteredSettingsPanes())).toEqual(expected);
    expect(listedIds(getVisualPanes())).toEqual(expected);
  });

  test("replacement preserves add-on ownership and re-sorts both skins", () => {
    clearRegistries();
    registerClassicPane(definition(ids[2], "Zulu"));
    registerClassicPane(definition(ids[0], "Alpha"));
    registerVisualAddonPane(definition(ids[2], "Zulu"));
    registerVisualAddonPane(definition(ids[0], "Alpha"));

    registerClassicPane(definition(ids[2], "Aardvark", 999));
    registerVisualAddonPane(definition(ids[2], "Aardvark", 999));

    expect(listedIds(getRegisteredSettingsPanes())).toEqual([ids[2], ids[0]]);
    expect(listedIds(getVisualPanes())).toEqual([ids[2], ids[0]]);
  });

  test("visual core panes keep fixed order ahead of alphabetic add-on panes", () => {
    clearRegistries();
    registerVisualCorePane(definition(ids[3], "Zulu core", 20));
    registerVisualCorePane(definition(ids[4], "Alpha core", 10));
    registerVisualAddonPane(definition(ids[2], "Zulu", 1));
    registerVisualAddonPane(definition(ids[0], "Alpha", 999));

    expect(listedIds(getVisualPanes())).toEqual([ids[4], ids[3], ids[0], ids[2]]);
  });

  test("the latest registration API determines visual pane ownership", () => {
    clearRegistries();
    registerVisualCorePane(definition(ids[3], "Core", 10));
    registerVisualAddonPane(definition(ids[3], "Addon", 1));
    expect(getVisualPanes().find((pane) => pane.id === ids[3])?.source).toBe("addon");

    registerVisualCorePane(definition(ids[3], "Core again", 10));
    expect(getVisualPanes().find((pane) => pane.id === ids[3])?.source).toBe("core");
  });

  test("unregister removes panes without disturbing the remaining order", () => {
    clearRegistries();
    for (const pane of [definition(ids[2], "Zulu"), definition(ids[0], "Alpha")]) {
      registerClassicPane(pane);
      registerVisualAddonPane(pane);
    }

    unregisterClassicPane(ids[0]);
    unregisterVisualPane(ids[0]);

    expect(listedIds(getRegisteredSettingsPanes())).toEqual([ids[2]]);
    expect(listedIds(getVisualPanes())).toEqual([ids[2]]);
  });
});
