/**
 * runtime/single-instance.ts – workspace-scoped runtime lock.
 *
 * Prevents accidental second Piclaw runtimes from opening the same live state
 * and running startup recovery while the managed service is still active.
 */

import { constants, closeSync, existsSync, mkdirSync, openSync, readFileSync, rmSync, writeSync } from "fs";
import { dirname, resolve } from "path";
import { STORE_DIR, WORKSPACE_DIR } from "../core/config.js";

export interface RuntimeLockRecord {
  pid: number;
  startedAt: string;
  workspace: string;
  command: string;
  kind?: 'maintenance';
}

export interface RuntimeProcessInspector {
  pid: number;
  now(): Date;
  isAlive(pid: number): boolean;
  commandLine(pid: number): string | null;
}

export interface RuntimeLockHandle {
  path: string;
  record: RuntimeLockRecord;
  release(): void;
}

export interface AcquireRuntimeLockOptions {
  lockPath?: string;
  inspector?: RuntimeProcessInspector;
  disabled?: boolean;
  /** Maintenance refuses malformed locks and every live owner, without command-line heuristics. */
  maintenance?: boolean;
}

const DEFAULT_LOCK_FILE = "runtime.lock";
const DISABLE_LOCK_ENV = "PICLAW_DISABLE_RUNTIME_LOCK";

function isRuntimeLockDisabled(): boolean {
  return ["1", "true", "yes", "on"].includes(String(process.env[DISABLE_LOCK_ENV] || "").trim().toLowerCase());
}

export function getDefaultRuntimeLockPath(): string {
  return resolve(STORE_DIR, DEFAULT_LOCK_FILE);
}

function defaultCommandLine(pid: number): string | null {
  try {
    return readFileSync(`/proc/${pid}/cmdline`, "utf8").replace(/\0/g, " ").trim() || null;
  } catch {
    return null;
  }
}

export function createDefaultRuntimeProcessInspector(): RuntimeProcessInspector {
  return {
    pid: process.pid,
    now: () => new Date(),
    isAlive(pid: number): boolean {
      if (!Number.isFinite(pid) || pid <= 0) return false;
      try {
        process.kill(pid, 0);
        return true;
      } catch (error) {
        const code = (error as NodeJS.ErrnoException)?.code;
        return code === "EPERM";
      }
    },
    commandLine: defaultCommandLine,
  };
}

function parseRuntimeLockRecord(raw: string): RuntimeLockRecord | null {
  try {
    const parsed = JSON.parse(raw) as Partial<RuntimeLockRecord>;
    const pid = Number(parsed.pid);
    if (!Number.isFinite(pid) || pid <= 0) return null;
    return {
      pid,
      startedAt: typeof parsed.startedAt === "string" ? parsed.startedAt : "",
      workspace: typeof parsed.workspace === "string" ? parsed.workspace : "",
      command: typeof parsed.command === "string" ? parsed.command : "",
      ...(parsed.kind === 'maintenance' ? { kind: 'maintenance' as const } : {}),
    };
  } catch {
    return null;
  }
}

function readRuntimeLockRecord(lockPath: string): RuntimeLockRecord | null {
  try {
    return parseRuntimeLockRecord(readFileSync(lockPath, "utf8"));
  } catch {
    return null;
  }
}

function commandLooksLikePiclawRuntime(command: string | null): boolean {
  if (!command) return true;
  return /(?:^|[\s/])(?:piclaw|run-piclaw\.sh)(?:\s|$)|runtime\/src\/index\.ts|node_modules\/piclaw\/runtime\/src\/index\.ts/i.test(command);
}

function isActiveRuntimeOwner(record: RuntimeLockRecord | null, inspector: RuntimeProcessInspector): boolean {
  if (!record) return false;
  if (!inspector.isAlive(record.pid)) return false;
  if (record.kind === 'maintenance') return true;
  const command = inspector.commandLine(record.pid);
  return commandLooksLikePiclawRuntime(command);
}

function createRuntimeLockRecord(inspector: RuntimeProcessInspector): RuntimeLockRecord {
  return {
    pid: inspector.pid,
    startedAt: inspector.now().toISOString(),
    workspace: WORKSPACE_DIR,
    command: process.argv.join(" "),
  };
}

function writeNewLockFile(lockPath: string, record: RuntimeLockRecord): void {
  mkdirSync(dirname(lockPath), { recursive: true });
  const fd = openSync(lockPath, constants.O_CREAT | constants.O_EXCL | constants.O_WRONLY, 0o600);
  try {
    writeSync(fd, `${JSON.stringify(record, null, 2)}\n`);
  } finally {
    closeSync(fd);
  }
}

function lockError(lockPath: string, record: RuntimeLockRecord | null): Error {
  const owner = record ? `pid ${record.pid}${record.startedAt ? ` since ${record.startedAt}` : ""}` : "another process";
  return new Error(
    `Piclaw is already running for this workspace (${owner}); refusing to start a second runtime with lock ${lockPath}.`,
  );
}

export function acquireRuntimeLock(options: AcquireRuntimeLockOptions = {}): RuntimeLockHandle {
  const disabled = options.disabled ?? isRuntimeLockDisabled();
  const lockPath = options.lockPath ?? getDefaultRuntimeLockPath();
  const inspector = options.inspector ?? createDefaultRuntimeProcessInspector();
  const record = createRuntimeLockRecord(inspector);
  if (options.maintenance) record.kind = 'maintenance';

  if (disabled) {
    return {
      path: lockPath,
      record,
      release() {},
    };
  }

  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      writeNewLockFile(lockPath, record);
      let released = false;
      const release = (): void => {
        if (released) return;
        released = true;
        const current = readRuntimeLockRecord(lockPath);
        if (current?.pid === record.pid) {
          rmSync(lockPath, { force: true });
        }
      };
      process.once("exit", release);
      return { path: lockPath, record, release };
    } catch (error) {
      const code = (error as NodeJS.ErrnoException)?.code;
      if (code !== "EEXIST") throw error;
      const existing = readRuntimeLockRecord(lockPath);
      if ((options.maintenance && (!existing || inspector.isAlive(existing.pid))) || isActiveRuntimeOwner(existing, inspector)) {
        throw lockError(lockPath, existing);
      }
      rmSync(lockPath, { force: true });
    }
  }

  if (existsSync(lockPath)) {
    throw lockError(lockPath, readRuntimeLockRecord(lockPath));
  }
  throw new Error(`Failed to acquire Piclaw runtime lock ${lockPath}.`);
}
