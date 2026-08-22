#!/usr/bin/env bun

import { createHash } from "node:crypto";
import { copyFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, relative, resolve } from "node:path";

export interface VendoredExportFile {
  packagePath: string;
  outputFile: string;
}

export interface VendoredDependencyManifest {
  id: string;
  packageName: string;
  additionalPackages?: string[];
  sourceEntry?: string;
  outputFile?: string;
  metadataFile: string;
  buildCommand?: string[];
  exportFiles?: VendoredExportFile[];
  installCommand?: string[];
}

interface CliBuildOptions {
  defaultManifest?: string;
}

interface CliUpdateOptions {
  defaultManifest?: string;
}

interface BuildVendoredDependencyOptions {
  projectDir: string;
  manifestPath: string;
  outFileOverride?: string;
  metaFileOverride?: string;
  env?: Record<string, string | undefined>;
}

interface UpdateVendoredDependencyOptions {
  projectDir: string;
  manifestPath: string;
  version?: string;
  env?: Record<string, string | undefined>;
}

interface InstalledPackageMetadata {
  requestedName: string;
  packageName: string;
  packageRoot: string;
  version: string;
  license: string;
  repository: string | null;
}

export function findProjectPackageDir(projectDir: string): string | null {
  const candidates = [projectDir, resolve(projectDir, "..")];
  for (const candidate of candidates) {
    if (existsSync(resolve(candidate, "package.json"))) {
      return candidate;
    }
  }
  return null;
}

interface VendoredOutputMetadata {
  package_path: string | null;
  output_file: string;
  sha256: string;
  size_bytes: number;
}

function getArgs(argv = process.argv.slice(2)): string[] {
  return argv;
}

export function getArg(args: string[], name: string): string | undefined {
  const index = args.indexOf(name);
  if (index >= 0 && index + 1 < args.length) {
    const value = args[index + 1];
    if (!value.startsWith("--")) return value;
  }
  return undefined;
}

function requiredArg(args: string[], name: string, fallback?: string): string {
  const value = getArg(args, name) || fallback;
  if (!value) {
    throw new Error(`Missing required argument: ${name}`);
  }
  return value;
}

function packageRepositoryValue(packageJson: {
  repository?: string | { url?: string };
  homepage?: string;
}): string | null {
  if (typeof packageJson.repository === "string") return packageJson.repository;
  return packageJson.repository?.url || packageJson.homepage || null;
}

function findInstalledPackageJson(projectDir: string, packageName: string): string | null {
  const candidates = [
    resolve(projectDir, `node_modules/${packageName}/package.json`),
    resolve(projectDir, `../node_modules/${packageName}/package.json`),
  ];

  for (const candidate of candidates) {
    if (existsSync(candidate)) return candidate;
  }
  return null;
}

function readInstalledPackageMetadata(projectDir: string, packageName: string): InstalledPackageMetadata | null {
  const packageFile = findInstalledPackageJson(projectDir, packageName);
  if (!packageFile) {
    return null;
  }
  const packageJson = JSON.parse(readFileSync(packageFile, "utf8")) as {
    name?: string;
    version?: string;
    license?: string;
    repository?: string | { url?: string };
    homepage?: string;
  };
  return {
    requestedName: packageName,
    packageName: packageJson.name || packageName,
    packageRoot: dirname(packageFile),
    version: packageJson.version || "unknown",
    license: packageJson.license || "unknown",
    repository: packageRepositoryValue(packageJson),
  };
}

function substituteTokens(command: string[], tokens: Record<string, string>): string[] {
  return command.map((part) => part.replace(/\$([A-Z_]+)/g, (_match, key) => tokens[key] ?? ""));
}

function installProjectDependencies(projectDir: string, logPrefix: string, env?: Record<string, string | undefined>): boolean {
  const packageDir = findProjectPackageDir(projectDir);
  if (!packageDir) {
    console.error(`${logPrefix} Could not find package.json near ${projectDir}`);
    return false;
  }

  const installEnv = { ...env };
  const cacheDir = installEnv.BUN_INSTALL_CACHE_DIR || "/workspace/.cache/bun";
  const tempDir = installEnv.TMPDIR || "/workspace/.tmp/bun-install";
  mkdirSync(cacheDir, { recursive: true });
  mkdirSync(tempDir, { recursive: true });
  installEnv.BUN_INSTALL_CACHE_DIR = cacheDir;
  installEnv.TMPDIR = tempDir;
  installEnv.TEMP = installEnv.TEMP || tempDir;
  installEnv.TMP = installEnv.TMP || tempDir;

  const proc = Bun.spawnSync([process.execPath, "install", "--frozen-lockfile"], {
    cwd: packageDir,
    stdout: "inherit",
    stderr: "inherit",
    env: installEnv,
  });
  return proc.exitCode === 0;
}

