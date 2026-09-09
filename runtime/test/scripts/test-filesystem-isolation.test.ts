import { expect, test } from "bun:test";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { tmpdir } from "node:os";
import { assertPathWithinTestFilesystemIsolation, assertTestWorkspaceArguments, ensureTestFilesystemIsolation } from "../../scripts/test-filesystem-isolation.js";

const repo = resolve(import.meta.dir, "../../..");
const launcher = join(repo, "runtime/scripts/local-test-priority.ts");

test("CLI workspace overrides cannot outrank filesystem isolation", () => {
  const env = { ...process.env, PICLAW_TEST_FS_ISOLATION_ACTIVE: "0" };
  const isolation = ensureTestFilesystemIsolation(env);
  try {
    for (const args of [["--workspace", "/workspace"], ["--workspace=/workspace"], ["-w", "/workspace"], ["-w=/workspace"], ["--workspace"]]) {
      expect(() => assertTestWorkspaceArguments(args, env)).toThrow();
    }
    expect(() => assertTestWorkspaceArguments(["--workspace", isolation.workspace], env)).not.toThrow();
    for (const command of [
      [launcher, "--", process.execPath, "-e", "throw Error('must not run')", "--workspace=/workspace"],
      [join(repo, "runtime/scripts/controlled-test-runner.ts"), "--", "--workspace=/workspace"],
    ]) {
      const child = Bun.spawnSync([process.execPath, ...command], { cwd: repo, env, stdout: "pipe", stderr: "pipe" });
      expect(child.exitCode).not.toBe(0);
      expect(child.stderr.toString()).toContain("outside isolated root");
    }
  } finally { isolation.cleanup(); }
});

test("isolation replaces inherited production paths even with CI/priority markers", () => {
  const env = { ...process.env, CI: "true", PICLAW_LOCAL_TEST_PRIORITY_ACTIVE: "1", PICLAW_WORKSPACE: "/workspace", PICLAW_STORE: "/workspace/.piclaw/store", PICLAW_DATA: "/workspace/.piclaw/data", HOME: "/home/agent", PICLAW_KEYCHAIN_KEY: "not-a-real-secret", PICLAW_RUNTIME_ROOT: "/workspace/.piclaw" };
  const isolation = ensureTestFilesystemIsolation(env);
  try {
    expect(isolation.createdRoot).toBe(true);
    for (const key of ["PICLAW_WORKSPACE", "PICLAW_STORE", "PICLAW_DATA", "HOME", "PICLAW_PI_AGENT_DIR", "TMPDIR"]) {
      expect(env[key as keyof typeof env]).toStartWith(isolation.root + "/");
    }
    expect(env.PICLAW_KEYCHAIN_KEY).toBeUndefined();
    expect(env.PICLAW_RUNTIME_ROOT).toBeUndefined();
    const nested = ensureTestFilesystemIsolation(env);
    expect(nested.root).toBe(isolation.root);
    expect(nested.createdRoot).toBe(false);
    nested.cleanup();
    expect(existsSync(isolation.root)).toBe(true);
    expect(() => assertPathWithinTestFilesystemIsolation("/workspace/notes", env)).toThrow("outside isolated root");
  } finally { isolation.cleanup(); }
  expect(existsSync(isolation.root)).toBe(false);
});

test("destructive guard rejects symlink ancestors, including dangling links", () => {
  const env = { ...process.env, PICLAW_TEST_FS_ISOLATION_ACTIVE: "0" };
  const isolation = ensureTestFilesystemIsolation(env);
  const external = mkdtempSync(join(tmpdir(), "test-external-sentinel-"));
  try {
    writeFileSync(join(external, "keep"), "preserve");
    symlinkSync(external, join(isolation.workspace, "escape"), "dir");
    symlinkSync(join(external, "missing"), join(isolation.workspace, "dangling"), "dir");
    for (const name of ["escape", "dangling"]) {
      expect(() => assertPathWithinTestFilesystemIsolation(join(isolation.workspace, name, "notes"), env)).toThrow("symlink");
    }
    expect(readFileSync(join(external, "keep"), "utf8")).toBe("preserve");
  } finally { isolation.cleanup(); rmSync(external, { recursive: true, force: true }); }
});

