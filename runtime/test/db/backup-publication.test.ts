import Database from "bun:sqlite";
import { afterEach, expect, spyOn, test } from "bun:test";
import * as fs from "node:fs";
import { tmpdir } from "node:os";
import { basename, dirname, join, resolve } from "node:path";

import { createVerifiedSqliteBackup, verifySqliteBackup } from "../../src/db/backup.js";

// Only disposable file databases: the per-file preload supplies the isolated TMPDIR.
const roots: string[] = [];
const connections: Database[] = [];
const restores: Array<() => void> = [];
afterEach(() => {
  for (const restore of restores.splice(0).reverse()) restore();
  for (const database of connections.splice(0).reverse()) database.close();
  for (const root of roots.splice(0)) fs.rmSync(root, { recursive: true, force: true });
});

function open(path: string): Database {
  const database = new Database(path);
  connections.push(database);
  return database;
}

function fixture() {
  const root = fs.mkdtempSync(join(tmpdir(), "piclaw-backup-publication-"));
  roots.push(root);
  const sourcePath = join(root, "source.db");
  const parent = join(root, "backups");
  fs.mkdirSync(parent);
  const destination = join(parent, "snapshot.db");
  const source = open(sourcePath);
  source.exec(`
    PRAGMA journal_mode=WAL;
    PRAGMA application_id=1703;
    PRAGMA user_version=7;
    CREATE TABLE messages(id INTEGER PRIMARY KEY, content TEXT NOT NULL);
    INSERT INTO messages VALUES (1, 'outer'), (2, 'committed WAL');
  `);
  // A sibling must survive every cleanup path, including recursive staging cleanup.
  fs.writeFileSync(join(parent, "keep.txt"), "unrelated sibling");
  return { root, sourcePath, parent, destination, source };
}

type Fixture = ReturnType<typeof fixture>;
type CaptureHook = (path: string) => void;

// Intercept the real statement, not a fake VACUUM. One-shot hooks allow a nested
// backup to finish synchronously while the outer backup is between preflight and capture.
function aroundCapture(source: Database, before?: CaptureHook, after?: CaptureHook) {
  const prepare = source.prepare.bind(source);
  let intercepted = false;
  const spy = spyOn(source, "prepare").mockImplementation(((sql: string, ...args: unknown[]) => {
    const statement = Reflect.apply(prepare, source, [sql, ...args]);
    if (!intercepted && /^\s*VACUUM\s+INTO\b/i.test(sql)) {
      intercepted = true;
      const run = statement.run.bind(statement);
      const runSpy = spyOn(statement, "run").mockImplementation(((...bindings: unknown[]) => {
        const path = String(bindings[0]);
        before?.(path);
        const result = Reflect.apply(run, statement, bindings);
        after?.(path);
        return result;
      }) as typeof statement.run);
      restores.push(() => runSpy.mockRestore());
    }
    return statement;
  }) as typeof source.prepare);
  restores.push(() => spy.mockRestore());
  return () => intercepted;
}

function attempt(f: Fixture) {
  try {
    return { manifest: createVerifiedSqliteBackup(f.source, f.sourcePath, f.destination), error: undefined };
  } catch (error) {
    return { manifest: undefined, error };
  }
}

function expectParent(f: Fixture, published = false) {
  expect(fs.readdirSync(f.parent).sort()).toEqual(published ? ["keep.txt", "snapshot.db"] : ["keep.txt"]);
  expect(fs.readFileSync(join(f.parent, "keep.txt"), "utf8")).toBe("unrelated sibling");
}

function contents(path: string) {
  const database = new Database(path, { readonly: true });
  try {
    return database.query("SELECT content FROM messages ORDER BY id").all();
  } finally {
    database.close();
  }
}

function expectSnapshotManifest(manifest: ReturnType<typeof createVerifiedSqliteBackup>, path: string) {
  const verified = verifySqliteBackup(path);
  for (const [key, value] of Object.entries(verified)) {
    expect((manifest as unknown as Record<string, unknown>)[key], key).toEqual(value);
  }
  expect(manifest.integrityCheck).toBe("ok");
  expect(manifest.backupBytes).toBe(fs.statSync(path).size);
}

type LedgerMap = Record<string, { rowCount: number; sha256: string }>;
function ledgers(value: object): LedgerMap {
  // Keep the new contract testable against the old implementation too.
  const result = (value as { migrationLedgers?: LedgerMap }).migrationLedgers;
  expect(result).toBeDefined();
  return result!;
}

