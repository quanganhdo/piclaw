import assert from "node:assert/strict";
import { closeSync, fsyncSync, openSync, renameSync, unlinkSync, writeFileSync } from "node:fs";
import { writeCredentialFileAtomic, type CredentialFileIO } from "../../../src/agent-pool/credential-file.js";
const [stage, path] = process.argv.slice(2);
assert.ok(stage && path);
const block = () => { writeFileSync(1, "blocked\n"); Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0); };
const io: CredentialFileIO = {
  open: openSync,
  write: (fd, bytes) => { if (stage === "partial") { writeFileSync(fd, bytes.slice(0, 9)); block(); } writeFileSync(fd, bytes); },
  sync: fsyncSync, close: closeSync, remove: unlinkSync,
  replace: (source, target) => { if (stage === "before-rename") block(); renameSync(source, target); if (stage === "after-rename") block(); },
};
writeCredentialFileAtomic(path, '{"provider":{"type":"oauth","refresh":"synthetic-new"}}\n', io);
throw new Error("Owned crash fixture unexpectedly completed");
