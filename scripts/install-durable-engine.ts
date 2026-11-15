#!/usr/bin/env bun
import { dirname, resolve } from "node:path";
import { assertDurableEngineDependencies } from "../runtime/src/runtime/durable-engine-dependencies.js";

/** Install the frozen SDK island without changing the Root legacy SDK graph. */
export function installDurableEngineDependencies(root = dirname(import.meta.dir)): void {
  const directory = resolve(root, "runtime/durable-engine");
  const result = Bun.spawnSync([process.execPath, "install", "--production", "--frozen-lockfile", "--ignore-scripts"], {
    cwd: directory, stdout: "inherit", stderr: "inherit",
  });
  if (result.exitCode !== 0) throw new Error(`Durable engine dependency installation failed (${result.exitCode})`);
  assertDurableEngineDependencies(directory);
}

if (import.meta.main) installDurableEngineDependencies(process.argv[2]);