const ledgerNames = ["durable_schema", "durable_metadata", "piclaw_schema_migrations", "core_schema_migrations"] as const;
function seedLedgers(database: Database) {
  database.exec(`
    CREATE TABLE durable_schema(version INTEGER PRIMARY KEY, applied_at TEXT NOT NULL);
    INSERT INTO durable_schema VALUES (1, '2026-01-01');
    CREATE TABLE durable_metadata(key TEXT PRIMARY KEY, value TEXT NOT NULL);
    INSERT INTO durable_metadata VALUES ('engine', 'before');
    CREATE TABLE piclaw_schema_migrations(
      owner TEXT NOT NULL, id TEXT NOT NULL, migration_order INTEGER NOT NULL,
      checksum TEXT NOT NULL, applied_at TEXT NOT NULL, PRIMARY KEY(owner, id)
    ) WITHOUT ROWID;
    INSERT INTO piclaw_schema_migrations VALUES ('piclaw.core', '001', 1, 'before', '2026-01-01');
    CREATE TABLE core_schema_migrations(name TEXT PRIMARY KEY, applied_at TEXT NOT NULL);
    INSERT INTO core_schema_migrations VALUES ('001', '2026-01-01');
  `);
}

function mutateSchemaAndLedgers(database: Database) {
  database.exec(`
    BEGIN IMMEDIATE;
    PRAGMA application_id=1704;
    PRAGMA user_version=8;
    CREATE TABLE added(id INTEGER PRIMARY KEY, content TEXT);
    CREATE INDEX added_content ON added(content);
    CREATE VIEW added_view AS SELECT * FROM added;
    CREATE TRIGGER added_trigger AFTER INSERT ON added BEGIN UPDATE added SET content='triggered' WHERE id=new.id; END;
    INSERT INTO durable_schema VALUES (2, '2026-02-01');
    UPDATE durable_metadata SET value='after';
    UPDATE piclaw_schema_migrations SET checksum='after';
    INSERT INTO core_schema_migrations VALUES ('002', '2026-02-01');
    COMMIT;
  `);
}

test("capture uses a private same-parent directory and an exclusive 0600 staging file, then publishes a verified inode", () => {
  const f = fixture();
  let staged = "";
  let linked = false;
  const intercepted = aroundCapture(f.source, (path) => {
    staged = resolve(path);
    expect(staged).not.toBe(f.destination);
    expect(dirname(dirname(staged))).toBe(f.parent);
    expect(fs.statSync(dirname(staged)).mode & 0o777).toBe(0o700);
    expect(fs.statSync(staged).mode & 0o777).toBe(0o600);
    expect(fs.statSync(staged).size).toBe(0);
    expect(fs.existsSync(f.destination)).toBe(false);
  });
  const link = fs.linkSync;
  const spy = spyOn(fs, "linkSync").mockImplementation((from, to) => {
    expect(resolve(String(from))).toBe(staged);
    expect(resolve(String(to))).toBe(f.destination);
    expect(verifySqliteBackup(String(from)).integrityCheck).toBe("ok");
    expect(fs.existsSync(f.destination)).toBe(false);
    link(from, to);
    expect(fs.statSync(String(from)).ino).toBe(fs.statSync(String(to)).ino);
    linked = true;
  });
  restores.push(() => spy.mockRestore());
  const manifest = createVerifiedSqliteBackup(f.source, f.sourcePath, f.destination);
  expect(intercepted()).toBe(true);
  expect(linked).toBe(true);
  expect(fs.existsSync(staged)).toBe(false);
  expectSnapshotManifest(manifest, f.destination);
  expect(contents(f.destination)).toEqual([{ content: "outer" }, { content: "committed WAL" }]);
  expect(fs.statSync(f.destination).mode & 0o777).toBe(0o600);
  expectParent(f, true);
  expect(f.source.query("SELECT count(*) AS n FROM messages").get()).toEqual({ n: 2 });
});

test("a non-SQLite destination appearing after preflight remains byte-identical", () => {
  const f = fixture();
  const bytes = Buffer.from("unrelated destination\0\xffdo not remove", "utf8");
  const intercepted = aroundCapture(f.source, () => fs.writeFileSync(f.destination, bytes));
  const result = attempt(f);
  expect(intercepted()).toBe(true);
  expect(result.error).toBeDefined();
  expect(fs.existsSync(f.destination)).toBe(true);
  expect(fs.readFileSync(f.destination)).toEqual(bytes);
  expectParent(f, true);
});

