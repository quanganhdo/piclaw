import { closeSync, fsyncSync, openSync, renameSync, unlinkSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { randomUUID } from "node:crypto";

/** App-owned file-I/O seam for disposable failure/crash fixtures. */
export interface CredentialFileIO {
  open(path: string, flags: string, mode?: number): number;
  write(fd: number, bytes: string): void;
  sync(fd: number): void;
  close(fd: number): void;
  replace(source: string, target: string): void;
  remove(path: string): void;
}
const nativeIO: CredentialFileIO = {
  open: openSync, write: (fd, bytes) => writeFileSync(fd, bytes, "utf8"),
  sync: fsyncSync, close: closeSync, replace: renameSync, remove: unlinkSync,
};

/** A same-directory replacement keeps readers on complete old or new JSON. */
export function writeCredentialFileAtomic(path: string, bytes: string, io: CredentialFileIO = nativeIO): void {
  const temp = `${path}.${process.pid}.${randomUUID()}.tmp`;
  let staged = false, committed = false, failed = false, cleanupFailed = false;
  let descriptor: number | undefined;
  try {
    descriptor = io.open(temp, "wx", 0o600);
    staged = true;
    io.write(descriptor, bytes);
    io.sync(descriptor);
    io.close(descriptor); descriptor = undefined;
    io.replace(temp, path); committed = true; staged = false;
    // Windows cannot open directories for fsync. Atomic visibility is used
    // there too, but directory-sync durability is not claimed.
    if (process.platform !== "win32") {
      descriptor = io.open(dirname(path), "r");
      io.sync(descriptor);
      io.close(descriptor); descriptor = undefined;
    }
  } catch { failed = true; }
  // Cleanup happens outside finally so it cannot obscure commit state or the
  // primary failure. Retry close before opening any other descriptor.
  if (descriptor !== undefined) {
    try { io.close(descriptor); }
    catch { cleanupFailed = true; }
  }
  if (staged) {
    try { io.remove(temp); }
    catch { cleanupFailed = true; }
  }
  if (failed || cleanupFailed) {
    if (committed) throw new CredentialFileCommitError();
    throw new Error(cleanupFailed
      ? "Credential file could not be replaced; staging cleanup also failed."
      : "Credential file could not be replaced.");
  }
}

/** Rename committed the new credential, but directory synchronization failed. */
export class CredentialFileCommitError extends Error {
  constructor() { super("Credential file was replaced, but directory synchronization failed."); this.name = "CredentialFileCommitError"; }
}
