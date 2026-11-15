import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { DURABLE_ENGINE_SDK_PACKAGES } from "../../src/runtime/durable-engine-dependencies.js";

const root = resolve(import.meta.dir, "../../..");
const text = (path: string) => readFileSync(resolve(root, path), "utf8");

test("packages carry the native source, frozen island and installer without promoting the host SDK", () => {
  const pkg = JSON.parse(text("package.json"));
  for (const path of ["scripts/install-durable-engine.ts", "runtime/durable-engine/src", "runtime/durable-engine/package.json", "runtime/durable-engine/bun.lock"])
    expect(pkg.files).toContain(path);
  expect(pkg.dependencies["@earendil-works/pi-coding-agent"]).toBe("1.2.0");
  expect(pkg.dependencies["@earendil-works/pi-mcp"]).toBe("1.2.0");
  const engine = JSON.parse(text("runtime/durable-engine/package.json"));
  expect(Object.keys(engine.dependencies).sort()).toEqual(DURABLE_ENGINE_SDK_PACKAGES.map(name => `@earendil-works/${name}`).sort());
  expect(Object.values(engine.dependencies).every(version => version === "1.3.0")).toBe(true);
});

test("normal, scripts-disabled Docker and portable installs run the native installer", () => {
  const installer = text("scripts/install-durable-engine.ts");
  expect(installer).toContain('"--production", "--frozen-lockfile", "--ignore-scripts"');
  expect(installer).toContain("assertDurableEngineDependencies(directory)");
  expect(text("scripts/postinstall.ts")).toContain("installDurableEngineDependencies(ROOT)");
  expect(text("scripts/docker/build-piclaw-package.sh")).toContain('"$DEST_REAL/scripts/postinstall.ts"');
  expect(text("scripts/release/build-portable-artifact.ts")).toContain('["run", "scripts/postinstall.ts"], { cwd: appDir, env: installEnv }');
  const bootstrap = text("runtime/src/runtime/bootstrap.ts");
  expect(bootstrap.indexOf("assertDurableEngineDependencies();")).toBeLessThan(bootstrap.indexOf("await import(MODULE_PATH)"));
});
