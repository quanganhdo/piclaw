#!/usr/bin/env bun

import { spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { basename, join } from "node:path";
import { assertTestWorkspaceArguments, ensureTestFilesystemIsolation } from "./test-filesystem-isolation.js";

export const LOCAL_TEST_NICE_ENV = "PICLAW_LOCAL_TEST_NICE";
export const LOCAL_TEST_PRIORITY_ACTIVE_ENV = "PICLAW_LOCAL_TEST_PRIORITY_ACTIVE";
export const DEFAULT_LOCAL_TEST_NICE = 10;

export type LocalTestPriorityPlan = {
  readonly command: readonly string[];
  readonly applied: boolean;
  readonly niceValue: number;
  readonly niceAdjustment: number;
  readonly diagnostic: string | null;
};

const SUPPORTED_PLATFORM = "linux";

export function parseLocalTestNice(value: string | undefined): number {
  if (value === undefined || value.trim() === "") return DEFAULT_LOCAL_TEST_NICE;
  if (!/^(?:0|[1-9]|1[0-9])$/.test(value.trim())) {
    throw new Error(`${LOCAL_TEST_NICE_ENV} must be an integer from 0 through 19`);
  }
  return Number(value.trim());
}

export function planLocalTestCommand(
  argv: readonly string[],
  env: Readonly<Record<string, string | undefined>> = process.env,
  platform = process.platform,
  capability: { readonly processGroupAvailable: boolean; readonly currentNice: number } = {
    processGroupAvailable: platform === SUPPORTED_PLATFORM && commandExists("nice") && commandExists("setsid"),
    currentNice: readCurrentNice(),
  },
): LocalTestPriorityPlan {
  if (argv.length === 0) throw new Error("local test launcher requires a command after --");
  const niceValue = parseLocalTestNice(env[LOCAL_TEST_NICE_ENV]);
  const niceAdjustment = Math.max(0, niceValue - capability.currentNice);
  if (isHostedFlag(env.CI) || isHostedFlag(env.GITHUB_ACTIONS)) {
    return { command: [...argv], applied: false, niceValue, niceAdjustment: 0, diagnostic: null };
  }
  if (env[LOCAL_TEST_PRIORITY_ACTIVE_ENV] === "1") {
    return { command: [...argv], applied: false, niceValue, niceAdjustment: 0, diagnostic: null };
  }
  if (platform !== SUPPORTED_PLATFORM || !capability.processGroupAvailable) {
    return {
      command: [...argv],
      applied: false,
      niceValue,
      niceAdjustment: 0,
      diagnostic: `[local-test-priority] process-group niceness unavailable on ${platform}; running test command directly`,
    };
  }
  const command = niceAdjustment > 0 ? ["nice", "-n", String(niceAdjustment), ...argv] : [...argv];
  return { command, applied: true, niceValue, niceAdjustment, diagnostic: null };
}

function isHostedFlag(value: string | undefined): boolean {
  return value === "1" || value?.toLowerCase() === "true";
}

function commandExists(command: string): boolean {
  if (process.platform === "win32") return false;
  const result = spawnSync("sh", ["-c", `command -v ${command} >/dev/null 2>&1`], { stdio: "ignore" });
  return result.status === 0;
}

function readCurrentNice(): number {
  if (process.platform !== SUPPORTED_PLATFORM) return 0;
  try {
    return Number(readFileSync(`/proc/${process.pid}/stat`, "utf8").split(" ")[18]);
  } catch {
    return 0;
  }
}

export function requiresBunTestCompletion(argv: readonly string[]): boolean {
  return /^bun(?:\.exe)?$/.test(basename(argv[0] ?? "")) && argv[1] === "test"
    && !argv.some(arg => arg === "--help" || arg === "-h");
}

export function hasBunTestCompletion(stderr: string): boolean {
  const clean = stderr.replace(/\x1b\[[0-9;]*m/g, "").trim();
  const lastLine = clean.split(/\r?\n/).at(-1) ?? "";
  const total = /^Ran ([1-9][0-9]*) tests? across [1-9][0-9]* files?\. \[[^\]]+\]$/.exec(lastLine);
  const lastPass = [...clean.matchAll(/^\s*\d+ pass$/gm)].at(-1);
  const summary = lastPass ? clean.slice(lastPass.index) : "";
  const count = (name: string) => [...summary.matchAll(new RegExp(`^\\s*(\\d+) ${name}$`, "gm"))].at(-1)?.[1];
  const pass = count("pass"), fail = count("fail");
  return !!total && pass !== undefined && Number(pass) > 0 && fail === "0"
    && Number(total[1]) === Number(pass) + Number(count("skip") ?? 0) + Number(count("todo") ?? 0);
}

export function hasBunJUnitCompletion(xml: string): boolean {
  const header = /^<testsuites\b[^>]*>/m.exec(xml)?.[0] ?? "";
  const attribute = (name: string) => new RegExp(`\\b${name}="([0-9]+)"`).exec(header)?.[1];
  const tests = Number(attribute("tests") ?? 0), skipped = Number(attribute("skipped") ?? 0);
  return xml.trimEnd().endsWith("</testsuites>") && tests > skipped && attribute("failures") === "0"
    && Number(attribute("errors") ?? 0) === 0 && (xml.match(/<testcase\b/g)?.length ?? 0) === tests;
}

export async function runLocalTestCommand(
  argv: readonly string[],
  options: { readonly cwd?: string; readonly env?: Record<string, string | undefined> } = {},
): Promise<never> {
  const env = { ...process.env, ...(options.env ?? {}) };
  const isolation = ensureTestFilesystemIsolation(env);
  const requireCompletion = requiresBunTestCompletion(argv);
  let reportDirectory: string | undefined;
  let reportPath: string | undefined;
  let plan: LocalTestPriorityPlan;
  try {
    assertTestWorkspaceArguments(argv, env);
    if (requireCompletion && argv.some(arg => /^--reporter(?:-outfile)?(?:=|$)/.test(arg))) {
      throw new Error("The qualification launcher owns its parent-specific JUnit report; remove custom --reporter/--reporter-outfile flags");
    }
    if (requireCompletion) {
      reportDirectory = mkdtempSync(join(isolation.root, "bun-suite-"));
      reportPath = join(reportDirectory, "completion.xml");
    }
    const command = requireCompletion ? [argv[0], argv[1], "--reporter=junit", `--reporter-outfile=${reportPath}`, ...argv.slice(2)] : argv;
    plan = planLocalTestCommand(command, env);
  } catch (error) {
    if (reportDirectory) rmSync(reportDirectory, { recursive: true, force: true });
    if (isolation.createdRoot) isolation.cleanup();
    throw error;
  }
  const spawnCommand = plan.applied
    ? ["setsid", "--wait", ...plan.command]
    : [...plan.command];
  if (plan.diagnostic) process.stderr.write(`${plan.diagnostic}\n`);
  if (plan.applied) env[LOCAL_TEST_PRIORITY_ACTIVE_ENV] = "1";
  let child: ReturnType<typeof Bun.spawn>;
  try {
    child = Bun.spawn(spawnCommand, {
      cwd: options.cwd ?? process.cwd(),
      env,
      stdin: "inherit",
      stdout: "inherit",
      stderr: requireCompletion ? "pipe" : "inherit",
      detached: false,
    });
  } catch (error) {
    if (reportDirectory) rmSync(reportDirectory, { recursive: true, force: true });
    if (isolation.createdRoot) isolation.cleanup();
    process.stderr.write(`[local-test-priority] failed to start test command: ${error instanceof Error ? error.message : String(error)}\n`);
    process.exit(127);
  }

  let stderrTail = "";
  const stderr = requireCompletion ? child.stderr : null;
  const reader = stderr && typeof stderr !== "number" ? stderr.getReader() : null;
  let drainError: unknown;
  const drain = reader ? (async () => {
    const decoder = new TextDecoder();
    try {
      while (true) {
        const { value, done } = await reader.read();
        if (done) break;
        await Bun.stderr.write(value);
        stderrTail = (stderrTail + decoder.decode(value, { stream: true })).slice(-8192);
      }
    } finally { reader.releaseLock(); }
  })().catch(error => { drainError = error; }) : Promise.resolve();
  const drainStopped = Promise.withResolvers<void>();
  let incompleteDrain = false;
  const stopDrain = () => {
    incompleteDrain = true;
    // Reader cancellation may race normal EOF/release; either way qualification fails.
    if (reader) void reader.cancel().catch(error => { drainError ??= error; });
    drainStopped.resolve();
  };

  const signals = ["SIGINT", "SIGTERM", "SIGHUP"] as const;
  let escalationTimer: ReturnType<typeof setTimeout> | undefined;
  const forward = (signal: typeof signals[number]) => {
    if (child.exitCode !== null) { stopDrain(); return; }
    if (!escalationTimer) escalationTimer = setTimeout(() => {
      if (child.exitCode !== null) return;
      if (plan.applied) {
        const result = spawnSync("kill", ["-KILL", "--", `-${child.pid}`], { stdio: "ignore" });
        if (result.status === 0) return;
      }
      child.kill("SIGKILL");
    }, 2000);
    if (plan.applied) {
      const signum = signal === "SIGINT" ? 2 : signal === "SIGHUP" ? 1 : 15;
      const result = spawnSync("kill", [`-${signum}`, "--", `-${child.pid}`], { stdio: "ignore" });
      if (result.status === 0) return;
    }
    child.kill(signal);
  };
  for (const signal of signals) process.on(signal, forward);
  let exitCode = 1;
  let groupCleaned = false;
  const cleanupGroup = () => {
    if (plan.applied && !groupCleaned) {
      spawnSync("kill", ["-KILL", "--", `-${child.pid}`], { stdio: "ignore" });
      groupCleaned = true;
    }
  };
  try {
    exitCode = await child.exited;
    // Close inherited pipes held by owned descendants before waiting for EOF.
    cleanupGroup();
    const timer = reader ? setTimeout(stopDrain, 2000) : undefined;
    try { await Promise.race([drain, drainStopped.promise]); }
    finally { clearTimeout(timer); }
    if (drainError) throw drainError;
    const junit = reportPath && existsSync(reportPath) ? readFileSync(reportPath, "utf8") : "";
    if (exitCode === 0 && requireCompletion && (incompleteDrain || !hasBunTestCompletion(stderrTail) || !hasBunJUnitCompletion(junit))) {
      process.stderr.write("[local-test-priority] Bun exited0 without its own complete JUnit artifact and drained, positive-pass test report; refusing incomplete qualification. Check for an escaped process.exit/deadline, leaked stderr descriptor or empty/skipped-only selection.\n");
      exitCode = 1;
    }
  } finally {
    clearTimeout(escalationTimer);
    for (const signal of signals) process.off(signal, forward);
    cleanupGroup();
    if (reportDirectory) rmSync(reportDirectory, { recursive: true, force: true });
    if (isolation.createdRoot) isolation.cleanup();
  }
  process.exit(exitCode);
}

if (import.meta.main) {
  const args = process.argv.slice(2);
  const separator = args.indexOf("--");
  const launcherArgs = separator >= 0 ? args.slice(0, separator) : [];
  const command = separator >= 0 ? args.slice(separator + 1) : args;
  let cwd: string | undefined;
  const env: Record<string, string | undefined> = {};
  for (let index = 0; index < launcherArgs.length; index += 1) {
    const arg = launcherArgs[index];
    if (arg === "--cwd") {
      cwd = launcherArgs[++index];
      if (!cwd) throw new Error("--cwd requires a path");
      continue;
    }
    if (arg === "--env") {
      const assignment = launcherArgs[++index] ?? "";
      const equals = assignment.indexOf("=");
      if (equals <= 0) throw new Error("--env requires KEY=VALUE");
      env[assignment.slice(0, equals)] = assignment.slice(equals + 1);
      continue;
    }
    throw new Error(`unknown local test launcher option: ${arg}`);
  }
  await runLocalTestCommand(command, { cwd, env });
}
