import { afterEach, describe, expect, test } from "bun:test";

import {
  filterKeyboardShortcutActions,
  readKeyboardShortcutDrafts,
  resetKeyboardShortcutDraft,
  saveKeyboardShortcutDraft,
} from "../../web/src/ui/keyboard-shortcut-settings.js";
import { resetKeyboardShortcutBindings } from "../../web/src/ui/keyboard-shortcuts.js";

const originalWindowDescriptor = Object.getOwnPropertyDescriptor(globalThis, "window");
const originalLocalStorageDescriptor = Object.getOwnPropertyDescriptor(globalThis, "localStorage");

function restoreGlobal(name: "window" | "localStorage", descriptor: PropertyDescriptor | undefined) {
  if (descriptor) Object.defineProperty(globalThis, name, descriptor);
  else delete (globalThis as any)[name];
}

function installStorage() {
  const values = new Map<string, string>();
  const localStorage = {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => values.set(key, String(value)),
    removeItem: (key: string) => values.delete(key),
  } as Storage;
  Object.defineProperty(globalThis, "localStorage", { configurable: true, writable: true, value: localStorage });
  Object.defineProperty(globalThis, "window", { configurable: true, writable: true, value: { localStorage, dispatchEvent() {} } });
}

afterEach(() => {
  restoreGlobal("window", originalWindowDescriptor);
  restoreGlobal("localStorage", originalLocalStorageDescriptor);
});

describe("shared keyboard shortcut settings model", () => {
  test("reads, filters, saves and resets the same drafts for both skins", () => {
    installStorage();
    const initial = readKeyboardShortcutDrafts();
    expect(initial.openSettings).toBe("ctrl+,, meta+,, alt+,");
    expect(filterKeyboardShortcutActions("zen", initial).map((action) => action.id)).toEqual(["toggleZenMode"]);
    expect(filterKeyboardShortcutActions("ctrl+`", initial).map((action) => action.id)).toEqual(["toggleDock"]);

    const saved = saveKeyboardShortcutDraft("toggleDock", "ctrl+d, meta+d");
    expect(saved).toMatchObject({ ok: true });
    expect(readKeyboardShortcutDrafts().toggleDock).toBe("ctrl+d, meta+d");

    const invalid = saveKeyboardShortcutDraft("toggleDock", "ctrl+d, ctrl+escape");
    expect(invalid).toMatchObject({ ok: false, invalidToken: "ctrl+escape" });
    expect(readKeyboardShortcutDrafts().toggleDock).toBe("ctrl+d, meta+d");

    resetKeyboardShortcutDraft("toggleDock");
    expect(readKeyboardShortcutDrafts().toggleDock).toBe("ctrl+`");
    resetKeyboardShortcutBindings();
  });
});
