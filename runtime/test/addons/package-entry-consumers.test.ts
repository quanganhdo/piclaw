import { expect, test } from "bun:test";
import { mkdirSync, symlinkSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import { getInstalledAddonRuntimeEntries } from "../../src/addons/runtime-contributions.js";
import { getInstalledAddonExtensionPaths } from "../../src/agent-pool/session.js";
import { getInstalledAddonConfigEntryPaths } from "../../src/channels/web/handlers/addon-config-api.js";
import { getInstalledAddonWebEntries } from "../../src/channels/web/handlers/addons.js";
import { withTempWorkspaceEnv } from "../helpers.js";

function writePackage(packageDir: string, name: string, entries: unknown): void {
  mkdirSync(join(packageDir, "nested"), { recursive: true });
  writeFileSync(join(packageDir, "index.ts"), "export {};\n");
  writeFileSync(join(packageDir, "nested", "entry.ts"), "export {};\n");
  writeFileSync(join(packageDir, "package.json"), JSON.stringify({
    name,
    pi: {
      extensions: entries,
      web: { entries },
      runtime: { entries, load: "startup" },
    },
  }));
}

test("all installed add-on consumers share package entry containment", async () => {
  await withTempWorkspaceEnv("piclaw-addon-entry-consumers-", {}, async (workspace) => {
    const modulesDir = join(workspace.workspace, ".pi", "extensions", "node_modules");
    const plain = join(modulesDir, "piclaw-addon-plain");
    const scoped = join(modulesDir, "@example", "piclaw-addon-scoped");
    const linkedTarget = join(workspace.base, "linked-package-target");
    const linkedPackage = join(modulesDir, "piclaw-addon-linked");
    const outsideFile = join(workspace.base, "outside.ts");
    const entries = ["nested/entry.ts", "index.ts", "../outside.ts", "outside-link.ts", "missing.ts", 42];

    mkdirSync(modulesDir, { recursive: true });
    writeFileSync(outsideFile, "export {};\n");
    for (const [packageDir, name] of [[plain, "piclaw-addon-plain"], [scoped, "@example/piclaw-addon-scoped"], [linkedTarget, "piclaw-addon-linked"]] as const) {
      writePackage(packageDir, name, entries);
      symlinkSync(outsideFile, join(packageDir, "outside-link.ts"));
    }
    symlinkSync(linkedTarget, linkedPackage);

    const safePaths = [scoped, linkedPackage, plain]
      .sort()
      .flatMap((packageDir) => [join(packageDir, "nested", "entry.ts"), join(packageDir, "index.ts")]);

    expect(getInstalledAddonExtensionPaths(workspace.workspace)).toEqual(safePaths);
    expect(getInstalledAddonConfigEntryPaths(workspace.workspace)).toEqual(safePaths);
    expect(getInstalledAddonRuntimeEntries(workspace.workspace)).toEqual(safePaths
      .map((path) => ({
        packageName: path.startsWith(scoped)
          ? "@example/piclaw-addon-scoped"
          : path.startsWith(linkedPackage)
            ? "piclaw-addon-linked"
            : "piclaw-addon-plain",
        path,
        load: "startup" as const,
      }))
      .sort((left, right) => left.path.localeCompare(right.path)));
    expect(getInstalledAddonWebEntries(workspace.workspace)).toEqual([
      { packageName: "@example/piclaw-addon-scoped", entry: "nested/entry.ts", url: "/agent/addons/assets/%40example%2Fpiclaw-addon-scoped/nested/entry.ts" },
      { packageName: "@example/piclaw-addon-scoped", entry: "index.ts", url: "/agent/addons/assets/%40example%2Fpiclaw-addon-scoped/index.ts" },
      { packageName: "piclaw-addon-linked", entry: "nested/entry.ts", url: "/agent/addons/assets/piclaw-addon-linked/nested/entry.ts" },
      { packageName: "piclaw-addon-linked", entry: "index.ts", url: "/agent/addons/assets/piclaw-addon-linked/index.ts" },
      { packageName: "piclaw-addon-plain", entry: "nested/entry.ts", url: "/agent/addons/assets/piclaw-addon-plain/nested/entry.ts" },
      { packageName: "piclaw-addon-plain", entry: "index.ts", url: "/agent/addons/assets/piclaw-addon-plain/index.ts" },
    ]);
  });
});