test("an empty destination appearing after preflight is not used as VACUUM output", () => {
  const f = fixture();
  let inode: number | undefined;
  aroundCapture(f.source, () => {
    fs.writeFileSync(f.destination, "", { flag: "wx" });
    inode = fs.statSync(f.destination).ino;
  });
  const result = attempt(f);
  expect(inode).toBeDefined();
  expect(result.error).toBeDefined();
  expect(fs.existsSync(f.destination)).toBe(true);
  expect(fs.readFileSync(f.destination)).toEqual(Buffer.alloc(0));
  expect(fs.statSync(f.destination).ino).toBe(inode!);
  expectParent(f, true);
});

test("a reentrant same-destination SQLite backup wins during the outer capture", () => {
  const f = fixture();
  const winnerPath = join(f.root, "winner.db");
  const winner = open(winnerPath);
  winner.exec("CREATE TABLE messages(id INTEGER PRIMARY KEY, content TEXT); INSERT INTO messages VALUES (1, 'inner winner')");
  let winnerBytes: Buffer | undefined;
  let winnerInode: number | undefined;
  const intercepted = aroundCapture(f.source, () => {
    createVerifiedSqliteBackup(winner, winnerPath, f.destination);
    winnerBytes = fs.readFileSync(f.destination);
    winnerInode = fs.statSync(f.destination).ino;
  });
  const result = attempt(f);
  expect(intercepted()).toBe(true);
  expect(winnerBytes).toBeDefined();
  expect(result.error).toBeDefined();
  expect(fs.existsSync(f.destination)).toBe(true);
  expect(fs.readFileSync(f.destination)).toEqual(winnerBytes!);
  expect(fs.statSync(f.destination).ino).toBe(winnerInode!);
  expect(contents(f.destination)).toEqual([{ content: "inner winner" }]);
  expectParent(f, true);
});

test("a separate process can win the same destination before the outer capture", () => {
  const f = fixture();
  const winnerPath = join(f.root, "child-source.db");
  const winner = open(winnerPath);
  winner.exec("CREATE TABLE messages(id INTEGER PRIMARY KEY, content TEXT); INSERT INTO messages VALUES (1, 'process winner')");
  let winnerBytes: Buffer | undefined;
  aroundCapture(f.source, () => {
    const child = Bun.spawnSync([process.execPath, "--no-env-file", "--eval", `
      import Database from 'bun:sqlite';
      import { createVerifiedSqliteBackup } from ${JSON.stringify(new URL("../../src/db/backup.ts", import.meta.url).pathname)};
      const source = new Database(${JSON.stringify(winnerPath)});
      try { createVerifiedSqliteBackup(source, ${JSON.stringify(winnerPath)}, ${JSON.stringify(f.destination)}); }
      finally { source.close(); }
    `], { env: { ...process.env }, timeout: 10000, stdout: "pipe", stderr: "pipe" });
    expect(child.exitCode, child.stderr.toString()).toBe(0);
    winnerBytes = fs.readFileSync(f.destination);
  });
  const result = attempt(f);
  expect(winnerBytes).toBeDefined();
  expect(result.error).toBeDefined();
  expect(fs.existsSync(f.destination)).toBe(true);
  expect(fs.readFileSync(f.destination)).toEqual(winnerBytes!);
  expect(contents(f.destination)).toEqual([{ content: "process winner" }]);
  expectParent(f, true);
}, 15000);

for (const phase of ["capture", "verification", "publication"] as const) {
  for (const contender of [false, true]) {
    test(`${phase} failure removes only owned staging${contender ? " and preserves a late destination" : ""}`, () => {
      const f = fixture();
      const bytes = Buffer.from(`unrelated ${phase} winner`);
      let reached = false;
      let staged = "";
      const fail = () => {
        reached = true;
        if (contender) fs.writeFileSync(f.destination, bytes);
      };
      aroundCapture(f.source, (path) => {
        staged = path;
        if (phase === "capture") {
          fail();
          throw new Error("injected capture failure");
        }
      }, (path) => {
        if (phase === "verification") {
          fail();
          fs.writeFileSync(path, "not a SQLite database");
        }
      });
      if (phase === "publication") {
        const spy = spyOn(fs, "linkSync").mockImplementation(() => {
          fail();
          throw Object.assign(new Error("injected publication failure"), { code: "EACCES" });
        });
        restores.push(() => spy.mockRestore());
      }
      const result = attempt(f);
      expect(reached).toBe(true);
      expect(result.error).toBeDefined();
      if (contender) {
        expect(fs.existsSync(f.destination)).toBe(true);
        expect(fs.readFileSync(f.destination)).toEqual(bytes);
      } else {
        expect(fs.existsSync(f.destination)).toBe(false);
      }
      if (resolve(staged) !== f.destination) expect(fs.existsSync(staged)).toBe(false);
      expectParent(f, contender);
      expect(f.source.query("SELECT count(*) AS n FROM messages").get()).toEqual({ n: 2 });
    });
  }
}

