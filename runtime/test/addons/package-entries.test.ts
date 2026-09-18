import { describe, expect, test } from "bun:test";
import { mkdirSync, symlinkSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import {
  listInstalledAddonPackageDirs,
  readInstalledAddonPackage,
  resolveAddonPackageEntries,
} from "../../src/addons/package-entries.js";
import { withTempWorkspaceEnv } from "../helpers.js";

describe("installed add-on package entries", () => {
  test("lists unscoped, scoped, and symlinked package roots", async () => {
    await withTempWorkspaceEnv("piclaw-addon-packages-", {}, async (workspace) => {
      const modulesDir = join(workspace.workspace, ".pi", "extensions", "node_modules");
      const plain = join(modulesDir, "plain-addon");
      const scoped = join(modulesDir, "@example", "scoped-addon");
      const target = join(workspace.base, "linked-addon-target");
      mkdirSync(plain, { recursive: true });
      mkdirSync(scoped, { recursive: true });
      mkdirSync(target, { recursive: true });
      writeFileSync(join(plain, "package.json"), "{}");
      writeFileSync(join(scoped, "package.json"), "{}");
      writeFileSync(join(target, "package.json"), "{}");
      symlinkSync(target, join(modulesDir, "linked-addon"));

      expect(listInstalledAddonPackageDirs(modulesDir)).toEqual([
        scoped,
        join(modulesDir, "linked-addon"),
        plain,
      ].sort());
    });
  });

  test("reads object manifests and rejects missing or malformed manifests", async () => {
    await withTempWorkspaceEnv("piclaw-addon-manifests-", {}, async (workspace) => {
      const valid = join(workspace.base, "valid");
      const malformed = join(workspace.base, "malformed");
      const array = join(workspace.base, "array");
      mkdirSync(valid);
      mkdirSync(malformed);
      mkdirSync(array);
      writeFileSync(join(valid, "package.json"), JSON.stringify({ name: "valid", pi: { extensions: ["index.ts"] } }));
      writeFileSync(join(malformed, "package.json"), "{");
      writeFileSync(join(array, "package.json"), "[]");

      expect(readInstalledAddonPackage(valid)?.manifest.name).toBe("valid");
      expect(readInstalledAddonPackage(malformed)).toBeNull();
      expect(readInstalledAddonPackage(array)).toBeNull();
      expect(readInstalledAddonPackage(join(workspace.base, "missing"))).toBeNull();
    });
  });

  test("preserves valid declaration order and duplicates while rejecting unsafe entries", async () => {
    await withTempWorkspaceEnv("piclaw-addon-entry-policy-", {}, async (workspace) => {
      const packageDir = join(workspace.base, "package");
      const outsideFile = join(workspace.base, "outside.ts");
      mkdirSync(join(packageDir, "nested"), { recursive: true });
      mkdirSync(join(packageDir, "directory"), { recursive: true });
      writeFileSync(join(packageDir, "index.ts"), "export {};\n");
      writeFileSync(join(packageDir, "nested", "entry.ts"), "export {};\n");
      writeFileSync(outsideFile, "export {};\n");
      symlinkSync(join(packageDir, "nested", "entry.ts"), join(packageDir, "inside-link.ts"));
      symlinkSync(outsideFile, join(packageDir, "outside-link.ts"));

      expect(resolveAddonPackageEntries(packageDir, [
        " nested/entry.ts ",
        "index.ts",
        "index.ts",
        "inside-link.ts",
        "",
        42,
        "/absolute.ts",
        "../outside.ts",
        "outside-link.ts",
        "missing.ts",
        "directory",
      ])).toEqual([
        join(packageDir, "nested", "entry.ts"),
        join(packageDir, "index.ts"),
        join(packageDir, "index.ts"),
        join(packageDir, "inside-link.ts"),
      ]);
      expect(resolveAddonPackageEntries(packageDir, "index.ts")).toEqual([]);
    });
  });
});