function ensureInstalledPackages(
  projectDir: string,
  manifest: VendoredDependencyManifest,
  logPrefix: string,
  env?: Record<string, string | undefined>,
): InstalledPackageMetadata[] | null {
  const packageNames = [manifest.packageName, ...(manifest.additionalPackages || [])];

  const readInstalledPackages = () =>
    packageNames
      .map((packageName) => readInstalledPackageMetadata(projectDir, packageName))
      .filter((pkg): pkg is InstalledPackageMetadata => Boolean(pkg));

  let installedPackages = readInstalledPackages();
  if (installedPackages.length === packageNames.length) {
    return installedPackages;
  }

  const missing = packageNames.filter((packageName) => !installedPackages.some((pkg) => pkg.requestedName === packageName));
  console.error(`${logPrefix} Missing installed packages: ${missing.join(", ")}`);
  console.error(`${logPrefix} Attempting repo-local bun install --frozen-lockfile for this worktree...`);

  if (!installProjectDependencies(projectDir, logPrefix, env)) {
    console.error(`${logPrefix} Automatic dependency install failed.`);
    return null;
  }

  installedPackages = readInstalledPackages();
  if (installedPackages.length !== packageNames.length) {
    const stillMissing = packageNames.filter((packageName) => !installedPackages.some((pkg) => pkg.requestedName === packageName));
    console.error(`${logPrefix} Packages still missing after bun install: ${stillMissing.join(", ")}`);
    return null;
  }

  return installedPackages;
}

function sha256ForFile(path: string): string {
  return createHash("sha256").update(readFileSync(path)).digest("hex");
}

/** Normalize text bundles before hashing so formatter checks stay stable across Bun releases. */
function normalizeBuiltTextFile(path: string): void {
  const content = readFileSync(path, "utf8");
  const normalized = content.replace(/[ \t]+$/gm, "");
  if (normalized !== content) writeFileSync(path, normalized, "utf8");
}

function buildMetadata(
  manifest: VendoredDependencyManifest,
  projectDir: string,
  installedPackages: InstalledPackageMetadata[],
  metadataFile: string,
  outputs: VendoredOutputMetadata[],
  extras: Record<string, unknown> = {},
): Record<string, unknown> {
  const primaryPackage = installedPackages[0];
  const primaryOutput = outputs[0] ?? null;
  return {
    manifest_id: manifest.id,
    package_name: primaryPackage.packageName || manifest.packageName,
    package_version: primaryPackage.version || "unknown",
    package_license: primaryPackage.license || "unknown",
    package_repository: primaryPackage.repository,
    package_versions: Object.fromEntries(installedPackages.map((pkg) => [pkg.packageName, pkg.version])),
    package_licenses: Object.fromEntries(installedPackages.map((pkg) => [pkg.packageName, pkg.license])),
    package_repositories: Object.fromEntries(installedPackages.map((pkg) => [pkg.packageName, pkg.repository])),
    source_entry: manifest.sourceEntry ? relative(projectDir, resolve(projectDir, manifest.sourceEntry)) : null,
    output_file: primaryOutput?.output_file ?? null,
    output_files: outputs,
    metadata_file: relative(projectDir, metadataFile),
    sha256: primaryOutput?.sha256 ?? null,
    size_bytes: primaryOutput?.size_bytes ?? null,
    ...extras,
  };
}