test("a destination created at the publication boundary is never clobbered", () => {
  const f = fixture();
  const bytes = Buffer.from("last-instant destination");
  const link = fs.linkSync;
  let reached = false;
  const spy = spyOn(fs, "linkSync").mockImplementation((from, to) => {
    reached = true;
    fs.writeFileSync(f.destination, bytes);
    link(from, to); // Real EEXIST from the filesystem, not a synthetic failure.
  });
  restores.push(() => spy.mockRestore());
  const result = attempt(f);
  expect(reached).toBe(true);
  expect(result.error).toBeDefined();
  expect(fs.existsSync(f.destination)).toBe(true);
  expect(fs.readFileSync(f.destination)).toEqual(bytes);
  expectParent(f, true);
});

for (const kind of ["wrong main path", "missing main path", "malformed main path", "memory connection"] as const) {
  test(`source validation rejects ${kind} without publication`, () => {
    const f = fixture();
    let sourcePath = join(f.root, "other.db");
    let source = f.source;
    if (kind === "wrong main path") {
      open(sourcePath).exec("CREATE TABLE unrelated(id INTEGER)");
    } else if (kind === "malformed main path") {
      fs.writeFileSync(sourcePath, "not SQLite");
    } else if (kind === "memory connection") {
      source = open(":memory:");
      source.exec("CREATE TABLE messages(id INTEGER)");
      sourcePath = f.sourcePath;
    }
    expect(() => createVerifiedSqliteBackup(source, sourcePath, f.destination)).toThrow();
    expect(fs.existsSync(f.destination)).toBe(false);
    expectParent(f);
  });
}

for (const when of ["before backup", "before capture", "after capture"] as const) {
  test(`a source inode replaced ${when} never publishes a snapshot of the detached connection`, () => {
    const f = fixture();
    const replacement = join(f.root, "replacement.db");
    open(replacement).exec("CREATE TABLE replacement(id INTEGER); INSERT INTO replacement VALUES (42)");
    const replace = () => {
      fs.renameSync(f.sourcePath, join(f.root, "detached.db"));
      fs.renameSync(replacement, f.sourcePath);
    };
    if (when === "before backup") replace();
    else aroundCapture(f.source, when === "before capture" ? replace : undefined, when === "after capture" ? replace : undefined);
    const result = attempt(f);
    expect(result.error).toBeDefined();
    expect(fs.existsSync(f.destination)).toBe(false);
    expectParent(f);
  });
}

test("source identity is rechecked after staged verification, before publication", () => {
  const f = fixture();
  const replacement = join(f.root, "replacement.db");
  open(replacement).exec("CREATE TABLE replacement(id INTEGER)");
  let staged = "";
  let replaced = false;
  aroundCapture(f.source, undefined, (path) => { staged = resolve(path); });
  const stat = fs.statSync;
  const spy = spyOn(fs, "statSync").mockImplementation(((path: fs.PathLike, ...args: unknown[]) => {
    const result = Reflect.apply(stat, fs, [path, ...args]);
    // The verifier obtains the staged file's byte size after integrity_check.
    // This race occurs later than the post-VACUUM source check.
    if (!replaced && staged && resolve(String(path)) === staged) {
      replaced = true;
      fs.renameSync(f.sourcePath, join(f.root, "detached.db"));
      fs.renameSync(replacement, f.sourcePath);
    }
    return result;
  }) as typeof fs.statSync);
  restores.push(() => spy.mockRestore());
  const result = attempt(f);
  expect(replaced).toBe(true);
  expect(result.error).toBeDefined();
  expect(fs.existsSync(f.destination)).toBe(false);
  expectParent(f);
});

test("a connection opened on a malformed SQLite file never publishes", () => {
  const f = fixture();
  const malformed = join(f.root, "malformed.db");
  fs.writeFileSync(malformed, "not a SQLite database");
  const source = open(malformed);
  expect(() => createVerifiedSqliteBackup(source, malformed, f.destination)).toThrow();
  expect(fs.readFileSync(malformed, "utf8")).toBe("not a SQLite database");
  expect(fs.existsSync(f.destination)).toBe(false);
  expectParent(f);
});

