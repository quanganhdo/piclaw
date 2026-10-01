import { expect, test } from "bun:test";
import { closeSync, fsyncSync, openSync, readFileSync, readdirSync, renameSync, statSync, unlinkSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { CredentialFileCommitError, type CredentialFileIO, writeCredentialFileAtomic } from "../../src/agent-pool/credential-file.js";
import { createTempWorkspace } from "../helpers.js";
import { FileCredentialStore } from "../../src/agent-pool/credential-store.js";
import { addLogSink, removeLogSink, type LogRecord } from "../../src/utils/logger.js";

test("directory-sync failure reports a committed store value without raw diagnostics or rollback", async () => {
  const ws = createTempWorkspace("atomic-credential-commit-");
  const path = join(ws.base, "agent", "auth.json");
  const seed = new FileCredentialStore(path);
  await seed.modify("provider", async () => ({ type: "oauth", access: "old", refresh: "old", expires: 1 }));
  let directoryFd = -1;
  const io: CredentialFileIO = {
    open: (name, flags, mode) => { const fd = openSync(name, flags, mode); if (flags === "r") directoryFd = fd; return fd; },
    write: (fd, bytes) => writeFileSync(fd, bytes), sync: fd => { if (fd === directoryFd) throw new Error("SENTINEL-dir-sync-secret"); fsyncSync(fd); },
    close: closeSync, replace: renameSync, remove: unlinkSync,
  };
  const logs: LogRecord[] = [], sink = (record: LogRecord) => logs.push(record);
  addLogSink(sink);
  try {
    const store = new FileCredentialStore(path, {}, io);
    const current = await store.modify("provider", async () => ({ type: "oauth", access: "new", refresh: "rotated", expires: Date.now() + 3_600_000 }));
    expect(current).toMatchObject({ access: "new", refresh: "rotated" });
    expect(await seed.read("provider")).toEqual(current);
    if (process.platform !== "win32") expect(store.drainErrors()[0]).toBeInstanceOf(CredentialFileCommitError);
    expect(JSON.stringify(logs)).not.toContain("SENTINEL");
  } finally { removeLogSink(sink); ws.cleanup(); }
});

const oldBytes = '{"provider":{"type":"oauth","refresh":"synthetic-old"}}\n';
const newBytes = '{"provider":{"type":"oauth","refresh":"synthetic-new"}}\n';
for (const stage of ["none", "open", "write", "sync", "close", "close-before", "replace", "directory-sync", "cleanup"]) {
  test(`atomic credential file: ${stage}`, () => {
    const ws = createTempWorkspace("atomic-credential-");
    const path = join(ws.base, "auth.json");
    writeFileSync(path, oldBytes, { mode: 0o600 });
    const events: string[] = [], descriptors = new Set<number>();
    let tempFd = -1;
    let closedFailure = false;
    const fail = () => { throw new Error("SENTINEL-secret-filesystem-diagnostic"); };
    const io: CredentialFileIO = {
      open: (name, flags, mode) => {
        events.push(flags === "wx" ? "open-temp" : "open-directory");
        if (stage === "open" && flags === "wx") fail();
        const fd = openSync(name, flags, mode); descriptors.add(fd);
        if (flags === "wx") { tempFd = fd; expect(statSync(name).mode & 0o777).toBe(0o600); }
        return fd;
      },
      write: (fd, bytes) => {
        events.push("write");
        expect(readFileSync(path, "utf8")).toBe(oldBytes);
        if (stage === "write" || stage === "cleanup") { writeFileSync(fd, bytes.slice(0, 7)); fail(); }
        writeFileSync(fd, bytes);
      },
      sync: fd => {
        events.push(fd === tempFd ? "sync-temp" : "sync-directory");
        if (stage === "sync" && fd === tempFd || stage === "directory-sync" && fd !== tempFd) fail();
        fsyncSync(fd);
      },
      close: fd => {
        const wasTemp = fd === tempFd;
        if (stage === "close-before" && wasTemp && !closedFailure) { closedFailure = true; fail(); }
        closeSync(fd); descriptors.delete(fd);
        events.push(wasTemp ? "close-temp" : "close-directory");
        if (wasTemp) tempFd = -1;
        if (stage === "close" && wasTemp && !closedFailure) { closedFailure = true; fail(); }
      },
      replace: (source, target) => {
        events.push("replace");
        expect(readFileSync(path, "utf8")).toBe(oldBytes);
        expect(readFileSync(source, "utf8")).toBe(newBytes);
        if (stage === "replace") fail();
        renameSync(source, target);
      },
      remove: name => { events.push("remove-temp"); if (stage === "cleanup") fail(); unlinkSync(name); },
    };
    try {
      if (stage === "none") {
        writeCredentialFileAtomic(path, newBytes, io);
        expect(events).toEqual(process.platform === "win32"
          ? ["open-temp", "write", "sync-temp", "close-temp", "replace"]
          : ["open-temp", "write", "sync-temp", "close-temp", "replace", "open-directory", "sync-directory", "close-directory"]);
      } else if (stage === "directory-sync" && process.platform === "win32") {
        writeCredentialFileAtomic(path, newBytes, io);
      } else {
        let caught: unknown;
        try { writeCredentialFileAtomic(path, newBytes, io); } catch (error) { caught = error; }
        expect(caught).toBeInstanceOf(stage === "directory-sync" ? CredentialFileCommitError : Error);
        expect(String(caught)).not.toContain("SENTINEL");
      }
      expect(readFileSync(path, "utf8")).toBe(stage === "none" || stage === "directory-sync" ? newBytes : oldBytes);
      expect(statSync(path).mode & 0o777).toBe(0o600);
      const staging = readdirSync(ws.base).filter(name => name.startsWith("auth.json.") && name.endsWith(".tmp"));
      expect(staging).toHaveLength(stage === "cleanup" ? 1 : 0);
      if (stage === "cleanup") expect(statSync(join(ws.base, staging[0])).mode & 0o777).toBe(0o600);
      expect(descriptors.size).toBe(0);
    } finally { for (const fd of descriptors) closeSync(fd); ws.cleanup(); }
  });
}
