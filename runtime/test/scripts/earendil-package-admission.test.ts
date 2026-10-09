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
  LEGACY_FAMILY_PACKAGES,
  MCP_OAUTH_EXPORTS,
  MCP_ROOT_EXPORTS,
  MODERN_CODING_AGENT_EXPORTS,
  MODERN_PRIVATE_IMPORTS,
  REMOVED_100_IMPORTS,
  assertPrivateImportRejection,
  assertProbeRuntime,
  assertSourceOnlyRejection,
  inspectInstalledConsumer,
  parseAdmissionArgs,
  packagePayloadDigest,
  runEarendilPackageAdmission,
  runRawRuntimeProbeForTests,
  validateRegistryReceipt,
  validateProviderAuthReceipt,
} from "../../../scripts/check-earendil-package-admission.ts";

const VERSION = "0.87.1";
const GIT_HEAD = "0123456789abcdef0123456789abcdef01234567";
const MODERN_VERSION = "0.99.1";
const MODERN_GIT_HEAD = "d86654abb8862e201933517d6f1fce9f88dd117f";
const fixturesRoot = resolve(import.meta.dir, "../fixtures/earendil-package-admission");
const fixtureRoot = join(fixturesRoot, "valid-consumer");
const modernFixtureRoot = join(fixturesRoot, "valid-consumer-0.99.1");
const registryFixture = join(fixturesRoot, "registry-0.99.1.json");
const providerFixture = join(fixturesRoot, "provider-auth-0.99.1.json");
const CURRENT_VERSION = "1.0.4";
const CURRENT_GIT_HEAD = "7c10bd4337495ee613f2224843ecdf349b80d1df";
const currentReceiptRoot = resolve(import.meta.dir, "../../../docs/design/earendil-agent-harness-integration-adr/evidence/receipts");
const currentRegistryReceipt = join(currentReceiptRoot, "earendil-104-registry.json");
const currentProviderReceipt = join(currentReceiptRoot, "earendil-104-provider-auth.json");
const scratchRoots: string[] = [];

afterEach(() => {
  for (const root of scratchRoots.splice(0)) rmSync(root, { recursive: true, force: true });
});

function materializeConsumer(source = fixtureRoot): string {
  const scratch = mkdtempSync(join(tmpdir(), "earendil-admission-test-"));
  scratchRoots.push(scratch);
  const consumerRoot = join(scratch, "consumer");
  cpSync(source, consumerRoot, { recursive: true });
  renameSync(join(consumerRoot, "installed-packages"), join(consumerRoot, "node_modules"));
  return consumerRoot;
}

