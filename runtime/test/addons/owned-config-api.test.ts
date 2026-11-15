import { afterEach, expect, test } from "bun:test";
import { registerAddonConfigApi, registerOwnedAddonConfigApi, resetAddonConfigApiRegistryForTests } from "../../src/channels/web/handlers/addon-config-api.js";

afterEach(resetAddonConfigApiRegistryForTests);

test("owned configuration binding verifies identity and disposes idempotently", () => {
  const binding = registerOwnedAddonConfigApi("dashboard", "recent", { get: () => ({ ok: true }) }, "fixture.ts");
  expect(() => binding.assertCurrent()).not.toThrow();
  binding.dispose(); binding.dispose();
  expect(() => binding.assertCurrent()).toThrow("Stale addon configuration binding");
});

test("stale owner cleanup cannot remove a newer registration", () => {
  const old = registerOwnedAddonConfigApi("dashboard", "recent", { get: () => "old" }, "old.ts");
  const current = registerOwnedAddonConfigApi("dashboard", "recent", { get: () => "new" }, "new.ts");
  expect(() => old.assertCurrent()).toThrow("Stale addon configuration binding");
  old.dispose();
  expect(() => current.assertCurrent()).not.toThrow();
  registerAddonConfigApi("dashboard", "recent", { get: () => "replacement" }, "replacement.ts");
  expect(() => current.assertCurrent()).toThrow("Stale addon configuration binding");
  current.dispose();
});
