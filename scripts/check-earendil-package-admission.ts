#!/usr/bin/env bun
/**
 * Validate an already-installed, standalone consumer of the Earendil package family.
 *
 * This check is deliberately read-only: it does not install packages, rewrite pins,
 * activate the harness, or call a model provider. The supplied git head is retained
 * as caller-provided registry/release metadata because npm tarballs may omit gitHead.
 */

import {
  accessSync,
  constants,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  realpathSync,
  rmSync,
  statSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { delimiter, dirname, join, resolve, sep } from "node:path";

export const FAMILY_PACKAGES = [
  "@earendil-works/pi-ai",
  "@earendil-works/pi-agent-core",
  "@earendil-works/pi-coding-agent",
  "@earendil-works/pi-tui",
  "@earendil-works/pi-telemetry",
  "@earendil-works/chord",
] as const;

export const CODING_AGENT_PACKAGE = "@earendil-works/pi-coding-agent";
export const SERVER_PACKAGE = "@earendil-works/pi-server";
export const SOURCE_ONLY_DEEP_PATHS = ["./client", "./experimental/plugin"] as const;

const DEPENDENCY_FIELDS = ["dependencies", "devDependencies", "optionalDependencies", "peerDependencies"] as const;
const EXACT_VERSION_RE = /^(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)(?:-[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?(?:\+[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?$/;
const EXACT_GIT_HEAD_RE = /^[0-9a-f]{40}$/;
const SOURCE_EXPORT_CONDITION = "source";
const PROBE_MARKER = "EAR_ENDIL_PACKAGE_ADMISSION=";

type JsonObject = Record<string, unknown>;

export type AdmissionOptions = {
  readonly consumerRoot: string;
  readonly version: string;
  readonly gitHead: string;
  readonly nodePaths: readonly string[];
  readonly bunPath: string;
};

export type ExportTargetReceipt = {
  readonly conditions: readonly string[];
  readonly target: string;
  readonly absolutePath: string;
  readonly exists: boolean;
};

export type InstalledAdmissionReceipt = {
  readonly consumerRoot: string;
  readonly expected: { readonly version: string; readonly gitHead: string };
  readonly directDependency: { readonly name: typeof CODING_AGENT_PACKAGE; readonly specifier: string };
  readonly packages: ReadonlyArray<{
    readonly name: string;
    readonly version: string;
    readonly packageJson: string;
    readonly installedGitHead?: string;
  }>;
  readonly gitHeadMetadata: {
    readonly source: "caller-supplied registry/release receipt";
    readonly expected: string;
    readonly installedPackageJsonValues: ReadonlyArray<{ readonly name: string; readonly gitHead: string }>;
    readonly packageMetadataVerification: "matched where present";
    readonly note: string;
  };
  readonly codingAgentExports: {
    readonly root: { readonly admitted: true; readonly targets: readonly ExportTargetReceipt[] };
    readonly sourceOnly: ReadonlyArray<{
      readonly subpath: string;
      readonly admitted: false;
      readonly targets: readonly ExportTargetReceipt[];
    }>;
  };
};

export type RuntimeProbeReceipt = {
  readonly requestedRuntime: "node" | "bun";
  readonly requestedExecutable: string;
  readonly actualRuntime: {
    readonly execPath: string;
    readonly release: string;
    readonly version: string;
    readonly node?: string;
    readonly bun?: string;
  };
  readonly rootExports: Record<"createAgentSession" | "createAgentSessionRuntime" | "ModelRuntime", string>;
  readonly sourceOnlyDeepPaths: ReadonlyArray<{
    readonly specifier: string;
    readonly admitted: false;
    readonly status: "rejected";
    readonly error: { readonly name: string; readonly code?: string; readonly message: string };
  }>;
};

export type EarendilPackageAdmissionReceipt = InstalledAdmissionReceipt & {
  readonly admitted: true;
  readonly providerFactoryCalls: 0;
  readonly probeEnvironment: {
    readonly inheritedSecrets: false;
    readonly offlineRequested: true;
    readonly telemetry: "disabled";
    readonly networkSandboxed: false;
  };
  readonly runtimes: readonly RuntimeProbeReceipt[];
};

function usage(): string {
  return [
    "Usage:",
    "  bun scripts/check-earendil-package-admission.ts \\",
    "    --consumer-root <installed-consumer> --version <exact-version> \\",
    "    --git-head <exact-40-char-sha> --node <node-path> [--node <node-path> ...] \\",
    "    --bun <bun-path>",
    "",
    "The check is read-only and offline. --git-head is a caller-supplied metadata receipt;",
    "packed package.json files are checked when they contain gitHead, but npm commonly omits it.",
  ].join("\n");
}

function takeOptionValue(args: readonly string[], index: number, name: string): { value: string; nextIndex: number } {
  const argument = args[index]!;
  const inlinePrefix = `${name}=`;
  if (argument.startsWith(inlinePrefix)) {
    const value = argument.slice(inlinePrefix.length);
    if (!value) throw new Error(`${name} requires a value`);
    return { value, nextIndex: index };
  }
  const value = args[index + 1];
  if (!value || value.startsWith("--")) throw new Error(`${name} requires a value`);
  return { value, nextIndex: index + 1 };
}

export function parseAdmissionArgs(args: readonly string[]): AdmissionOptions | { readonly help: true } {
  let consumerRoot: string | undefined;
  let version: string | undefined;
  let gitHead: string | undefined;
  let bunPath: string | undefined;
  const nodePaths: string[] = [];

  for (let index = 0; index < args.length; index++) {
    const argument = args[index]!;
    if (argument === "--help" || argument === "-h") return { help: true };
    const name = argument.includes("=") ? argument.slice(0, argument.indexOf("=")) : argument;
    if (!["--consumer-root", "--version", "--git-head", "--node", "--bun"].includes(name)) {
      throw new Error(`unknown argument: ${argument}`);
    }
    const option = takeOptionValue(args, index, name);
    index = option.nextIndex;
    if (name === "--consumer-root") {
      if (consumerRoot !== undefined) throw new Error("--consumer-root may only be supplied once");
      consumerRoot = option.value;
    } else if (name === "--version") {
      if (version !== undefined) throw new Error("--version may only be supplied once");
      version = option.value;
    } else if (name === "--git-head") {
      if (gitHead !== undefined) throw new Error("--git-head may only be supplied once");
      gitHead = option.value;
    } else if (name === "--node") {
      nodePaths.push(option.value);
    } else {
      if (bunPath !== undefined) throw new Error("--bun may only be supplied once");
      bunPath = option.value;
    }
  }

  if (!consumerRoot) throw new Error("--consumer-root is required");
  if (!version) throw new Error("--version is required");
  if (!EXACT_VERSION_RE.test(version)) throw new Error(`--version must be an exact semantic version, received: ${version}`);
  if (!gitHead) throw new Error("--git-head is required");
  if (!EXACT_GIT_HEAD_RE.test(gitHead)) throw new Error("--git-head must be an exact lowercase 40-character commit SHA");
  if (nodePaths.length === 0) throw new Error("at least one --node path is required");
  if (!bunPath) throw new Error("--bun is required");

  return { consumerRoot: resolve(consumerRoot), version, gitHead, nodePaths, bunPath };
}

function readJsonObject(path: string, label: string): JsonObject {
  let parsed: unknown;
  try {
    parsed = JSON.parse(readFileSync(path, "utf8"));
  } catch (error) {
    throw new Error(`cannot read ${label} at ${path}: ${error instanceof Error ? error.message : String(error)}`, { cause: error });
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw new Error(`${label} must contain a JSON object: ${path}`);
  return parsed as JsonObject;
}

function packageDirectory(consumerRoot: string, packageName: string): string {
  return join(consumerRoot, "node_modules", ...packageName.split("/"));
}

function packageManifestPath(consumerRoot: string, packageName: string): string {
  return join(packageDirectory(consumerRoot, packageName), "package.json");
}

function validateDirectDependencies(consumerManifest: JsonObject, expectedVersion: string): void {
  const dependencies = consumerManifest.dependencies;
  if (!dependencies || typeof dependencies !== "object" || Array.isArray(dependencies)) {
    throw new Error(`consumer dependencies must contain only ${CODING_AGENT_PACKAGE} at ${expectedVersion}`);
  }
  const entries = Object.entries(dependencies as JsonObject);
  if (entries.length !== 1 || entries[0]?.[0] !== CODING_AGENT_PACKAGE || entries[0]?.[1] !== expectedVersion) {
    throw new Error(`consumer dependencies must contain only ${CODING_AGENT_PACKAGE}: ${expectedVersion}`);
  }
  for (const field of DEPENDENCY_FIELDS.slice(1)) {
    const value = consumerManifest[field];
    if (!value || typeof value !== "object" || Array.isArray(value)) continue;
    const directNames = Object.keys(value as JsonObject);
    if (directNames.length > 0) throw new Error(`consumer ${field} must be empty; coding-agent is the only admitted direct dependency`);
  }
}

function listPackageDirectories(nodeModules: string): string[] {
  if (!existsSync(nodeModules)) return [];
  const directories: string[] = [];
  for (const entry of readdirSync(nodeModules, { withFileTypes: true })) {
    if (entry.name === ".bin") continue;
    const entryPath = join(nodeModules, entry.name);
    if (entry.name.startsWith("@") && entry.isDirectory()) {
      for (const scopedEntry of readdirSync(entryPath, { withFileTypes: true })) {
        if (scopedEntry.isDirectory() || scopedEntry.isSymbolicLink()) directories.push(join(entryPath, scopedEntry.name));
      }
    } else if (entry.isDirectory() || entry.isSymbolicLink()) {
      directories.push(entryPath);
    }
  }
  return directories;
}

function inspectInstalledTree(consumerRoot: string, version: string, gitHead: string): void {
  const pending = [join(consumerRoot, "node_modules")];
  const visited = new Set<string>();
  while (pending.length > 0) {
    const nodeModules = pending.pop()!;
    let identity: string;
    try {
      identity = realpathSync(nodeModules);
    } catch {
      continue;
    }
    if (visited.has(identity)) continue;
    visited.add(identity);
    const server = join(nodeModules, ...SERVER_PACKAGE.split("/"));
    if (existsSync(server)) throw new Error(`${SERVER_PACKAGE} must not be installed: ${server}`);
    for (const packageDir of listPackageDirectories(nodeModules)) {
      if (packageDir.endsWith(`${sep}.pnpm`)) {
        for (const container of listPackageDirectories(packageDir)) pending.push(join(container, "node_modules"));
      } else {
        const path = join(packageDir, "package.json");
        if (existsSync(path)) {
          const metadata = readJsonObject(path, "installed dependency");
          if (metadata.name === SERVER_PACKAGE) throw new Error(`${SERVER_PACKAGE} must not be installed: ${packageDir}`);
          if (typeof metadata.name === "string" && FAMILY_PACKAGES.some((name) => name === metadata.name)) {
            if (metadata.version !== version) throw new Error(`nested family version drift: ${metadata.name} at ${packageDir}`);
            if (metadata.gitHead !== undefined && metadata.gitHead !== gitHead) throw new Error(`nested family gitHead drift: ${metadata.name}`);
          }
        }
        pending.push(join(packageDir, "node_modules"));
      }
    }
  }
}

function collectExportTargets(value: unknown, conditions: readonly string[] = []): ExportTargetReceipt[] {
  if (typeof value === "string") return [{ conditions, target: value, absolutePath: "", exists: false }];
  if (Array.isArray(value)) return value.flatMap((entry, index) => collectExportTargets(entry, [...conditions, `[${index}]`]));
  if (!value || typeof value !== "object") return [];
  return Object.entries(value as JsonObject).flatMap(([condition, entry]) => collectExportTargets(entry, [...conditions, condition]));
}

function targetAbsolutePath(packageDir: string, target: string): string {
  if (!target.startsWith("./")) throw new Error(`package export target must be relative: ${target}`);
  const absolutePath = resolve(packageDir, target);
  const root = resolve(packageDir);
  if (absolutePath !== root && !absolutePath.startsWith(`${root}${sep}`)) throw new Error(`package export target escapes package: ${target}`);
  return absolutePath;
}

function inspectTargets(packageDir: string, value: unknown): ExportTargetReceipt[] {
  return collectExportTargets(value).map((target) => {
    const absolutePath = targetAbsolutePath(packageDir, target.target);
    return { ...target, absolutePath, exists: existsSync(absolutePath) };
  });
}

function inspectCodingAgentExports(packageDir: string, manifest: JsonObject): InstalledAdmissionReceipt["codingAgentExports"] {
  const exportsValue = manifest.exports;
  if (!exportsValue || typeof exportsValue !== "object" || Array.isArray(exportsValue)) {
    throw new Error(`${CODING_AGENT_PACKAGE} must declare package exports`);
  }
  const packageExports = exportsValue as JsonObject;
  const rootTargets = inspectTargets(packageDir, packageExports["."]);
  if (rootTargets.length === 0) throw new Error(`${CODING_AGENT_PACKAGE} root export has no targets`);
  if (!rootTargets.some((target) => target.conditions.includes("import") || target.conditions.length === 0)) {
    throw new Error(`${CODING_AGENT_PACKAGE} root export has no import target`);
  }
  const missingRootTargets = rootTargets.filter((target) => !target.exists);
  if (missingRootTargets.length > 0) {
    throw new Error(`${CODING_AGENT_PACKAGE} root export targets are missing: ${missingRootTargets.map((target) => target.target).join(", ")}`);
  }

  const sourceOnly = SOURCE_ONLY_DEEP_PATHS.map((subpath) => {
    const targets = inspectTargets(packageDir, packageExports[subpath]);
    if (targets.length === 0) throw new Error(`${CODING_AGENT_PACKAGE} must declare ${subpath} as a source-only export`);
    const runtimeTarget = targets.find((target) => !target.conditions.includes(SOURCE_EXPORT_CONDITION));
    if (runtimeTarget) throw new Error(`${CODING_AGENT_PACKAGE} ${subpath} is runtime-admitted by condition ${runtimeTarget.conditions.join("/") || "default"}`);
    return { subpath, admitted: false as const, targets };
  });

  return { root: { admitted: true, targets: rootTargets }, sourceOnly };
}

export function inspectInstalledConsumer(options: Pick<AdmissionOptions, "consumerRoot" | "version" | "gitHead">): InstalledAdmissionReceipt {
  const consumerRoot = realpathSync(resolve(options.consumerRoot));
  const consumerManifest = readJsonObject(join(consumerRoot, "package.json"), "consumer package.json");
  validateDirectDependencies(consumerManifest, options.version);

  inspectInstalledTree(consumerRoot, options.version, options.gitHead);

  const installedGitHeads: Array<{ name: string; gitHead: string }> = [];
  const packages = FAMILY_PACKAGES.map((name) => {
    const packageJson = packageManifestPath(consumerRoot, name);
    const manifest = readJsonObject(packageJson, `${name} package.json`);
    if (manifest.name !== name) throw new Error(`installed package identity mismatch at ${packageJson}: expected ${name}`);
    if (manifest.version !== options.version) throw new Error(`${name} version mismatch: expected ${options.version}, found ${String(manifest.version)}`);
    if (manifest.gitHead !== undefined) {
      if (manifest.gitHead !== options.gitHead) throw new Error(`${name} gitHead mismatch: expected ${options.gitHead}, found ${String(manifest.gitHead)}`);
      installedGitHeads.push({ name, gitHead: options.gitHead });
    }
    return { name, version: options.version, packageJson, ...(manifest.gitHead === undefined ? {} : { installedGitHead: options.gitHead }) };
  });

  const codingAgentDir = packageDirectory(consumerRoot, CODING_AGENT_PACKAGE);
  const codingManifest = readJsonObject(join(codingAgentDir, "package.json"), `${CODING_AGENT_PACKAGE} package.json`);
  const codingAgentExports = inspectCodingAgentExports(codingAgentDir, codingManifest);

  return {
    consumerRoot,
    expected: { version: options.version, gitHead: options.gitHead },
    directDependency: { name: CODING_AGENT_PACKAGE, specifier: options.version },
    packages,
    gitHeadMetadata: {
      source: "caller-supplied registry/release receipt",
      expected: options.gitHead,
      installedPackageJsonValues: installedGitHeads,
      packageMetadataVerification: "matched where present",
      note: "npm tarballs may omit gitHead; verify the supplied receipt against registry or release provenance separately",
    },
    codingAgentExports,
  };
}

function resolveExecutable(path: string, label: string): string {
  const absolutePath = realpathSync(resolve(path));
  const stat = statSync(absolutePath);
  if (!stat.isFile()) throw new Error(`${label} executable is not a file: ${absolutePath}`);
  if (process.platform !== "win32") accessSync(absolutePath, constants.X_OK);
  return absolutePath;
}

function createProbeEnvironment(scratch: string, executable: string): Record<string, string> {
  const home = join(scratch, "home");
  const cache = join(home, ".cache");
  const config = join(home, ".config");
  const data = join(home, ".local", "share");
  const temp = join(scratch, "tmp");
  for (const path of [home, cache, config, data, temp]) mkdirSync(path, { recursive: true });
  return {
    PATH: [dirname(executable), "/usr/local/bin", "/usr/bin", "/bin"].join(delimiter),
    HOME: home,
    XDG_CACHE_HOME: cache,
    XDG_CONFIG_HOME: config,
    XDG_DATA_HOME: data,
    TMPDIR: temp,
    TMP: temp,
    TEMP: temp,
    CI: "1",
    NO_COLOR: "1",
    DO_NOT_TRACK: "1",
    OTEL_SDK_DISABLED: "true",
    PI_OFFLINE: "1",
    PI_TELEMETRY: "0",
  };
}

export function probeProgram(): string {
  return `
const serializeError = (error) => ({
  name: error instanceof Error ? error.name : "UnknownError",
  ...(error && typeof error === "object" && "code" in error ? { code: String(error.code) } : {}),
  message: error instanceof Error ? error.message : String(error),
});
const receipt = {
  actualRuntime: {
    execPath: process.execPath,
    release: process.release?.name ?? "unknown",
    version: process.version,
    ...(process.versions?.node ? { node: process.versions.node } : {}),
    ...(process.versions?.bun ? { bun: process.versions.bun } : {}),
  },
  rootExports: {},
  sourceOnlyDeepPaths: [],
};
try {
  const root = await import(${JSON.stringify(CODING_AGENT_PACKAGE)});
  for (const name of ["createAgentSession", "createAgentSessionRuntime", "ModelRuntime"]) receipt.rootExports[name] = typeof root[name];
} catch (error) {
  receipt.rootImportError = serializeError(error);
}
for (const specifier of ${JSON.stringify(SOURCE_ONLY_DEEP_PATHS.map((subpath) => `${CODING_AGENT_PACKAGE}${subpath.slice(1)}`))}) {
  try {
    // A resolved source-only path is a failure even if evaluating its module
    // would throw. Never execute the unsupported surface to classify it.
    import.meta.resolve(specifier);
    receipt.sourceOnlyDeepPaths.push({ specifier, status: "resolved" });
  } catch (error) {
    receipt.sourceOnlyDeepPaths.push({ specifier, status: "rejected", phase: "resolution", error: serializeError(error) });
  }
}
console.log(${JSON.stringify(PROBE_MARKER)} + JSON.stringify(receipt));
`;
}

type RawProbeReceipt = {
  actualRuntime?: RuntimeProbeReceipt["actualRuntime"];
  rootExports?: Partial<RuntimeProbeReceipt["rootExports"]>;
  rootImportError?: { name?: string; code?: string; message?: string };
  sourceOnlyDeepPaths?: Array<{
    specifier?: string;
    status?: "resolved" | "rejected";
    phase?: "resolution";
    error?: { name?: string; code?: string; message?: string };
  }>;
};

export function assertProbeRuntime(kind: "node" | "bun", runtime: RuntimeProbeReceipt["actualRuntime"]): void {
  if (kind === "node" && (runtime.bun || runtime.release !== "node" || !runtime.node)) {
    throw new Error("Node admission requires real Node, not a Bun compatibility wrapper");
  }
  if (kind === "bun" && !runtime.bun) throw new Error("Bun admission requires Bun");
}

export function assertSourceOnlyRejection(kind: "node" | "bun", entry: NonNullable<RawProbeReceipt["sourceOnlyDeepPaths"]>[number]): void {
  const expectedCode = kind === "node" ? "ERR_PACKAGE_PATH_NOT_EXPORTED" : "ERR_MODULE_NOT_FOUND";
  if (entry.status !== "rejected" || entry.phase !== "resolution" || entry.error?.code !== expectedCode) {
    throw new Error(`${kind} source-only path was not excluded by export resolution: ${String(entry.specifier)}`);
  }
}

function runRuntimeProbe(kind: "node" | "bun", executableInput: string, consumerRoot: string, scratch: string): RuntimeProbeReceipt {
  const executable = resolveExecutable(executableInput, kind);
  const args = kind === "node"
    ? [executable, "--input-type=module", "--eval", probeProgram()]
    : [executable, "--eval", probeProgram()];
  const processResult = Bun.spawnSync(args, {
    cwd: consumerRoot,
    env: createProbeEnvironment(scratch, executable),
    stdout: "pipe",
    stderr: "pipe",
    timeout: 30_000,
  });
  const stdout = processResult.stdout.toString();
  const stderr = processResult.stderr.toString();
  if (processResult.exitCode !== 0) {
    throw new Error(`${kind} import probe failed with exit ${processResult.exitCode}: ${stderr || stdout}`);
  }
  const markerLine = stdout.split(/\r?\n/).reverse().find((line) => line.startsWith(PROBE_MARKER));
  if (!markerLine) throw new Error(`${kind} import probe did not return a receipt: ${stderr || stdout}`);
  const raw = JSON.parse(markerLine.slice(PROBE_MARKER.length)) as RawProbeReceipt;
  if (raw.rootImportError) throw new Error(`${kind} could not import ${CODING_AGENT_PACKAGE}: ${raw.rootImportError.message ?? raw.rootImportError.name ?? "unknown error"}`);
  if (!raw.actualRuntime || !raw.rootExports) throw new Error(`${kind} import probe returned an incomplete receipt`);
  assertProbeRuntime(kind, raw.actualRuntime);
  for (const name of ["createAgentSession", "createAgentSessionRuntime", "ModelRuntime"] as const) {
    if (raw.rootExports[name] !== "function") throw new Error(`${kind} root export ${name} must be a function, found ${String(raw.rootExports[name])}`);
  }
  const deepPaths = raw.sourceOnlyDeepPaths ?? [];
  if (deepPaths.length !== SOURCE_ONLY_DEEP_PATHS.length) throw new Error(`${kind} import probe returned incomplete source-only deep-path results`);
  const admitted = deepPaths.find((entry) => entry.status !== "rejected");
  if (admitted) throw new Error(`${kind} unexpectedly resolved source-only deep path ${String(admitted.specifier)}`);
  const sourceOnlyDeepPaths = deepPaths.map((entry, index) => {
    if (entry.specifier !== `${CODING_AGENT_PACKAGE}${SOURCE_ONLY_DEEP_PATHS[index].slice(1)}`) throw new Error(`${kind} unexpected source-only path receipt`);
    assertSourceOnlyRejection(kind, entry);
    if (!entry.specifier || !entry.error?.name || !entry.error.message) throw new Error(`${kind} deep-path rejection receipt is incomplete`);
    return {
      specifier: entry.specifier,
      admitted: false as const,
      status: "rejected" as const,
      error: {
        name: entry.error.name,
        ...(entry.error.code === undefined ? {} : { code: entry.error.code }),
        message: entry.error.message,
      },
    };
  });
  return {
    requestedRuntime: kind,
    requestedExecutable: executable,
    actualRuntime: raw.actualRuntime,
    rootExports: raw.rootExports as RuntimeProbeReceipt["rootExports"],
    sourceOnlyDeepPaths,
  };
}

export function runEarendilPackageAdmission(options: AdmissionOptions): EarendilPackageAdmissionReceipt {
  if (!EXACT_VERSION_RE.test(options.version)) throw new Error(`version must be exact: ${options.version}`);
  if (!EXACT_GIT_HEAD_RE.test(options.gitHead)) throw new Error("gitHead must be an exact lowercase 40-character commit SHA");
  if (options.nodePaths.length === 0) throw new Error("at least one Node runtime is required");
  const installed = inspectInstalledConsumer(options);
  const scratch = mkdtempSync(join(tmpdir(), "earendil-package-admission-"));
  try {
    const runtimes = [
      ...options.nodePaths.map((nodePath, index) => runRuntimeProbe("node", nodePath, installed.consumerRoot, join(scratch, `node-${index}`))),
      runRuntimeProbe("bun", options.bunPath, installed.consumerRoot, join(scratch, "bun")),
    ];
    return {
      ...installed,
      admitted: true,
      providerFactoryCalls: 0,
      probeEnvironment: { inheritedSecrets: false, offlineRequested: true, telemetry: "disabled", networkSandboxed: false },
      runtimes,
    };
  } finally {
    rmSync(scratch, { recursive: true, force: true });
  }
}

async function main(): Promise<void> {
  const options = parseAdmissionArgs(process.argv.slice(2));
  if ("help" in options) {
    console.log(usage());
    return;
  }
  console.log(JSON.stringify(runEarendilPackageAdmission(options), null, 2));
}

if (import.meta.main) {
  main().catch((error) => {
    console.error(`[earendil-package-admission] ${error instanceof Error ? error.message : String(error)}`);
    console.error(usage());
    process.exitCode = 1;
  });
}
