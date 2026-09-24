import { afterEach, describe, expect, test } from "bun:test";
import {
  cpSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  renameSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import {
  CODING_AGENT_PACKAGE,
  FAMILY_PACKAGES,
  assertProbeRuntime,
  assertSourceOnlyRejection,
  probeProgram,
  inspectInstalledConsumer,
  parseAdmissionArgs,
} from "../../../scripts/check-earendil-package-admission.ts";

const VERSION = "0.87.1";
const GIT_HEAD = "0123456789abcdef0123456789abcdef01234567";
const fixtureRoot = resolve(import.meta.dir, "../fixtures/earendil-package-admission/valid-consumer");
const scratchRoots: string[] = [];

afterEach(() => {
  for (const root of scratchRoots.splice(0)) rmSync(root, { recursive: true, force: true });
});

function materializeConsumer(): string {
  const scratch = mkdtempSync(join(tmpdir(), "earendil-admission-test-"));
  scratchRoots.push(scratch);
  const consumerRoot = join(scratch, "consumer");
  cpSync(fixtureRoot, consumerRoot, { recursive: true });
  renameSync(join(consumerRoot, "installed-packages"), join(consumerRoot, "node_modules"));
  return consumerRoot;
}

function manifestPath(consumerRoot: string, packageName: string): string {
  return join(consumerRoot, "node_modules", ...packageName.split("/"), "package.json");
}

function updateJson(path: string, update: (value: Record<string, any>) => void): void {
  const value = JSON.parse(readFileSync(path, "utf8")) as Record<string, any>;
  update(value);
  writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`);
}

describe("Earendil package admission checker", () => {
  test("rejects Bun posing as Node and checks the requested runtime family", () => {
    const node = { execPath: "/node", release: "node", version: "v22.19.0", node: "22.19.0" };
    const bun = { ...node, execPath: "/bun", bun: "1.4.1" };
    expect(() => assertProbeRuntime("node", node)).not.toThrow();
    expect(() => assertProbeRuntime("bun", bun)).not.toThrow();
    expect(() => assertProbeRuntime("node", bun)).toThrow("real Node");
    expect(() => assertProbeRuntime("bun", node)).toThrow("requires Bun");
  });

  test("source-only rejection requires export resolution rather than a module evaluation failure", () => {
    for (const kind of ["node", "bun"] as const) {
      const receipt = { specifier: `${CODING_AGENT_PACKAGE}/client`, status: "rejected" as const, phase: "resolution" as const,
        error: { name: "Error", code: kind === "node" ? "ERR_PACKAGE_PATH_NOT_EXPORTED" : "ERR_MODULE_NOT_FOUND", message: "excluded" } };
      expect(() => assertSourceOnlyRejection(kind, receipt)).not.toThrow();
      expect(() => assertSourceOnlyRejection(kind, { ...receipt, phase: undefined })).toThrow("export resolution");
      expect(() => assertSourceOnlyRejection(kind, { ...receipt, error: { ...receipt.error, code: "SyntaxError" } })).toThrow("export resolution");
    }
    const consumerRoot = materializeConsumer();
    const code = probeProgram();
    const excluded = Bun.spawnSync([process.execPath, "--eval", code], { cwd: consumerRoot, stdout: "pipe", stderr: "pipe" });
    expect(excluded.exitCode).toBe(0);
    const parse = (stdout: Buffer) => JSON.parse(stdout.toString().trim().split("\n").at(-1)!.slice("EAR_ENDIL_PACKAGE_ADMISSION=".length));
    const denied = parse(excluded.stdout);
    expect(denied.sourceOnlyDeepPaths.every((entry: { phase: string }) => entry.phase === "resolution")).toBe(true);
    updateJson(manifestPath(consumerRoot, CODING_AGENT_PACKAGE), (manifest) => {
      manifest.exports["./client"] = { import: "./src/client/index.ts" };
    });
    writeFileSync(join(consumerRoot, "node_modules", ...CODING_AGENT_PACKAGE.split("/"), "src/client/index.ts"), 'throw new Error("evaluation-must-not-run");');
    const exposed = Bun.spawnSync([process.execPath, "--eval", code], { cwd: consumerRoot, stdout: "pipe", stderr: "pipe" });
    expect(exposed.exitCode).toBe(0);
    expect(parse(exposed.stdout).sourceOnlyDeepPaths[0].status).toBe("resolved");
    expect(exposed.stderr.toString()).not.toContain("evaluation-must-not-run");
  });

  test("parses exact release metadata and caller-provided runtime paths", () => {
    expect(parseAdmissionArgs([
      "--consumer-root", "./consumer",
      `--version=${VERSION}`,
      "--git-head", GIT_HEAD,
      "--node=/opt/node-22/bin/node",
      "--node", "/opt/node-24/bin/node",
      "--bun", "/opt/bun/bin/bun",
    ])).toEqual({
      consumerRoot: resolve("./consumer"),
      version: VERSION,
      gitHead: GIT_HEAD,
      nodePaths: ["/opt/node-22/bin/node", "/opt/node-24/bin/node"],
      bunPath: "/opt/bun/bin/bun",
    });

    expect(() => parseAdmissionArgs([
      "--consumer-root", "./consumer",
      "--version", "^0.87.1",
      "--git-head", GIT_HEAD,
      "--node", "/opt/node/bin/node",
      "--bun", "/opt/bun/bin/bun",
    ])).toThrow("--version must be an exact semantic version");
    expect(() => parseAdmissionArgs([
      "--consumer-root", "./consumer",
      "--version", VERSION,
      "--git-head", "ABC",
      "--node", "/opt/node/bin/node",
      "--bun", "/opt/bun/bin/bun",
    ])).toThrow("exact lowercase 40-character commit SHA");
  });

  test("admits a coherent installed family without pi-server", () => {
    const consumerRoot = materializeConsumer();
    updateJson(manifestPath(consumerRoot, "@earendil-works/pi-ai"), (manifest) => {
      manifest.gitHead = GIT_HEAD;
    });

    const receipt = inspectInstalledConsumer({ consumerRoot, version: VERSION, gitHead: GIT_HEAD });

    expect(receipt.directDependency).toEqual({ name: CODING_AGENT_PACKAGE, specifier: VERSION });
    expect(receipt.packages.map(({ name, version }) => ({ name, version }))).toEqual(
      FAMILY_PACKAGES.map((name) => ({ name, version: VERSION })),
    );
    expect(receipt.gitHeadMetadata.installedPackageJsonValues).toEqual([
      { name: "@earendil-works/pi-ai", gitHead: GIT_HEAD },
    ]);
    expect(receipt.codingAgentExports.root.targets.every((target) => target.exists)).toBeTrue();
  });

  test("treats published source targets as source-conditioned, not missing files", () => {
    const receipt = inspectInstalledConsumer({
      consumerRoot: materializeConsumer(),
      version: VERSION,
      gitHead: GIT_HEAD,
    });

    expect(receipt.codingAgentExports.sourceOnly).toHaveLength(2);
    for (const entry of receipt.codingAgentExports.sourceOnly) {
      expect(entry.admitted).toBeFalse();
      expect(entry.targets).toHaveLength(1);
      expect(entry.targets[0]?.conditions).toContain("source");
      expect(entry.targets[0]?.exists).toBeTrue();
    }
  });

  test("rejects a deep export with any non-source-conditioned target", () => {
    const consumerRoot = materializeConsumer();
    updateJson(manifestPath(consumerRoot, CODING_AGENT_PACKAGE), (manifest) => {
      manifest.exports["./client"] = {
        source: "./src/client/index.ts",
        import: "./dist/index.js",
      };
    });

    expect(() => inspectInstalledConsumer({ consumerRoot, version: VERSION, gitHead: GIT_HEAD }))
      .toThrow(`${CODING_AGENT_PACKAGE} ./client is runtime-admitted by condition import`);
  });

  test("rejects direct dependency drift and family metadata drift", () => {
    const extraDependencyRoot = materializeConsumer();
    updateJson(join(extraDependencyRoot, "package.json"), (manifest) => {
      manifest.devDependencies = { typescript: "7.0.2" };
    });
    expect(() => inspectInstalledConsumer({ consumerRoot: extraDependencyRoot, version: VERSION, gitHead: GIT_HEAD }))
      .toThrow("consumer devDependencies must be empty");

    const versionDriftRoot = materializeConsumer();
    updateJson(manifestPath(versionDriftRoot, "@earendil-works/pi-tui"), (manifest) => {
      manifest.version = "0.85.0";
    });
    expect(() => inspectInstalledConsumer({ consumerRoot: versionDriftRoot, version: VERSION, gitHead: GIT_HEAD }))
      .toThrow("family version drift: @earendil-works/pi-tui");

    const headDriftRoot = materializeConsumer();
    updateJson(manifestPath(headDriftRoot, "@earendil-works/chord"), (manifest) => {
      manifest.gitHead = "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
    });
    expect(() => inspectInstalledConsumer({ consumerRoot: headDriftRoot, version: VERSION, gitHead: GIT_HEAD }))
      .toThrow("family gitHead drift: @earendil-works/chord");
  });

  test("rejects stale nested family packages and aliased pi-server packages", () => {
    const root = materializeConsumer();
    const nested = join(root, "node_modules", "some-package", "node_modules", "@earendil-works", "pi-ai");
    mkdirSync(nested, { recursive: true });
    writeFileSync(join(nested, "package.json"), JSON.stringify({ name: "@earendil-works/pi-ai", version: "0.84.4" }));
    expect(() => inspectInstalledConsumer({ consumerRoot: root, version: VERSION, gitHead: GIT_HEAD })).toThrow("nested family version drift");
    rmSync(nested, { recursive: true });
    const alias = join(root, "node_modules", "server-alias");
    mkdirSync(alias, { recursive: true });
    writeFileSync(join(alias, "package.json"), JSON.stringify({ name: "@earendil-works/pi-server", version: VERSION }));
    expect(() => inspectInstalledConsumer({ consumerRoot: root, version: VERSION, gitHead: GIT_HEAD })).toThrow("pi-server must not be installed");
  });

  test("rejects pi-server anywhere in the installed dependency tree", () => {
    const consumerRoot = materializeConsumer();
    const server = join(
      consumerRoot,
      "node_modules",
      "transitive-package",
      "node_modules",
      "@earendil-works",
      "pi-server",
    );
    mkdirSync(server, { recursive: true });
    writeFileSync(join(server, "package.json"), "{}\n");

    expect(() => inspectInstalledConsumer({ consumerRoot, version: VERSION, gitHead: GIT_HEAD }))
      .toThrow("@earendil-works/pi-server must not be installed");
  });
});