function materializeRegistry(update?: (value: Array<Record<string, any>>) => void, source = registryFixture): string {
  const scratch = mkdtempSync(join(tmpdir(), "earendil-registry-test-"));
  scratchRoots.push(scratch);
  const path = join(scratch, "registry.json");
  const value = JSON.parse(readFileSync(source, "utf8")) as Array<Record<string, any>>;
  update?.(value);
  writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`);
  return path;
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
  test("package payload hashes ignore only installed root dependency layout", () => {
    const scratch = mkdtempSync(join(tmpdir(), "earendil-payload-layout-"));
    scratchRoots.push(scratch);
    const published = join(scratch, "published"), installed = join(scratch, "installed");
    for (const root of [published, installed]) {
      mkdirSync(join(root, "dist/node_modules"), { recursive: true });
      writeFileSync(join(root, "package.json"), '{"name":"payload-fixture","version":"1.0.1"}\n');
      writeFileSync(join(root, "dist/index.js"), "export const value = 1;\n");
      writeFileSync(join(root, "dist/node_modules/bundled.js"), "export const bundled = 1;\n");
    }
    const dependency = join(installed, "node_modules/marked");
    mkdirSync(dependency, { recursive: true });
    writeFileSync(join(dependency, "package.json"), '{"name":"marked","version":"17.0.5"}\n');
    expect(packagePayloadDigest(installed)).toBe(packagePayloadDigest(published));
    writeFileSync(join(dependency, "package.json"), '{"name":"marked","version":"18.0.0"}\n');
    expect(packagePayloadDigest(installed)).toBe(packagePayloadDigest(published));
    writeFileSync(join(installed, "dist/index.js"), "export const value = 2;\n");
    expect(packagePayloadDigest(installed)).not.toBe(packagePayloadDigest(published));
    writeFileSync(join(installed, "dist/index.js"), "export const value = 1;\n");
    writeFileSync(join(installed, "dist/node_modules/bundled.js"), "export const bundled = 2;\n");
    expect(packagePayloadDigest(installed)).not.toBe(packagePayloadDigest(published));
  });

  test("checks 1.0.0 public removal by resolution and rejects an installed durable alias", () => {
    const consumerRoot = materializeConsumer(modernFixtureRoot);
    const version = "1.0.0", gitHead = "a13d35a742c6ef8462812a28fbe1d8c8b7431c32";
    updateJson(join(consumerRoot, "package.json"), manifest => { manifest.dependencies[CODING_AGENT_PACKAGE] = version; });
    for (const name of FAMILY_PACKAGES) updateJson(manifestPath(consumerRoot, name), manifest => { manifest.version = version; });
    const coreManifest = manifestPath(consumerRoot, "@earendil-works/pi-agent-core");
    const coreRoot = resolve(coreManifest, "..");
    mkdirSync(join(coreRoot, "dist"), { recursive: true });
    writeFileSync(join(coreRoot, "dist/index.js"), "export class Agent {}\n");
    updateJson(coreManifest, manifest => { manifest.exports = { ".": { import: "./dist/index.js" } }; });
    const options = { consumerRoot, version, gitHead, registryReceiptPath: join(fixturesRoot, "registry-1.0.0.json"), providerReceiptPath: join(fixturesRoot, "provider-auth-1.0.0.json") };
    expect(inspectInstalledConsumer(options).packages).toHaveLength(8);
    const receipt = runRawRuntimeProbeForTests("bun", process.execPath, consumerRoot, version);
    expect(receipt.removedImports?.map(row => row.specifier)).toEqual([...REMOVED_100_IMPORTS]);
    for (const entry of receipt.removedImports!) expect(() => assertPrivateImportRejection("bun", entry)).not.toThrow();
    expect(Object.values(receipt.removedCoreExports!)).toEqual(Array(6).fill("undefined"));
    updateJson(coreManifest, manifest => { manifest.exports["./node"] = { import: "./dist/index.js" }; });
    const exposed = runRawRuntimeProbeForTests("bun", process.execPath, consumerRoot, version);
    expect(() => assertPrivateImportRejection("bun", exposed.removedImports![0]!)).toThrow("export resolution");
    const alias = join(consumerRoot, "node_modules/durable-alias");
    mkdirSync(alias);
    writeFileSync(join(alias, "package.json"), JSON.stringify({ name: "@earendil-works/pi-durable", version }));
    expect(() => inspectInstalledConsumer(options)).toThrow("outside current-loop admission");
  });

  test("validates 1.0.0 receipts separately and rejects drift without admitting durable", () => {
    const version = "1.0.0", gitHead = "a13d35a742c6ef8462812a28fbe1d8c8b7431c32";
    const registry = join(fixturesRoot, "registry-1.0.0.json");
    const providers = join(fixturesRoot, "provider-auth-1.0.0.json");
    const receipt = validateRegistryReceipt(registry, version, gitHead);
    expect(receipt.packages).toHaveLength(8);
    expect(receipt.packages.every(row => row.version === version && row.gitHead === gitHead)).toBeTrue();
    expect(receipt.packages.some(row => String(row.name).includes("pi-durable"))).toBeFalse();
    expect(validateProviderAuthReceipt(providers, version, gitHead).providers).toHaveLength(42);
    expect(() => validateRegistryReceipt(registryFixture, version, gitHead)).toThrow("version mismatch");
    expect(() => validateProviderAuthReceipt(providerFixture, version, gitHead)).toThrow("hash differs");
    for (const [field, bad] of [["shasum", "a".repeat(40)], ["integrity", "sha512-bad"], ["tarball", "https://example.invalid/archive"]]) {
      const changed = materializeRegistry(rows => { rows[0]!.dist[field!] = bad; }, registry);
      expect(() => validateRegistryReceipt(changed, version, gitHead)).toThrow(`${field} mismatch`);
    }
    expect(() => validateRegistryReceipt(materializeRegistry(rows => rows.pop(), registry), version, gitHead)).toThrow("missing packages");
    expect(() => validateRegistryReceipt(materializeRegistry(rows => rows.push(rows[0]!), registry), version, gitHead)).toThrow("duplicate package");
    expect(() => validateRegistryReceipt(materializeRegistry(rows => { rows[0]!.name = "@earendil-works/pi-durable"; }, registry), version, gitHead)).toThrow("extra package");
  });

  test("validates exact 1.0.4 registry and provider receipts and rejects provenance drift", () => {
    const receipt = validateRegistryReceipt(currentRegistryReceipt, CURRENT_VERSION, CURRENT_GIT_HEAD);
    expect(receipt.packages).toHaveLength(8);
    expect(receipt.packages.every(row => row.version === CURRENT_VERSION && row.gitHead === CURRENT_GIT_HEAD)).toBeTrue();
    expect(validateProviderAuthReceipt(currentProviderReceipt, CURRENT_VERSION, CURRENT_GIT_HEAD).providers).toHaveLength(42);

    const mismatches: Array<[string, string, string]> = [
      ["version", "1.0.0", "version mismatch"],
      ["gitHead", "a".repeat(40), "gitHead mismatch"],
      ["shasum", "a".repeat(40), "shasum mismatch"],
      ["integrity", "sha512-bad", "integrity mismatch"],
      ["tarball", "https://example.invalid/archive.tgz", "tarball mismatch"],
    ];
    for (const [field, bad, message] of mismatches) {
      const changed = materializeRegistry(rows => {
        if (field === "version" || field === "gitHead") rows[0]![field] = bad;
        else rows[0]!.dist[field] = bad;
      }, currentRegistryReceipt);
      expect(() => validateRegistryReceipt(changed, CURRENT_VERSION, CURRENT_GIT_HEAD)).toThrow(message);
    }
    expect(() => validateRegistryReceipt(currentRegistryReceipt, CURRENT_VERSION, "b".repeat(40)))
      .toThrow(`requires gitHead ${CURRENT_GIT_HEAD}`);
    expect(() => validateRegistryReceipt(currentRegistryReceipt, "1.0.5", CURRENT_GIT_HEAD))
      .toThrow("modern package admission supports exact");

    const scratch = mkdtempSync(join(tmpdir(), "provider-101-receipt-"));
    scratchRoots.push(scratch);
    const changedProvider = join(scratch, "provider.json");
    writeFileSync(changedProvider, readFileSync(currentProviderReceipt, "utf8") + " ");
    expect(() => validateProviderAuthReceipt(changedProvider, CURRENT_VERSION, CURRENT_GIT_HEAD))
      .toThrow("provider auth receipt hash differs from exact 1.0.4 receipt");
  });

  test("admits the synthetic Bun consumer with no Node runtime configured", () => {
    const consumerRoot = materializeConsumer();
    const receipt = runEarendilPackageAdmission({ consumerRoot, version: VERSION, gitHead: GIT_HEAD, bunPath: process.execPath });
    expect(receipt.runtimes.map(row => row.requestedRuntime)).toEqual(["bun"]);
    expect(receipt.admitted).toBeTrue();
    const agent = join(consumerRoot, "node_modules", ...CODING_AGENT_PACKAGE.split("/"), "dist/index.js");
    writeFileSync(agent, `try { Bun.spawnSync(["true"]); } catch {}\n${readFileSync(agent, "utf8")}`);
    expect(() => runEarendilPackageAdmission({ consumerRoot, version: VERSION, gitHead: GIT_HEAD, bunPath: process.execPath }))
      .toThrow("zero network/child-process attempts");
  });

  test("rejects Node execution before resolving or launching any executable", () => {
    expect(() => parseAdmissionArgs(["--node", "/does/not/exist"])).toThrow("unknown argument");
    expect(() => runRawRuntimeProbeForTests("node", "/does/not/exist", materializeConsumer(), VERSION))
      .toThrow("Bun-only");
  });

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
    const denied = runRawRuntimeProbeForTests("bun", process.execPath, consumerRoot, VERSION);
    expect(denied.sourceOnlyDeepPaths.every((entry: { phase: string }) => entry.phase === "resolution")).toBe(true);
    updateJson(manifestPath(consumerRoot, CODING_AGENT_PACKAGE), (manifest) => {
      manifest.exports["./client"] = { import: "./src/client/index.ts" };
    });
    writeFileSync(join(consumerRoot, "node_modules", ...CODING_AGENT_PACKAGE.split("/"), "src/client/index.ts"), 'throw new Error("evaluation-must-not-run");');
    const exposed = runRawRuntimeProbeForTests("bun", process.execPath, consumerRoot, VERSION);
    expect(exposed.sourceOnlyDeepPaths![0]!.status).toBe("resolved");
  });

  test("parses exact release metadata and caller-provided runtime paths", () => {
    expect(parseAdmissionArgs([
      "--consumer-root", "./consumer",
      `--version=${VERSION}`,
      "--git-head", GIT_HEAD,
      "--bun", "/opt/bun/bin/bun",
    ])).toEqual({
      consumerRoot: resolve("./consumer"),
      version: VERSION,
      gitHead: GIT_HEAD,
      bunPath: "/opt/bun/bin/bun",
    });

    expect(() => parseAdmissionArgs([
      "--consumer-root", "./consumer",
      "--version", "^0.87.1",
      "--git-head", GIT_HEAD,
      "--bun", "/opt/bun/bin/bun",
    ])).toThrow("--version must be an exact semantic version");
    expect(() => parseAdmissionArgs([
      "--consumer-root", "./consumer",
      "--version", VERSION,
      "--git-head", "ABC",
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
      LEGACY_FAMILY_PACKAGES.map((name) => ({ name, version: VERSION })),
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

  test("requires and validates the exact 0.99.1 eight-package registry receipt", () => {
    expect(() => parseAdmissionArgs([
      "--consumer-root", "./consumer", "--version", MODERN_VERSION, "--git-head", MODERN_GIT_HEAD,
      "--bun", "/opt/bun/bin/bun",
    ])).toThrow("--registry-receipt is required");
    expect(() => parseAdmissionArgs([
      "--consumer-root", "./consumer", "--version", MODERN_VERSION, "--git-head", MODERN_GIT_HEAD,
      "--registry-receipt", registryFixture, "--bun", "/opt/bun/bin/bun",
    ])).toThrow("--provider-receipt is required");

    const receipt = validateRegistryReceipt(registryFixture, MODERN_VERSION, MODERN_GIT_HEAD);
    expect(receipt.packages.map((entry) => entry.name).sort()).toEqual([...FAMILY_PACKAGES].sort());
    expect(receipt.packages).toHaveLength(8);
    expect(receipt.nodeEngine).toBe(">=22.19.0");
  });

  test("admits 0.99.1 declarations for MCP, OAuth, bun-oauth, and all eight packages", () => {
    const consumerRoot = materializeConsumer(modernFixtureRoot);
    const receipt = inspectInstalledConsumer({
      consumerRoot,
      version: MODERN_VERSION,
      gitHead: MODERN_GIT_HEAD,
      registryReceiptPath: registryFixture,
      providerReceiptPath: providerFixture,
    });

    expect(receipt.packages.map((entry) => entry.name).sort()).toEqual([...FAMILY_PACKAGES].sort());
    expect(receipt.registryReceipt?.packages).toHaveLength(8);
    expect(receipt.providerAuthReceipt?.providers).toHaveLength(42);
    expect(receipt.tarballVerification).toBeUndefined();
    expect(receipt.providerAuthReceipt?.providers.filter(provider=>provider.oauth).map(provider=>provider.id)).toEqual([
      "anthropic","github-copilot","kimi-coding","meta","openai","openai-codex","openrouter","radius","xai",
    ]);
    expect(receipt.modernPublicExports?.map(({ packageName, subpath }) => `${packageName}${subpath === "." ? "" : subpath.slice(1)}`)).toEqual([
      "@earendil-works/pi-mcp",
      "@earendil-works/pi-mcp/oauth",
      "@earendil-works/pi-ai/bun-oauth",
    ]);
    expect(receipt.modernPublicExports?.every(({ targets }) =>
      ["types", "import"].every((condition) => targets.some((target) => target.conditions.includes(condition) && target.exists)),
    )).toBeTrue();
  });

  test("validates the exact provider/auth matrix used by login qualification", () => {
    const receipt=validateProviderAuthReceipt(providerFixture,MODERN_VERSION,MODERN_GIT_HEAD);
    expect(receipt.providers).toHaveLength(42);
    const source=JSON.parse(readFileSync(providerFixture,"utf8"));
    const mutate=(change:(data:any)=>void)=>{const scratch=mkdtempSync(join(tmpdir(),"provider-receipt-"));scratchRoots.push(scratch);change(source);const path=join(scratch,"provider.json");writeFileSync(path,JSON.stringify(source));return path;};
    expect(()=>validateProviderAuthReceipt(mutate(data=>data.providers.pop()),MODERN_VERSION,MODERN_GIT_HEAD)).toThrow("receipt hash differs");
    const duplicate=JSON.parse(readFileSync(providerFixture,"utf8"));duplicate.providers.push(duplicate.providers[0]);const scratch=mkdtempSync(join(tmpdir(),"provider-duplicate-"));scratchRoots.push(scratch);const duplicatePath=join(scratch,"provider.json");writeFileSync(duplicatePath,JSON.stringify(duplicate));
    expect(()=>validateProviderAuthReceipt(duplicatePath,MODERN_VERSION,MODERN_GIT_HEAD)).toThrow("receipt hash differs");
  });

  test("rejects missing, duplicate, extra, and mismatched 0.99.1 registry entries", () => {
    expect(() => validateRegistryReceipt(materializeRegistry((entries) => entries.pop()), MODERN_VERSION, MODERN_GIT_HEAD))
      .toThrow("missing packages");
    expect(() => validateRegistryReceipt(materializeRegistry((entries) => entries.push(structuredClone(entries[0]!))), MODERN_VERSION, MODERN_GIT_HEAD))
      .toThrow("duplicate package");
    expect(() => validateRegistryReceipt(materializeRegistry((entries) => { entries[0]!.name = "@earendil-works/extra"; }), MODERN_VERSION, MODERN_GIT_HEAD))
      .toThrow("extra package");

    const mismatches: Array<[(entry: Record<string, any>) => void, string]> = [
      [(entry) => { entry.version = "0.99.0"; }, "version mismatch"],
      [(entry) => { entry.gitHead = "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"; }, "gitHead mismatch"],
      [(entry) => { entry.dist.shasum = "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"; }, "shasum mismatch"],
      [(entry) => { entry.dist.integrity = "sha512-bad"; }, "integrity mismatch"],
      [(entry) => { entry.dist.tarball = "https://registry.npmjs.org/wrong.tgz"; }, "tarball mismatch"],
      [(entry) => { entry.engines.node = ">=22"; }, "must declare Node >=22.19.0"],
    ];
    for (const [mutate, message] of mismatches) {
      const path = materializeRegistry((entries) => mutate(entries[0]!));
      expect(() => validateRegistryReceipt(path, MODERN_VERSION, MODERN_GIT_HEAD)).toThrow(message);
    }
    expect(() => validateRegistryReceipt(registryFixture, MODERN_VERSION, GIT_HEAD)).toThrow(`requires gitHead ${MODERN_GIT_HEAD}`);
  });

  test("real admission requires published tarballs for modern versions", () => {
    const options={consumerRoot:materializeConsumer(modernFixtureRoot),version:MODERN_VERSION,gitHead:MODERN_GIT_HEAD,registryReceiptPath:registryFixture,providerReceiptPath:providerFixture,bunPath:process.execPath};
    expect(()=>runEarendilPackageAdmission(options)).toThrow("tarball directory is required");
  });

  test("runs the 0.99.1 public runtime probe and calls bundled OAuth registration without network", () => {
    const consumerRoot = materializeConsumer(modernFixtureRoot);
    const receipt = runRawRuntimeProbeForTests("bun", process.execPath, consumerRoot, MODERN_VERSION);
    expect(receipt.rootImportError).toBeUndefined();
    for (const name of MODERN_CODING_AGENT_EXPORTS) expect(receipt.rootExports[name]).toBe("function");
    for (const name of MCP_ROOT_EXPORTS) expect(receipt.mcpRootExports[name]).toBe("function");
    for (const name of MCP_OAUTH_EXPORTS) expect(receipt.mcpOauthExports[name]).toBe("function");
    expect(receipt.bunOauth).toEqual({ registerBunOAuthFlows: "function", called: true });
    for (const entry of receipt.privateDeepPaths) expect(() => assertPrivateImportRejection("bun", entry)).not.toThrow();
  });

  test("side-effect enforcement denies fetch and named synchronous child-process imports", () => {
    const networkRoot=materializeConsumer(modernFixtureRoot),agent=join(networkRoot,"node_modules","@earendil-works","pi-coding-agent","dist","index.js");
    writeFileSync(agent,`await fetch("https://example.invalid");\n${readFileSync(agent,"utf8")}`);
    const networkReceipt=runRawRuntimeProbeForTests("bun",process.execPath,networkRoot,MODERN_VERSION);expect(networkReceipt.sideEffectEnforcement?.networkAttempts).toBe(1);expect(networkReceipt.rootImportError?.message).toContain("network disabled");
    const childRoot=materializeConsumer(modernFixtureRoot),childAgent=join(childRoot,"node_modules","@earendil-works","pi-coding-agent","dist","index.js");
    writeFileSync(childAgent,`import {execSync} from "node:child_process";execSync("true");\n${readFileSync(childAgent,"utf8")}`);
    const childReceipt=runRawRuntimeProbeForTests("bun",process.execPath,childRoot,MODERN_VERSION);expect(childReceipt.sideEffectEnforcement?.childProcessAttempts).toBe(1);expect(childReceipt.rootImportError?.message).toContain("child process disabled");
  });

  test("rejects missing modern packages, missing ChatGPT OAuth module, and exposed private imports", () => {
    const missingPackageRoot = materializeConsumer(modernFixtureRoot);
    rmSync(join(missingPackageRoot, "node_modules", "@earendil-works", "pi-mcp"), { recursive: true });
    expect(() => inspectInstalledConsumer({
      consumerRoot: missingPackageRoot, version: MODERN_VERSION, gitHead: MODERN_GIT_HEAD, registryReceiptPath: registryFixture, providerReceiptPath: providerFixture,
    })).toThrow("@earendil-works/pi-mcp package.json");

    const missingOauthRoot = materializeConsumer(modernFixtureRoot);
    rmSync(join(missingOauthRoot, "node_modules", "@earendil-works", "pi-ai", "dist", "auth", "oauth", "openai-chatgpt.js"));
    const missingOauth = runRawRuntimeProbeForTests("bun",process.execPath,missingOauthRoot,MODERN_VERSION);
    expect(missingOauth.bunOauthImportError?.message).toContain("openai-chatgpt.js");

    const exposedRoot = materializeConsumer(modernFixtureRoot);
    const mcpManifest = manifestPath(exposedRoot, "@earendil-works/pi-mcp");
    updateJson(mcpManifest, (manifest) => {
      manifest.exports["./dist/client.js"] = { import: "./dist/index.js" };
    });
    const exposed = runRawRuntimeProbeForTests("bun",process.execPath,exposedRoot,MODERN_VERSION);
    const privateEntry = exposed.privateDeepPaths!.find(
      (entry: { specifier: string }) => entry.specifier === MODERN_PRIVATE_IMPORTS[0],
    );
    expect(privateEntry.status).toBe("resolved");
    expect(() => assertPrivateImportRejection("bun", privateEntry)).toThrow("private import");
  });

});
