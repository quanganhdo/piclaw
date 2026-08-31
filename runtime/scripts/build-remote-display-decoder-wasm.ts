#!/usr/bin/env bun

import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, relative, resolve } from "node:path";

const PROJECT_DIR = process.cwd();
const SOURCE_FILE = resolve(PROJECT_DIR, "assemblyscript/remote-display-decoder.ts");
const OUTPUT_FILE = resolve(PROJECT_DIR, "web/static/common/js/vendor/remote-display-decoder.wasm");
const METADATA_FILE = resolve(PROJECT_DIR, "web/static/common/js/vendor/remote-display-decoder.meta.json");
const ASC_BIN_CANDIDATES = [
  resolve(PROJECT_DIR, "../node_modules/.bin/asc"),
  resolve(PROJECT_DIR, "../node_modules/.bin/asc.cmd"),
  resolve(PROJECT_DIR, "../node_modules/.bin/asc.ps1"),
];
const ASC_JS = resolve(PROJECT_DIR, "../node_modules/assemblyscript/bin/asc.js");
const LOG_PREFIX = "[vendor:remote-display-decoder]";

function sha256ForFile(path: string): string {
  return createHash("sha256").update(readFileSync(path)).digest("hex");
}

export function resolveAscCommand(): string[] {
  // Invoke the JavaScript entry through Bun so builds do not depend on archive
  // extraction preserving executable mode on the .bin symlink target.
  if (existsSync(ASC_JS)) return [process.execPath, ASC_JS];
  const found = ASC_BIN_CANDIDATES.find((candidate) => existsSync(candidate));
  if (found) return [found];
  throw new Error(`${LOG_PREFIX} Missing asc compiler at ${[ASC_JS, ...ASC_BIN_CANDIDATES].join(" or ")}. Run bun install first.`);
}

function main(): void {
  const ascCommand = resolveAscCommand();
  mkdirSync(dirname(OUTPUT_FILE), { recursive: true });

  const proc = Bun.spawnSync([
    ...ascCommand,
    SOURCE_FILE,
    "--target", "release",
    "--runtime", "incremental",
    "--exportRuntime",
    "--optimizeLevel", "3",
    "--shrinkLevel", "0",
    "--noAssert",
    "--stackSize", "65536",
    "--outFile", OUTPUT_FILE,
  ], {
    cwd: PROJECT_DIR,
    stdout: "inherit",
    stderr: "inherit",
  });

  if (proc.exitCode !== 0) {
    throw new Error(`${LOG_PREFIX} asc failed with exit code ${proc.exitCode}`);
  }

  const size = readFileSync(OUTPUT_FILE).byteLength;
  const sha256 = sha256ForFile(OUTPUT_FILE);
  const metadata = {
    manifest_id: "remote-display-decoder",
    source_file: relative(PROJECT_DIR, SOURCE_FILE),
    output_file: relative(PROJECT_DIR, OUTPUT_FILE),
    metadata_file: relative(PROJECT_DIR, METADATA_FILE),
    sha256,
    size_bytes: size,
    toolchain: "assemblyscript",
  };
  writeFileSync(METADATA_FILE, `${JSON.stringify(metadata, null, 2)}\n`, "utf8");
  process.stdout.write(
    `${LOG_PREFIX} built ${relative(PROJECT_DIR, OUTPUT_FILE)} (${(size / 1024).toFixed(1)} KB)\n` +
    `${LOG_PREFIX} sha256 ${sha256}\n`
  );
}

try {
  main();
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
}
