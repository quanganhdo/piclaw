import { describe, expect, test } from "bun:test";
import { existsSync, lstatSync, mkdirSync, readFileSync, readdirSync, realpathSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { join } from "node:path";
import { createTempWorkspace } from "../helpers.js";
import { seedFreshWorkspaceCoreAddons } from "../../src/runtime/core-addon-defaults.js";

function bundledFixture(base: string) {
  const skel = join(base, "skel");
  const defaults = join(skel, ".piclaw/core-addons/defaults");
  const name = "@rcarmo/piclaw-addon-example";
  mkdirSync(join(defaults, "node_modules", name), { recursive: true });
  writeFileSync(join(defaults, "node_modules", name, "package.json"), JSON.stringify({ name, version: "1.0.0" }));
  writeFileSync(join(defaults, "package.json"), JSON.stringify({ name: "piclaw-local-addons", private: true, dependencies: { [name]: "https://example.invalid/example.tgz" } }));
  writeFileSync(join(defaults, "core-addons.lock.json"), JSON.stringify({ schemaVersion: 1, addons: [{ name, version: "1.0.0" }] }));
  return { skel, defaults, name };
}

describe("fresh workspace core add-ons", () => {
  test("seeds installed packages without a network or package manager and leaves an upgrade/removal alone", () => {
    const ws = createTempWorkspace("piclaw-core-defaults-");
    try {
      const { skel, name } = bundledFixture(ws.base);
      const dest = join(ws.workspace, ".pi/extensions");
      expect(seedFreshWorkspaceCoreAddons(ws.workspace, ws.store, skel)).toBe(true);
      expect(JSON.parse(readFileSync(join(dest, "node_modules", name, "package.json"), "utf8")).version).toBe("1.0.0");
      writeFileSync(join(dest, "node_modules", name, "package.json"), JSON.stringify({ name, version: "9.0.0" }));
      expect(seedFreshWorkspaceCoreAddons(ws.workspace, ws.store, skel)).toBe(false);
      expect(JSON.parse(readFileSync(join(dest, "node_modules", name, "package.json"), "utf8")).version).toBe("9.0.0");
      rmSync(join(dest, "node_modules", name), { recursive: true });
      expect(seedFreshWorkspaceCoreAddons(ws.workspace, ws.store, skel)).toBe(false);
      expect(existsSync(join(dest, "node_modules", name))).toBe(false);
    } finally { ws.cleanup(); }
  });

  test("seeded extensions resolve declared host peers without copying a second Pi package", async () => {
    const ws = createTempWorkspace("piclaw-core-peer-import-");
    try {
      const { skel, defaults, name } = bundledFixture(ws.base);
      const packageDir = join(defaults, "node_modules", name);
      writeFileSync(join(packageDir, "package.json"), JSON.stringify({ name, version: "1.0.0", type: "module", peerDependencies: { typebox: "*", "@sinclair/typebox": "*", "@earendil-works/pi-coding-agent": "*", "@earendil-works/pi-ai": "*", "@earendil-works/pi-tui": "*" } }));
      writeFileSync(join(packageDir, "index.ts"), 'import { Type } from "typebox"; import { ModelRuntime } from "@earendil-works/pi-coding-agent"; export const proof = { type: Type.String().type, runtime: typeof ModelRuntime.create };');
      expect(seedFreshWorkspaceCoreAddons(ws.workspace, ws.store, skel)).toBe(true);
      const target = join(ws.workspace, ".pi/extensions/node_modules");
      const child = Bun.spawn([process.execPath, "--no-env-file", join(import.meta.dir, "../fixtures/core-addon-seeded-import.ts"), join(target, name, "index.ts")], { stdout: "pipe", stderr: "pipe" });
      const [code, out, err] = await Promise.all([child.exited, new Response(child.stdout).text(), new Response(child.stderr).text()]);
      expect(code, err || out).toBe(0);
      expect(JSON.parse(out.trim())).toEqual({ type: "string", runtime: "function" });
      const require = createRequire(import.meta.url);
      for (const peer of ["typebox", "@sinclair/typebox", "@earendil-works/pi-coding-agent", "@earendil-works/pi-ai", "@earendil-works/pi-tui"]) {
        expect(realpathSync(join(target, peer, "package.json"))).toBe(realpathSync(require.resolve(`${peer}/package.json`)));
      }
      expect(seedFreshWorkspaceCoreAddons(ws.workspace, ws.store, skel)).toBe(false);
    } finally { ws.cleanup(); }
  }, 10000);

  test("does not modify existing workspaces, even when the add-on directory was removed", () => {
    const ws = createTempWorkspace("piclaw-core-existing-");
    try {
      const { skel } = bundledFixture(ws.base);
      writeFileSync(join(ws.store, "messages.db"), "existing");
      expect(seedFreshWorkspaceCoreAddons(ws.workspace, ws.store, skel)).toBe(false);
      expect(existsSync(join(ws.workspace, ".pi/extensions"))).toBe(false);
      rmSync(join(ws.store, "messages.db"));
      mkdirSync(join(ws.workspace, ".pi/extensions"), { recursive: true });
      expect(seedFreshWorkspaceCoreAddons(ws.workspace, ws.store, skel)).toBe(false);
    } finally { ws.cleanup(); }
  });

  test("leaves a dangling target symlink untouched", () => {
    const ws = createTempWorkspace("piclaw-core-dangling-");
    try {
      const { skel } = bundledFixture(ws.base);
      const dest = join(ws.workspace, ".pi/extensions");
      mkdirSync(join(ws.workspace, ".pi"));
      symlinkSync(join(ws.base, "missing-target"), dest, process.platform === "win32" ? "junction" : "dir");
      expect(seedFreshWorkspaceCoreAddons(ws.workspace, ws.store, skel)).toBe(false);
      expect(lstatSync(dest).isSymbolicLink()).toBe(true);
    } finally { ws.cleanup(); }
  });

  test("concurrent first seeds publish only one complete installation", async () => {
    const ws = createTempWorkspace("piclaw-core-concurrent-");
    try {
      const { skel, name } = bundledFixture(ws.base);
      const children = Array.from({ length: 4 }, () => Bun.spawn([process.execPath, "--no-env-file", join(import.meta.dir, "../fixtures/core-addon-seeded-import.ts"), "seed", ws.workspace, ws.store, skel], { stdout: "pipe", stderr: "pipe" }));
      const outcomes = await Promise.all(children.map(async child => {
        const [code, out, err] = await Promise.all([child.exited, new Response(child.stdout).text(), new Response(child.stderr).text()]);
        expect(code, err || out).toBe(0); return JSON.parse(out.trim()).seeded;
      }));
      expect(outcomes.filter(Boolean)).toHaveLength(1);
      expect(JSON.parse(readFileSync(join(ws.workspace, ".pi/extensions/node_modules", name, "package.json"), "utf8")).version).toBe("1.0.0");
    } finally { ws.cleanup(); }
  }, 10000);

  test("missing host peer fails without a partial target or staging directory", async () => {
    const ws = createTempWorkspace("piclaw-core-missing-peer-");
    try {
      const { skel, defaults, name } = bundledFixture(ws.base);
      writeFileSync(join(defaults, "node_modules", name, "package.json"), JSON.stringify({ name, version: "1.0.0", peerDependencies: { typebox: "*" } }));
      const child = Bun.spawn([process.execPath, "--no-env-file", join(import.meta.dir, "../fixtures/core-addon-seeded-import.ts"), "seed-missing-peer", ws.workspace, ws.store, skel], { stdout: "pipe", stderr: "pipe" });
      const [code, err] = await Promise.all([child.exited, new Response(child.stderr).text()]);
      expect(code).not.toBe(0); expect(err).toContain("typebox");
      expect(existsSync(join(ws.workspace, ".pi/extensions"))).toBe(false);
      expect(readdirSync(join(ws.workspace, ".pi")).filter(n => n.startsWith("extensions"))).toEqual([]);
    } finally { ws.cleanup(); }
  }, 10000);

  test("rejects an incomplete bundle without publishing a partial installation", () => {
    const ws = createTempWorkspace("piclaw-core-invalid-");
    try {
      const { skel, defaults, name } = bundledFixture(ws.base);
      rmSync(join(defaults, "node_modules", name), { recursive: true });
      expect(() => seedFreshWorkspaceCoreAddons(ws.workspace, ws.store, skel)).toThrow();
      expect(existsSync(join(ws.workspace, ".pi/extensions"))).toBe(false);
    } finally { ws.cleanup(); }
  });
});