test("an attached database path is not accepted as the connection's main database", () => {
  const f = fixture();
  const attached = join(f.root, "attached.db");
  f.source.prepare("ATTACH DATABASE ? AS other").run(attached);
  f.source.exec("CREATE TABLE other.unrelated(id INTEGER)");
  expect(() => createVerifiedSqliteBackup(f.source, attached, f.destination)).toThrow();
  expect(fs.existsSync(f.destination)).toBe(false);
  expectParent(f);
});

test("manifest includes snapshot migration-ledger row counts and SHA-256 fingerprints, omitting absent ledgers", () => {
  const f = fixture();
  const empty = createVerifiedSqliteBackup(f.source, f.sourcePath, f.destination);
  expect(ledgers(empty)).toEqual({});
  fs.unlinkSync(f.destination);
  seedLedgers(f.source);
  const manifest = createVerifiedSqliteBackup(f.source, f.sourcePath, f.destination);
  const map = ledgers(manifest);
  expect(Object.keys(map).sort()).toEqual([...ledgerNames].sort());
  for (const name of ledgerNames) {
    expect(map[name].rowCount).toBe(1);
    expect(map[name].sha256).toMatch(/^[a-f0-9]{64}$/);
  }
  expect(map).toEqual(ledgers(verifySqliteBackup(f.destination)));
  expectSnapshotManifest(manifest, f.destination);
  expectParent(f, true);
});

for (const when of ["before capture", "after capture"] as const) {
  test(`concurrent schema and ledger commits ${when} yield verified snapshot metadata or explicit failure`, () => {
    const f = fixture();
    seedLedgers(f.source);
    const writer = open(f.sourcePath);
    const mutate = () => mutateSchemaAndLedgers(writer);
    const intercepted = aroundCapture(f.source, when === "before capture" ? mutate : undefined, when === "after capture" ? mutate : undefined);
    const result = attempt(f);
    expect(intercepted()).toBe(true);
    if (result.error !== undefined) {
      expect(fs.existsSync(f.destination)).toBe(false);
      expectParent(f);
      return;
    }
    const manifest = result.manifest!;
    expectSnapshotManifest(manifest, f.destination);
    const changed = when === "before capture";
    expect(manifest.applicationId).toBe(changed ? 1704 : 1703);
    expect(manifest.userVersion).toBe(changed ? 8 : 7);
    expect(manifest.tableCount).toBe(changed ? 6 : 5);
    expect(manifest.triggerCount).toBe(changed ? 1 : 0);
    expect(manifest.viewCount).toBe(changed ? 1 : 0);
    const map = ledgers(manifest);
    expect(map).toEqual(ledgers(verifySqliteBackup(f.destination)));
    expect(map.durable_schema.rowCount).toBe(changed ? 2 : 1);
    expect(map.core_schema_migrations.rowCount).toBe(changed ? 2 : 1);
    expect(map.durable_metadata.rowCount).toBe(1);
    expect(map.piclaw_schema_migrations.rowCount).toBe(1);
    expectParent(f, true);
  });
}

test("ledger fingerprints detect same-row-count content changes without changing the earlier snapshot", () => {
  const f = fixture();
  seedLedgers(f.source);
  const first = createVerifiedSqliteBackup(f.source, f.sourcePath, f.destination);
  const original = fs.readFileSync(f.destination);
  f.source.exec(`
    UPDATE durable_schema SET applied_at='changed';
    UPDATE durable_metadata SET value='changed';
    UPDATE piclaw_schema_migrations SET checksum='changed';
    UPDATE core_schema_migrations SET applied_at='changed';
  `);
  const nextPath = join(f.parent, "next.db");
  const second = createVerifiedSqliteBackup(f.source, f.sourcePath, nextPath);
  for (const name of ledgerNames) {
    expect(ledgers(first)[name].rowCount).toBe(1);
    expect(ledgers(second)[name].rowCount).toBe(1);
    expect(ledgers(first)[name].sha256).not.toBe(ledgers(second)[name].sha256);
  }
  expect(ledgers(first)).toEqual(ledgers(verifySqliteBackup(f.destination)));
  expect(ledgers(second)).toEqual(ledgers(verifySqliteBackup(nextPath)));
  expect(fs.readFileSync(f.destination)).toEqual(original);
  expect(fs.readdirSync(f.parent).sort()).toEqual(["keep.txt", basename(nextPath), "snapshot.db"]);
});

