/**
 * test/scripts/beautiful-mermaid-vendor.test.ts – Smoke tests for the
 * checked-in beautiful-mermaid vendor build path.
 */

import { expect, test } from "bun:test";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const repoRoot = join(import.meta.dir, "../../..");
const runtimeRoot = join(repoRoot, "runtime");

function buildVendorScript(scriptPath: string, outFile: string, metaFile: string, extraArgs: string[] = []) {
  return Bun.spawnSync(
    [
      "bun",
      scriptPath,
      ...extraArgs,
      "--outfile",
      outFile,
      "--meta-out",
      metaFile,
    ],
    {
      cwd: runtimeRoot,
      stdout: "pipe",
      stderr: "pipe",
    },
  );
}

function expectDeterministicVendorOutput(outFile: string, metaFile: string) {
  expect(existsSync(outFile)).toBe(true);
  expect(existsSync(metaFile)).toBe(true);

  const bundle = readFileSync(outFile);
  const meta = JSON.parse(readFileSync(metaFile, "utf8")) as {
    manifest_id: string;
    package_name: string;
    package_version: string;
    output_file: string;
    source_entry: string;
    sha256: string;
    size_bytes: number;
  };

  const installed = JSON.parse(
    readFileSync(join(repoRoot, "node_modules/beautiful-mermaid/package.json"), "utf8"),
  ) as { version: string };

  expect(meta.manifest_id).toBe("beautiful-mermaid");
  expect(meta.package_name).toBe("beautiful-mermaid");
  expect(meta.package_version).toBe(installed.version);
  expect(meta.source_entry).toBe("web/src/vendor/mermaid-entry.ts");
  expect(meta.output_file.endsWith("beautiful-mermaid.js")).toBe(true);
  expect(meta.size_bytes).toBe(bundle.byteLength);
  expect(meta.sha256).toBe(createHash("sha256").update(bundle).digest("hex"));
  expect(bundle.toString("utf8")).toContain("globalThis.beautifulMermaid");
  expect(bundle.toString("utf8")).not.toMatch(/[ \t]+$/m);
}

test("generic vendored dependency build script writes mermaid bundle + metadata deterministically", () => {
  const base = join(tmpdir(), `piclaw-mermaid-vendor-${Date.now()}`);
  const outFile = join(base, "beautiful-mermaid.js");
  const metaFile = join(base, "beautiful-mermaid.meta.json");
  mkdirSync(base, { recursive: true });

  const proc = buildVendorScript(
    join(runtimeRoot, "scripts/build-vendored-dependency.ts"),
    outFile,
    metaFile,
    ["--manifest", "vendor-manifests/beautiful-mermaid.json"],
  );

  if (proc.exitCode !== 0) {
    throw new Error(`${proc.stdout.toString()}\n${proc.stderr.toString()}`.trim());
  }

  expectDeterministicVendorOutput(outFile, metaFile);
  rmSync(base, { recursive: true, force: true });
});

test("legacy mermaid build wrapper delegates to the manifest-driven workflow", () => {
  const base = join(tmpdir(), `piclaw-mermaid-wrapper-${Date.now()}`);
  const outFile = join(base, "beautiful-mermaid.js");
  const metaFile = join(base, "beautiful-mermaid.meta.json");
  mkdirSync(base, { recursive: true });

  const proc = buildVendorScript(
    join(runtimeRoot, "scripts/build-beautiful-mermaid-vendor.ts"),
    outFile,
    metaFile,
  );

  if (proc.exitCode !== 0) {
    throw new Error(`${proc.stdout.toString()}\n${proc.stderr.toString()}`.trim());
  }

  expectDeterministicVendorOutput(outFile, metaFile);
  rmSync(base, { recursive: true, force: true });
});
