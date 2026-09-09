#!/usr/bin/env bun

import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
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

export async function runLocalTestCommand(
  argv: readonly string[],
  options: { readonly cwd?: string; readonly env?: Record<string, string | undefined> } = {},
): Promise<never> {
  const env = { ...process.env, ...(options.env ?? {}) };
  const isolation = ensureTestFilesystemIsolation(env);
  let plan: LocalTestPriorityPlan;
  try {
    assertTestWorkspaceArguments(argv, env);
    plan = planLocalTestCommand(argv, env);
  } catch (error) {
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
      stderr: "inherit",
      detached: false,
    });
  } catch (error) {
    if (isolation.createdRoot) isolation.cleanup();
    process.stderr.write(`[local-test-priority] failed to start test command: ${error instanceof Error ? error.message : String(error)}\n`);
    process.exit(127);
  }

  const signals = ["SIGINT", "SIGTERM", "SIGHUP"] as const;
  const forward = (signal: typeof signals[number]) => {
    if (child.exitCode !== null) return;
    if (plan.applied) {
      const signum = signal === "SIGINT" ? 2 : signal === "SIGHUP" ? 1 : 15;
      const result = spawnSync("kill", [`-${signum}`, `-${child.pid}`], { stdio: "ignore" });
      if (result.status === 0) return;
    }
    child.kill(signal);
  };
  for (const signal of signals) process.on(signal, forward);
  const exitCode = await child.exited;
  for (const signal of signals) process.off(signal, forward);
  if (plan.applied) {
    spawnSync("kill", ["-KILL", `-${child.pid}`], { stdio: "ignore" });
  }
  if (isolation.createdRoot) isolation.cleanup();
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