for (const phase of ["file sync", "directory sync"] as const) {
  test(`${phase} failure preserves any published backup and cleans staging only`, () => {
    const f = fixture();
    const sync = fs.fsyncSync;
    let reached = false;
    const spy = spyOn(fs, "fsyncSync").mockImplementation(fd => {
      if (fs.fstatSync(fd).isDirectory() === (phase === "directory sync")) {
        reached = true;
        throw new Error("injected sync failure");
      }
      sync(fd);
    });
    restores.push(() => spy.mockRestore());
    const result = attempt(f);
    expect(reached).toBe(true);
    expect(result.error).toBeDefined();
    const published = phase === "directory sync";
    expect(fs.existsSync(f.destination)).toBe(published);
    if (published) {
      expect(verifySqliteBackup(f.destination).integrityCheck).toBe("ok");
      expect(contents(f.destination)).toEqual([{ content: "outer" }, { content: "committed WAL" }]);
    }
    expectParent(f, published);
  });
}

test("failed backup leaves the caller's uncommitted transaction untouched", () => {
  const f = fixture();
  f.source.exec("BEGIN; INSERT INTO messages VALUES (3, 'uncommitted')");
  expect(attempt(f).error).toBeDefined();
  expect(f.source.inTransaction).toBe(true);
  expect(f.source.query("SELECT content FROM messages WHERE id=3").get()).toEqual({ content: "uncommitted" });
  expectParent(f);
  f.source.exec("ROLLBACK");
  expect(f.source.query("SELECT count(*) AS n FROM messages").get()).toEqual({ n: 2 });
});

test("ledger fingerprints preserve 64-bit integer and binary distinctions", () => {
  const f = fixture();
  f.source.exec("CREATE TABLE durable_metadata(value INTEGER, payload BLOB)");
  f.source.prepare("INSERT INTO durable_metadata VALUES (?,?)").run(9007199254740992n, new Uint8Array([0, 255, 1]));
  const first = createVerifiedSqliteBackup(f.source, f.sourcePath, f.destination);
  f.source.prepare("UPDATE durable_metadata SET value=?").run(9007199254740993n);
  const second = createVerifiedSqliteBackup(f.source, f.sourcePath, join(f.parent, "next.db"));
  expect(ledgers(first).durable_metadata.rowCount).toBe(1);
  expect(ledgers(second).durable_metadata.rowCount).toBe(1);
  expect(ledgers(first).durable_metadata.sha256).not.toBe(ledgers(second).durable_metadata.sha256);
  expect(ledgers(first)).toEqual(ledgers(verifySqliteBackup(f.destination)));
});

test("ledger fingerprints are independent of physical row insertion order", () => {
  const f = fixture();
  f.source.exec("CREATE TABLE durable_metadata(value TEXT); INSERT INTO durable_metadata VALUES ('B'),('A')");
  const first = createVerifiedSqliteBackup(f.source, f.sourcePath, f.destination);
  f.source.exec("DELETE FROM durable_metadata; INSERT INTO durable_metadata VALUES ('A'),('B')");
  const second = createVerifiedSqliteBackup(f.source, f.sourcePath, join(f.parent, "next.db"));
  expect(ledgers(first)).toEqual(ledgers(second));
  expect(ledgers(first).durable_metadata.rowCount).toBe(2);
});

test("a readonly source connection captures committed WAL without changing its transaction state", () => {
  const f = fixture();
  const readonly = new Database(f.sourcePath, { readonly: true, strict: true });
  connections.push(readonly);
  const manifest = createVerifiedSqliteBackup(readonly, f.sourcePath, f.destination);
  expect(manifest.integrityCheck).toBe("ok");
  expect(readonly.inTransaction).toBe(false);
  expect(contents(f.destination)).toEqual([{ content: "outer" }, { content: "committed WAL" }]);
  expectParent(f, true);
});

test("a substituted valid staging inode is rejected before publication", () => {
  const f = fixture();
  aroundCapture(f.source, undefined, path => {
    fs.renameSync(path, `${path}.owned`);
    const replacement = new Database(path);
    try { replacement.exec("CREATE TABLE unrelated(value TEXT); INSERT INTO unrelated VALUES ('replacement')"); }
    finally { replacement.close(); }
  });
  const result = attempt(f);
  expect(result.error).toBeDefined();
  expect(String(result.error)).toContain("staging identity changed");
  expect(fs.existsSync(f.destination)).toBe(false);
  expectParent(f);
});