export function loadVendoredDependencyManifest(projectDir: string, manifestPath: string): VendoredDependencyManifest {
  const absPath = resolve(projectDir, manifestPath);
  if (!existsSync(absPath)) {
    throw new Error(`Vendored dependency manifest not found: ${absPath}`);
  }

  const parsed = JSON.parse(readFileSync(absPath, "utf8")) as Partial<VendoredDependencyManifest>;
  for (const field of ["id", "packageName", "metadataFile"] as const) {
    if (!parsed[field]) {
      throw new Error(`Vendored dependency manifest missing required field: ${field}`);
    }
  }

  const hasBuild = Array.isArray(parsed.buildCommand) && parsed.buildCommand.length > 0;
  const hasExport = Array.isArray(parsed.exportFiles) && parsed.exportFiles.length > 0;
  if (!hasBuild && !hasExport) {
    throw new Error("Vendored dependency manifest must define either buildCommand or exportFiles");
  }
  if (hasBuild) {
    if (!parsed.sourceEntry || !parsed.outputFile) {
      throw new Error("Build-style vendored dependency manifests require sourceEntry and outputFile");
    }
  }
  if (hasExport) {
    for (const file of parsed.exportFiles || []) {
      if (!file?.packagePath || !file?.outputFile) {
        throw new Error("Export-style vendored dependency manifests require packagePath and outputFile for every export file");
      }
    }
  }
  if (parsed.installCommand && (!Array.isArray(parsed.installCommand) || parsed.installCommand.length === 0)) {
    throw new Error("Vendored dependency manifest installCommand must be a non-empty array when provided");
  }

  return parsed as VendoredDependencyManifest;
}

function buildFromSource(
  manifest: VendoredDependencyManifest,
  options: BuildVendoredDependencyOptions,
  installedPackages: InstalledPackageMetadata[],
  metadataFile: string,
  logPrefix: string,
): number {
  const env = options.env ?? process.env;
  const sourceEntry = resolve(options.projectDir, manifest.sourceEntry!);
  const outputFile = resolve(options.projectDir, options.outFileOverride || manifest.outputFile!);

  if (!existsSync(sourceEntry)) {
    console.error(`${logPrefix} Missing source entry: ${sourceEntry}`);
    return 1;
  }

  mkdirSync(dirname(outputFile), { recursive: true });
  mkdirSync(dirname(metadataFile), { recursive: true });

  const primaryPackage = installedPackages[0];
  const tokens = {
    PACKAGE_NAME: manifest.packageName,
    SOURCE_ENTRY: relative(options.projectDir, sourceEntry),
    OUTPUT_FILE: relative(options.projectDir, outputFile),
    METADATA_FILE: relative(options.projectDir, metadataFile),
    PROJECT_DIR: options.projectDir,
    VERSION: primaryPackage.version || "",
  };
  const buildCommand = substituteTokens(manifest.buildCommand!, tokens);
  const proc = Bun.spawnSync(buildCommand, {
    cwd: options.projectDir,
    stdout: "pipe",
    stderr: "pipe",
    env,
  });

  const stdout = proc.stdout.toString();
  const stderr = proc.stderr.toString();
  if (proc.exitCode !== 0) {
    process.stderr.write(stdout);
    process.stderr.write(stderr);
    return proc.exitCode || 1;
  }

  normalizeBuiltTextFile(outputFile);

  const outputs: VendoredOutputMetadata[] = [
    {
      package_path: null,
      output_file: relative(options.projectDir, outputFile),
      sha256: sha256ForFile(outputFile),
      size_bytes: readFileSync(outputFile).byteLength,
    },
  ];
  const metadata = buildMetadata(manifest, options.projectDir, installedPackages, metadataFile, outputs, {
    build_command: buildCommand,
  });
  writeFileSync(metadataFile, `${JSON.stringify(metadata, null, 2)}\n`, "utf8");
  process.stdout.write([
    `${logPrefix} built ${outputs[0].output_file}`,
    `${logPrefix} version ${installedPackages[0].version}`,
    `${logPrefix} sha256 ${outputs[0].sha256}`,
    `${logPrefix} metadata ${relative(options.projectDir, metadataFile)}`,
  ].join("\n"));
  return 0;
}

