import { expect, test } from "bun:test";
import { Database } from "bun:sqlite";
import { existsSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { enableSqliteWal } from "../../src/db/sqlite-journal.js";
import { waitFor } from "../helpers.js";

function fixture(run: (db: Database) => void) {
  const root = mkdtempSync(join(tmpdir(), "sqlite-journal-"));
  const db = new Database(join(root, "test.db"));
  try { run(db); } finally { db.close(); rmSync(root, { recursive: true, force: true }); }
}

test("WAL transition restores the caller timeout and retains synchronous durability", () => fixture(db => {
  db.exec("PRAGMA busy_timeout=731; PRAGMA synchronous=FULL;");
  enableSqliteWal(db);
  expect(db.query("PRAGMA journal_mode").get()).toEqual({ journal_mode: "wal" });
  expect(db.query("PRAGMA synchronous").get()).toEqual({ synchronous: 2 });
  expect(db.query("PRAGMA busy_timeout").get()).toEqual({ timeout: 731 });
  enableSqliteWal(db);
  expect(db.query("PRAGMA busy_timeout").get()).toEqual({ timeout: 731 });
}));

test("WAL transition waits for a real other-process database lock", async () => {
  const root = mkdtempSync(join(tmpdir(), "sqlite-journal-lock-"));
  const path = join(root, "test.db"), ready = join(root, "ready"), release = join(root, "release");
  const db = new Database(path); db.exec("CREATE TABLE fixture(value TEXT); PRAGMA busy_timeout=5000;");
  const child = Bun.spawn([process.execPath, "--no-env-file", "-e", `import{Database}from'bun:sqlite';import{existsSync,writeFileSync}from'node:fs';const db=new Database(${JSON.stringify(path)});try{db.exec('BEGIN EXCLUSIVE');writeFileSync(${JSON.stringify(ready)},'ready');const end=Date.now()+10000;while(!existsSync(${JSON.stringify(release)})){if(Date.now()>end)throw Error('release missing');await Bun.sleep(5);}await Bun.sleep(100);db.exec('ROLLBACK');}finally{db.close()}`], { env: process.env, stdin: "ignore", stdout: "pipe", stderr: "pipe" });
  const completed = Promise.all([child.exited, new Response(child.stdout).text(), new Response(child.stderr).text()]);
  const timer = setTimeout(() => child.kill("SIGKILL"), 15000);
  try {
    await waitFor(() => existsSync(ready), 5000); writeFileSync(release, "go");
    enableSqliteWal(db);
    expect(db.query("PRAGMA journal_mode").get()).toEqual({ journal_mode: "wal" });
    expect(db.query("PRAGMA busy_timeout").get()).toEqual({ timeout: 5000 });
    const [exit, out, err] = await completed; expect({ exit, out, err }).toEqual({ exit: 0, out: "", err: "" });
  } finally { clearTimeout(timer); if (child.exitCode === null) child.kill("SIGKILL"); await completed; db.close(); rmSync(root, { recursive: true, force: true }); }
}, 18000);

test("persistent WAL contention stops at the bounded retry deadline", () => {
  const busy = Object.assign(new Error("persistent busy"), { code: "SQLITE_BUSY" });
  let attempts = 0; const calls: string[] = [];
  const db = { exec: (sql: string) => calls.push(sql), query: (sql: string) => ({ get: () => {
    if (sql === "PRAGMA busy_timeout") return { timeout: 5000 };
    attempts++; throw busy;
  } }) } as unknown as Database;
  expect(() => enableSqliteWal(db)).toThrow(busy);
  expect(attempts).toBeGreaterThan(1);
  expect(calls).toEqual(["PRAGMA busy_timeout = 0;", "PRAGMA busy_timeout = 5000;"]);
}, 7000);

test("WAL transition retries only busy and always restores timeout", () => {
  for (const mode of ["busy-then-wal", "io", "wrong-mode"] as const) {
    let attempts = 0; const exec: string[] = [];
    const error = Object.assign(new Error("fixture error"), { code: mode === "io" ? "SQLITE_IOERR" : "SQLITE_BUSY" });
    const db = { exec: (sql: string) => exec.push(sql), query: (sql: string) => ({ get: () => {
      if (sql === "PRAGMA busy_timeout") return { timeout: 555 };
      attempts++;
      if (mode === "io" || mode === "busy-then-wal" && attempts === 1) throw error;
      return { journal_mode: mode === "wrong-mode" ? "delete" : "wal" };
    } }) } as unknown as Database;
    if (mode === "busy-then-wal") { enableSqliteWal(db); expect(attempts).toBe(2); }
    else if (mode === "io") { expect(() => enableSqliteWal(db)).toThrow(error); expect(attempts).toBe(1); }
    else { expect(() => enableSqliteWal(db)).toThrow("did not enable WAL"); expect(attempts).toBe(1); }
    expect(exec).toEqual(["PRAGMA busy_timeout = 0;", "PRAGMA busy_timeout = 555;"]);
  }
});
