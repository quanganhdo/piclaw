import { constants, closeSync, fstatSync, lstatSync, openSync } from "node:fs";
import { dlopen, FFIType } from "bun:ffi";

let library: ReturnType<typeof dlopen<{ flock: { args: [FFIType.i32, FFIType.i32]; returns: FFIType.i32 } }>> | undefined;

/** Stable sidecar inode: the kernel releases this exclusion after SIGKILL too.
 * Never unlink it; replacing a flock inode would create two lock domains. */
export function acquireRuntimeLockGuard(path: string): { assertCurrent(): void; release(): void } | undefined {
  if (process.platform !== "linux") return undefined;
  library ??= dlopen("libc.so.6", { flock: { args: [FFIType.i32, FFIType.i32], returns: FFIType.i32 } });
  const flock = library.symbols.flock;
  const guardPath = path + ".guard";
  const fd = openSync(guardPath, constants.O_RDWR | constants.O_CREAT | constants.O_NOFOLLOW | constants.O_NONBLOCK, 0o600);
  let released = false;
  const identity = fstatSync(fd);
  const assertCurrent = () => {
    const current = lstatSync(guardPath);
    if (released || !identity.isFile() || !current.isFile() || current.dev !== identity.dev || current.ino !== identity.ino)
      throw Error("Runtime kernel lock identity changed");
  };
  try {
    if (!identity.isFile() || flock(fd, 2 | 4) !== 0) throw Error(`Piclaw refuses existing lock ${path}; another runtime may be already running. Offline operator cleanup required while kernel ownership is active.`);
    assertCurrent();
  } catch (error) { closeSync(fd); throw error; }
  return {
    assertCurrent,
    release() {
      if (released) return;
      released = true;
      try { flock(fd, 8); } finally { closeSync(fd); }
    },
  };
}