function exportVendoredFiles(
  manifest: VendoredDependencyManifest,
  options: BuildVendoredDependencyOptions,
  installedPackages: InstalledPackageMetadata[],
  metadataFile: string,
  logPrefix: string,
): number {
  const primaryPackage = installedPackages[0];
  mkdirSync(dirname(metadataFile), { recursive: true });

  const outputs: VendoredOutputMetadata[] = [];
  for (const file of manifest.exportFiles || []) {
    const sourceFile = resolve(primaryPackage.packageRoot, file.packagePath);
    const outputFile = resolve(options.projectDir, file.outputFile);
    if (!existsSync(sourceFile)) {
      console.error(`${logPrefix} Missing package export: ${sourceFile}`);
      return 1;
    }
    mkdirSync(dirname(outputFile), { recursive: true });
    copyFileSync(sourceFile, outputFile);
    outputs.push({
      package_path: file.packagePath,
      output_file: relative(options.projectDir, outputFile),
      sha256: sha256ForFile(outputFile),
      size_bytes: readFileSync(outputFile).byteLength,
    });
  }

  const metadata = buildMetadata(manifest, options.projectDir, installedPackages, metadataFile, outputs, {
    export_files: (manifest.exportFiles || []).map((file) => ({
      package_path: file.packagePath,
      output_file: file.outputFile,
    })),
  });
  writeFileSync(metadataFile, `${JSON.stringify(metadata, null, 2)}\n`, "utf8");

  process.stdout.write([
    ...outputs.map((file) => `${logPrefix} exported ${file.output_file}`),
    `${logPrefix} version ${installedPackages[0].version}`,
    `${logPrefix} metadata ${relative(options.projectDir, metadataFile)}`,
  ].join("\n"));
  return 0;
}

export function buildVendoredDependency(options: BuildVendoredDependencyOptions): number {
  const manifest = loadVendoredDependencyManifest(options.projectDir, options.manifestPath);
  const logPrefix = `[vendor:${manifest.id}]`;
  const metadataFile = resolve(options.projectDir, options.metaFileOverride || manifest.metadataFile);
  const installedPackages = ensureInstalledPackages(options.projectDir, manifest, logPrefix, options.env);
  if (!installedPackages) return 1;

  if (manifest.buildCommand?.length) {
    return buildFromSource(manifest, options, installedPackages, metadataFile, logPrefix);
  }
  return exportVendoredFiles(manifest, options, installedPackages, metadataFile, logPrefix);
}

export function updateVendoredDependency(options: UpdateVendoredDependencyOptions): number {
  const env = options.env ?? process.env;
  const manifest = loadVendoredDependencyManifest(options.projectDir, options.manifestPath);
  const logPrefix = `[vendor:${manifest.id}]`;
  const cacheDir = env.BUN_INSTALL_CACHE_DIR || "/workspace/.cache/bun";

  if (options.version) {
    if (!manifest.installCommand?.length) {
      console.error(`${logPrefix} Manifest does not define an installCommand.`);
      return 1;
    }
    const installCommand = substituteTokens(manifest.installCommand, {
      PACKAGE_NAME: manifest.packageName,
      VERSION: options.version,
      PROJECT_DIR: options.projectDir,
      SOURCE_ENTRY: manifest.sourceEntry || "",
      OUTPUT_FILE: manifest.outputFile || "",
      METADATA_FILE: manifest.metadataFile,
    });
    const install = Bun.spawnSync(installCommand, {
      cwd: options.projectDir,
      stdout: "inherit",
      stderr: "inherit",
      env: {
        ...env,
        BUN_INSTALL_CACHE_DIR: cacheDir,
      },
    });
    if (install.exitCode !== 0) {
      return install.exitCode || 1;
    }
  }

  return buildVendoredDependency({
    projectDir: options.projectDir,
    manifestPath: options.manifestPath,
    env: {
      ...env,
      BUN_INSTALL_CACHE_DIR: cacheDir,
    },
  });
}

export function runBuildCli(options: CliBuildOptions = {}): never {
  try {
    const args = getArgs();
    const manifestPath = requiredArg(args, "--manifest", options.defaultManifest);
    const exitCode = buildVendoredDependency({
      projectDir: process.cwd(),
      manifestPath,
      outFileOverride: getArg(args, "--outfile"),
      metaFileOverride: getArg(args, "--meta-out"),
    });
    process.exit(exitCode);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error(message);
    process.exit(1);
  }
}

export function runUpdateCli(options: CliUpdateOptions = {}): never {
  try {
    const args = getArgs();
    const manifestPath = requiredArg(args, "--manifest", options.defaultManifest);
    const exitCode = updateVendoredDependency({
      projectDir: process.cwd(),
      manifestPath,
      version: getArg(args, "--version"),
    });
    process.exit(exitCode);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error(message);
    process.exit(1);
  }
}