test("nested partial path overrides validate derived store/data before mutation", () => {
  const env: Record<string, string | undefined> = { ...process.env, PICLAW_TEST_FS_ISOLATION_ACTIVE: "0" };
  const isolation = ensureTestFilesystemIsolation(env);
  const workspace = join(isolation.root, "other-workspace");
  const external = mkdtempSync(join(tmpdir(), "test-derived-path-sentinel-"));
  try {
    mkdirSync(workspace);
    symlinkSync(external, join(workspace, ".piclaw"), "dir");
    env.PICLAW_WORKSPACE = workspace; delete env.PICLAW_STORE; delete env.PICLAW_DATA;
    expect(() => ensureTestFilesystemIsolation(env)).toThrow("symlink");
    expect(existsSync(join(external, "store"))).toBe(false);
    expect(existsSync(join(external, "data"))).toBe(false);
  } finally { isolation.cleanup(); rmSync(external, { recursive: true, force: true }); }
});

test("launcher isolates cached runtime config before destructive test-like work", () => {
  const external = mkdtempSync(join(tmpdir(), "test-live-sentinel-"));
  const script = join(external, "probe.ts");
  for (const path of ["notes", "data", "store", "home/.pi/agent"]) {
    mkdirSync(join(external, path), { recursive: true }); writeFileSync(join(external, path, "sentinel"), path);
  }
  writeFileSync(script, `import { rmSync } from "node:fs"; import { join } from "node:path";
    const config = await import(${JSON.stringify(join(repo, "runtime/src/core/config.ts"))});
    if (config.WORKSPACE_DIR === ${JSON.stringify(external)}) throw Error("live workspace");
    rmSync(join(config.WORKSPACE_DIR, "notes"), {recursive:true,force:true});
    rmSync(config.DATA_DIR, {recursive:true,force:true});
    console.log("ISOLATED="+process.env.PICLAW_TEST_FS_ISOLATION_ROOT);`);
  try {
    const proc = Bun.spawnSync([process.execPath, launcher, "--", process.execPath, script], {
      cwd: repo, env: { ...process.env, PICLAW_TEST_FS_ISOLATION_ACTIVE: "0", PICLAW_WORKSPACE: external, PICLAW_DATA: join(external, "data"), PICLAW_STORE: join(external, "store"), HOME: join(external, "home"), PICLAW_PI_AGENT_DIR: join(external, "home/.pi/agent"), CI: "true", PICLAW_LOCAL_TEST_PRIORITY_ACTIVE: "1" }, stdout: "pipe", stderr: "pipe",
    });
    expect(proc.exitCode, proc.stderr.toString()).toBe(0);
    const root = proc.stdout.toString().match(/ISOLATED=(.+)/)?.[1];
    expect(root).toBeDefined(); expect(existsSync(root!)).toBe(false);
    for (const path of ["notes", "data", "store", "home/.pi/agent"]) expect(readFileSync(join(external, path, "sentinel"), "utf8")).toBe(path);
  } finally { rmSync(external, { recursive: true, force: true }); }
});

test("root and runtime raw Bun test preloads isolate before imports", () => {
  // Execute an existing small import-safe docs test; an env probe is preloaded after the mandatory harness.
  const external = mkdtempSync(join(tmpdir(), "test-preload-sentinel-"));
  const probe = join(external, "probe.ts");
  const stamp = join(external, "observed.json");
  writeFileSync(probe, `import{writeFileSync}from"fs";writeFileSync(${JSON.stringify(stamp)},JSON.stringify({workspace:process.env.PICLAW_WORKSPACE,home:process.env.HOME,root:process.env.PICLAW_TEST_FS_ISOLATION_ROOT}));`);
  try {
    for (const cwd of [repo, join(repo, "runtime")]) {
      const path = cwd === repo ? "runtime/test/runtime/readme-docker-run.test.ts" : "test/runtime/readme-docker-run.test.ts";
      const proc = Bun.spawnSync([process.execPath, "test", "--preload", probe, path], { cwd, env: { ...process.env, PICLAW_TEST_FS_ISOLATION_ACTIVE: "0", PICLAW_WORKSPACE: external, HOME: external }, stdout: "pipe", stderr: "pipe" });
      expect(proc.exitCode, proc.stderr.toString()).toBe(0);
      const observed = JSON.parse(readFileSync(stamp, "utf8"));
      expect(observed.workspace).not.toBe(external); expect(observed.home).not.toBe(external);
      expect(observed.workspace).toStartWith(observed.root + "/");
    }
  } finally { rmSync(external, { recursive: true, force: true }); }
});
