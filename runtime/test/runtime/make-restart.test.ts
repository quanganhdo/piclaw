import { expect, test } from "bun:test";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { prepareLocalInstallArchive } from "../../../scripts/prepare-local-install";

const PACKAGE_DIR = resolve(import.meta.dir, "../../..");
const MAKEFILE_PATH = resolve(PACKAGE_DIR, "Makefile");

test("make local-install ignores a portable runtime BUN_INSTALL and rejects portable release roots", () => {
  const makefile = readFileSync(MAKEFILE_PATH, "utf8");

  expect(makefile).toContain("HOST_BUN_ROOT := $(if $(wildcard /usr/local/lib/bun/bin/bun),/usr/local/lib/bun");
  expect(makefile).toContain("BUN_ROOT ?= $(HOST_BUN_ROOT)");
  expect(makefile).not.toContain("BUN_ROOT ?= $(or $(BUN_INSTALL)");
  expect(makefile).toContain("Refusing portable release Bun root");
  expect(makefile).toContain("/opt/piclaw/current/*|/opt/piclaw/releases/*");

  const make = Bun.spawnSync({
    cmd: ["make", "-s", "--eval", "print-bun-root:;@echo $(BUN_ROOT)", "print-bun-root"],
    cwd: PACKAGE_DIR,
    env: {
      ...process.env,
      BUN_INSTALL: "/opt/piclaw/current/bun",
      PATH: `/opt/piclaw/current/bun/bin:${process.env.PATH ?? ""}`,
    },
    stdout: "pipe",
    stderr: "pipe",
  });
  expect(make.exitCode, make.stderr.toString()).toBe(0);
  const expectedHostRoot = existsSync("/usr/local/lib/bun/bin/bun")
    ? "/usr/local/lib/bun"
    : dirname(dirname(process.execPath));
  expect(make.stdout.toString().trim()).toBe(expectedHostRoot);
  expect(make.stdout.toString().trim()).not.toStartWith("/opt/piclaw/");
});

test("make local-install applies packaged patches from the global install root", () => {
  const makefile = readFileSync(MAKEFILE_PATH, "utf8");

  expect(makefile).toContain('bun run scripts/prepare-local-install.ts \\\n\t\t"$$TGZ" "$$INSTALL_STAGE" "$$INSTALL_TGZ" "$$PATCH_STAGE" "$$GLOBAL_PACKAGE" "$(PI_AGENT_VERSION)";');
  expect(makefile).toContain('sudo cp -R "$$PATCH_STAGE"/. "$(GLOBAL_DIR)"/;');
  expect(makefile).toContain('sudo cp "$$GLOBAL_PACKAGE" "$(GLOBAL_PKG)";');
  expect(makefile).toContain('$(BUN_ROOT)/bin/bun install -g "$$INSTALL_TGZ"');
  expect(makefile).not.toContain("PI_AI_PATCH");
});

test("local-install preparation preserves every patch at the global root and removes nested metadata", async () => {
  const tempDir = mkdtempSync(join(tmpdir(), "piclaw-local-install-"));
  try {
    const sourceDir = join(tempDir, "source");
    const packageDir = join(sourceDir, "package");
    const patchRelativePath = "patches/@earendil-works%2Fpi-ai@0.84.2.patch";
    const secondPatchRelativePath = "patches/example-package@1.0.0.patch";
    const patchedDependencies = {
      "@earendil-works/pi-ai@0.84.2": patchRelativePath,
      "example-package@1.0.0": secondPatchRelativePath,
    };
    mkdirSync(join(packageDir, "patches"), { recursive: true });
    writeFileSync(
      join(packageDir, "package.json"),
      JSON.stringify({ name: "piclaw", version: "2.14.0", patchedDependencies }),
    );
    writeFileSync(join(packageDir, patchRelativePath), "pi-ai patch contents\n");
    writeFileSync(join(packageDir, secondPatchRelativePath), "example patch contents\n");

    const sourceArchive = join(tempDir, "source.tgz");
    const createArchive = Bun.spawnSync({
      cmd: ["tar", "-czf", sourceArchive, "-C", sourceDir, "package"],
      stdout: "pipe",
      stderr: "pipe",
    });
    expect(createArchive.exitCode, createArchive.stderr.toString()).toBe(0);

    const outputArchive = join(tempDir, "prepared.tgz");
    const stageDir = join(tempDir, "stage");
    const patchRoot = join(tempDir, "global-root");
    const globalPackagePath = join(tempDir, "global-package.json");
    await prepareLocalInstallArchive({
      sourceArchive,
      stageDir,
      outputArchive,
      patchRoot,
      globalPackagePath,
      piAgentVersion: "0.84.2",
    });

    const extractedDir = join(tempDir, "extracted");
    mkdirSync(extractedDir);
    const extractArchive = Bun.spawnSync({
      cmd: ["tar", "-xzf", outputArchive, "-C", extractedDir],
      stdout: "pipe",
      stderr: "pipe",
    });
    expect(extractArchive.exitCode, extractArchive.stderr.toString()).toBe(0);

    const preparedPackage = JSON.parse(readFileSync(join(extractedDir, "package", "package.json"), "utf8"));
    expect(preparedPackage.patchedDependencies).toBeUndefined();
    expect(readFileSync(join(patchRoot, patchRelativePath), "utf8")).toBe("pi-ai patch contents\n");
    expect(readFileSync(join(patchRoot, secondPatchRelativePath), "utf8")).toBe("example patch contents\n");

    const globalPackage = JSON.parse(readFileSync(globalPackagePath, "utf8"));
    expect(globalPackage.patchedDependencies).toEqual(patchedDependencies);
    expect(globalPackage.dependencies["@earendil-works/pi-ai"]).toBe("0.84.2");
    expect(globalPackage.dependencies.piclaw).toBe(outputArchive);
  } finally {
    rmSync(tempDir, { recursive: true, force: true });
  }
});

test("make restart is a no-op safety guard that points to exit_process", () => {
  const makefile = readFileSync(MAKEFILE_PATH, "utf8");

  expect(makefile).toContain('restart: ## No-op safety guard');
  expect(makefile).toContain('[restart] No-op by design.');
  expect(makefile).toContain('call exit_process as the last action');
  expect(makefile).not.toContain('systemctl --user restart piclaw.service;');
  expect(makefile).not.toContain('supervisorctl restart piclaw');
});
