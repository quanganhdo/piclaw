import { afterEach, beforeEach, expect, spyOn, test } from "bun:test";
import fs from "node:fs/promises";
import path from "node:path";
import { createTempWorkspace, setEnv } from "./helpers.js";
import { closeDatabase, getDb, initDatabase } from "../src/db/connection.js";
import {
  refreshWorkspaceIndex,
  getWorkspaceIndexStatus,
  searchWorkspace,
  setBackgroundWorkspaceIndexRefreshRequesterForTests,
} from "../src/workspace-search.js";
let ws: ReturnType<typeof createTempWorkspace>, restore: () => void;
beforeEach(async () => {
  ws = createTempWorkspace("search-correctness-");
  restore = setEnv({
    PICLAW_WORKSPACE: ws.workspace,
    PICLAW_STORE: ws.store,
    PICLAW_DATA: ws.data,
  });
  await fs.mkdir(path.join(ws.workspace, ".piclaw"), { recursive: true });
  await fs.writeFile(
    path.join(ws.workspace, ".piclaw/config.json"),
    JSON.stringify({
      domains: {
        access: { mode: "single-user" },
        tools: { workspaceSearchRoots: ["notes"] },
      },
    }),
  );
  await fs.mkdir(path.join(ws.workspace, "notes"), { recursive: true });
  closeDatabase();
  initDatabase();
  setBackgroundWorkspaceIndexRefreshRequesterForTests(() => {});
});
afterEach(() => {
  setBackgroundWorkspaceIndexRefreshRequesterForTests(null);
  closeDatabase();
  restore();
  ws.cleanup();
});
const file = (name: string) => path.join(ws.workspace, "notes", name);
const paths = async (query: string, params: Record<string, unknown> = {}) =>
  (await searchWorkspace({ query, scope: "notes", ...params })).rows.map(
    (r) => r.path,
  );
test("same-size same-mtime changes replace stale text; unchanged reads leave FTS row and indexed_at intact", async () => {
  const p = file("decision.md"),
    time = new Date("2030-01-01T00:00:00Z");
  await fs.writeFile(p, "SQLite glacier marker");
  await fs.utimes(p, time, time);
  await refreshWorkspaceIndex({ scope: "notes" });
  const before = await fs.stat(p),
    metadata = getDb().query("SELECT * FROM workspace_files").all(),
    rows = getDb().query("SELECT rowid,* FROM workspace_fts").all();
  await refreshWorkspaceIndex({ scope: "notes" });
  expect(getDb().query("SELECT * FROM workspace_files").all()).toEqual(
    metadata,
  );
  expect(getDb().query("SELECT rowid,* FROM workspace_fts").all()).toEqual(
    rows,
  );
  await fs.writeFile(p, "DuckDB glacier marker");
  await fs.utimes(p, time, time);
  const after = await fs.stat(p);
  expect(after.size).toBe(before.size);
  expect(after.mtimeMs).toBe(before.mtimeMs);
  await refreshWorkspaceIndex({ scope: "notes" });
  expect(await paths("DuckDB")).toEqual(["notes/decision.md"]);
  expect(await paths("SQLite")).toEqual([]);
  // Atomic-save replacement is also detected without a metadata change.
  await fs.writeFile(file("tmp.txt"), "SQLite glacier marker");
  await fs.utimes(file("tmp.txt"), time, time);
  await fs.rename(file("tmp.txt"), p);
  await refreshWorkspaceIndex({ scope: "notes" });
  expect(await paths("SQLite")).toEqual(["notes/decision.md"]);
});
test("legacy metadata rows without an FTS row are repaired on refresh", async () => {
  const p = file("legacy.md");
  await fs.writeFile(p, "legacyrepair");
  const stat = await fs.stat(p);
  getDb()
    .query("INSERT INTO workspace_files VALUES (?,?,?,?)")
    .run("notes/legacy.md", Math.round(stat.mtimeMs), stat.size, "fixture");
  await refreshWorkspaceIndex({ scope: "notes" });
  expect(await paths("legacyrepair")).toEqual(["notes/legacy.md"]);
});
test("equal scores and paginated FTS/LIKE results sort by binary path regardless of insertion order", async () => {
  const db = getDb();
  for (const name of ["z.md", "A.md", "a.md"]) {
    db.query("INSERT INTO workspace_files VALUES (?,1,17,?)").run(
      "notes/" + name,
      "fixture",
    );
    db.query(
      "INSERT INTO workspace_fts(content,path,mtime_ms,size_bytes) VALUES (?,?,1,17)",
    ).run("stabletie lexical", "notes/" + name);
  }
  const expected = ["notes/A.md", "notes/a.md", "notes/z.md"];
  expect(await paths("stabletie")).toEqual(expected);
  expect(await paths("stabletie", { limit: 1, offset: 1 })).toEqual([
    expected[1],
  ]);
  expect(await paths("stabletie", { scope: "all" })).toEqual(expected);
  const prepare = db.prepare.bind(db),
    spy = spyOn(db, "prepare").mockImplementation(((sql: string) => {
      if (sql.includes(" MATCH "))
        throw Object.assign(Error("fts5: syntax error near token"), {
          code: "SQLITE_ERROR",
        });
      return prepare(sql);
    }) as any);
  try {
    expect(await paths("stabletie")).toEqual(expected);
    expect(await paths("stabletie", { limit: 1, offset: 1 })).toEqual([
      expected[1],
    ]);
  } finally {
    spy.mockRestore();
  }
});
test("size limit still removes files that grow beyond the indexing budget", async () => {
  await fs.writeFile(file("large.md"), "small");
  await refreshWorkspaceIndex({ scope: "notes", max_kb: 16 });
  expect(await paths("small")).toHaveLength(1);
  await fs.writeFile(file("large.md"), "x".repeat(16385));
  await refreshWorkspaceIndex({ scope: "notes", max_kb: 16 });
  expect(getDb().query("SELECT * FROM workspace_files").all()).toEqual([]);
});

test("a racing growth is bounded and discarded without erasing the last indexed text", async () => {
  const p = file("race.md");
  await fs.writeFile(p, "before");
  await refreshWorkspaceIndex({ scope: "notes", max_kb: 16 });
  const open = fs.open;
  let mutated = false,
    largestBuffer = 0,
    closed = false;
  const spy = spyOn(fs, "open").mockImplementation((async (...args: any[]) => {
    const handle = await Reflect.apply(open, fs, args),
      read = handle.read.bind(handle),
      close = handle.close.bind(handle);
    handle.read = (async (buffer: Buffer, ...rest: any[]) => {
      largestBuffer = Math.max(largestBuffer, buffer.length);
      if (!mutated) {
        mutated = true;
        await fs.writeFile(p, "after ".repeat(10000));
      }
      return Reflect.apply(read, handle, [buffer, ...rest]);
    }) as any;
    handle.close = async () => {
      closed = true;
      return close();
    };
    return handle;
  }) as any);
  try {
    await expect(
      refreshWorkspaceIndex({ scope: "notes", max_kb: 16 }),
    ).rejects.toThrow("source changed");
    expect(getWorkspaceIndexStatus({ scope: "notes" }).state).toBe("failed");
  } finally {
    spy.mockRestore();
  }
  expect(largestBuffer).toBe(7);
  expect(closed).toBe(true);
  expect(await paths("before")).toEqual(["notes/race.md"]);
  expect(await paths("after")).toEqual([]);
  await refreshWorkspaceIndex({ scope: "notes", max_kb: 16 });
  expect(await paths("before")).toEqual([]);
});
test("a per-file SQL failure rolls FTS and metadata back together", async () => {
  const p = file("atomic.md");
  await fs.writeFile(p, "beforeword");
  await refreshWorkspaceIndex({ scope: "notes" });
  const before = getDb().query("SELECT * FROM workspace_files").all();
  getDb().exec(
    "CREATE TRIGGER fail_file_update BEFORE UPDATE ON workspace_files BEGIN SELECT RAISE(ABORT,'fixture failure'); END",
  );
  await fs.writeFile(p, "afterword");
  await expect(refreshWorkspaceIndex({ scope: "notes" })).rejects.toThrow(
    "fixture failure",
  );
  expect(getWorkspaceIndexStatus({ scope: "notes" }).state).toBe("failed");
  expect(await paths("beforeword")).toEqual(["notes/atomic.md"]);
  expect(await paths("afterword")).toEqual([]);
  expect(getDb().query("SELECT * FROM workspace_files").all()).toEqual(before);
  getDb().exec("DROP TRIGGER fail_file_update");
  await refreshWorkspaceIndex({ scope: "notes" });
  expect(await paths("afterword")).toEqual(["notes/atomic.md"]);
});

test("directory traversal failure preserves existing rows and fails instead of pruning an apparently empty root", async () => {
  await fs.writeFile(file("keep.md"), "retained");
  await refreshWorkspaceIndex({ scope: "notes" });
  const before = getDb().query("SELECT * FROM workspace_fts").all();
  const read = fs.readdir,
    spy = spyOn(fs, "readdir").mockImplementation((async (...args: any[]) => {
      if (String(args[0]) === path.dirname(file("keep.md")))
        throw Object.assign(Error("fixture denied"), { code: "EACCES" });
      return Reflect.apply(read, fs, args);
    }) as any);
  try {
    await expect(refreshWorkspaceIndex({ scope: "notes" })).rejects.toThrow(
      "fixture denied",
    );
  } finally {
    spy.mockRestore();
  }
  expect(getWorkspaceIndexStatus({ scope: "notes" }).state).toBe("failed");
  expect(getDb().query("SELECT * FROM workspace_fts").all()).toEqual(before);
  await refreshWorkspaceIndex({ scope: "notes" });
  expect(getWorkspaceIndexStatus({ scope: "notes" }).state).toBe("ready");
});
for (const kind of ["missing", "oversized"])
  test(`${kind} cleanup is atomic when metadata deletion fails`, async () => {
    const p = file("cleanup.md");
    await fs.writeFile(p, "cleanupmarker");
    await refreshWorkspaceIndex({ scope: "notes" });
    getDb().exec(
      "CREATE TRIGGER fail_cleanup BEFORE DELETE ON workspace_files BEGIN SELECT RAISE(ABORT,'cleanup failed'); END",
    );
    if (kind === "missing") await fs.unlink(p);
    else await fs.writeFile(p, "x".repeat(16385));
    await expect(
      refreshWorkspaceIndex({ scope: "notes", max_kb: 16 }),
    ).rejects.toThrow("cleanup failed");
    expect(getWorkspaceIndexStatus({ scope: "notes" }).state).toBe("failed");
    expect(await paths("cleanupmarker")).toEqual(["notes/cleanup.md"]);
    expect(
      getDb().query("SELECT count(*) n FROM workspace_files").get(),
    ).toEqual({ n: 1 });
    getDb().exec("DROP TRIGGER fail_cleanup");
    await refreshWorkspaceIndex({ scope: "notes", max_kb: 16 });
    expect(await paths("cleanupmarker")).toEqual([]);
  });
test("refresh removes FTS-only orphans and consolidates duplicate paths even when current text matches", async () => {
  await fs.writeFile(file("duplicate.md"), "currentmarker");
  await refreshWorkspaceIndex({ scope: "notes" });
  const db = getDb();
  db.query("INSERT INTO workspace_fts(content,path) VALUES (?,?)").run(
    "stalemarker",
    "notes/duplicate.md",
  );
  db.query("INSERT INTO workspace_fts(content,path) VALUES (?,?)").run(
    "currentmarker",
    "notes/duplicate.md",
  );
  db.query("INSERT INTO workspace_fts(content,path) VALUES (?,?)").run(
    "orphanmarker",
    "notes/gone.md",
  );
  db.query("INSERT INTO workspace_fts(content,path) VALUES (?,?)").run(
    "skillmarker",
    ".pi/skills/keep.md",
  );
  await refreshWorkspaceIndex({ scope: "notes" });
  expect(await paths("stalemarker")).toEqual([]);
  expect(await paths("currentmarker")).toEqual(["notes/duplicate.md"]);
  expect(await paths("orphanmarker")).toEqual([]);
  expect(
    db
      .query(
        "SELECT count(*) n FROM workspace_fts WHERE path='notes/duplicate.md'",
      )
      .get(),
  ).toEqual({ n: 1 });
  expect(
    (await searchWorkspace({ query: "skillmarker", scope: "all" })).rows,
  ).toHaveLength(1);
});
test("overlapping refresh scopes are rejected before changing status or writing rows", async () => {
  await fs.writeFile(file("pending.md"), "pendingmarker");
  const open = fs.open;
  let release!: () => void, entered!: () => void;
  const started = new Promise<void>((resolve) => {
    entered = resolve;
  });
  const spy = spyOn(fs, "open").mockImplementation((async (...args: any[]) => {
    entered();
    await new Promise<void>((resolve) => {
      release = resolve;
    });
    return Reflect.apply(open, fs, args);
  }) as any);
  const pending = refreshWorkspaceIndex({ scope: "notes" });
  await started;
  try {
    await expect(refreshWorkspaceIndex({ scope: "all" })).rejects.toThrow(
      "already active",
    );
    expect(getWorkspaceIndexStatus({ scope: "notes" }).state).toBe("indexing");
  } finally {
    release();
    spy.mockRestore();
    await pending;
  }
  expect(getWorkspaceIndexStatus({ scope: "notes" }).state).toBe("ready");
});

test("missing optional roots can be pruned but vanished nested directories abort before deletion", async () => {
  await fs.mkdir(path.join(ws.workspace, "notes", "nested"));
  await fs.writeFile(file("keep.md"), "keep");
  await fs.writeFile(file("nested/child.md"), "child");
  await refreshWorkspaceIndex({ scope: "notes" });
  const before = getDb()
      .query("SELECT * FROM workspace_fts ORDER BY path")
      .all(),
    read = fs.readdir;
  const spy = spyOn(fs, "readdir").mockImplementation((async (
    ...args: any[]
  ) => {
    if (String(args[0]).endsWith("/nested"))
      throw Object.assign(Error("nested disappeared"), { code: "ENOENT" });
    return Reflect.apply(read, fs, args);
  }) as any);
  try {
    await expect(refreshWorkspaceIndex({ scope: "notes" })).rejects.toThrow(
      "nested disappeared",
    );
  } finally {
    spy.mockRestore();
  }
  expect(
    getDb().query("SELECT * FROM workspace_fts ORDER BY path").all(),
  ).toEqual(before);
  await fs.rm(path.join(ws.workspace, "notes"), { recursive: true });
  await refreshWorkspaceIndex({ scope: "notes" });
  expect(getDb().query("SELECT count(*) n FROM workspace_fts").get()).toEqual({
    n: 0,
  });
});
test("operational FTS errors are reported without a misleading LIKE fallback", async () => {
  await fs.writeFile(file("a.md"), "alpha");
  await refreshWorkspaceIndex({ scope: "notes" });
  const prepare = getDb().prepare.bind(getDb());
  let searches = 0;
  const spy = spyOn(getDb(), "prepare").mockImplementation(((sql: string) => {
    if (sql.includes("workspace_fts")) {
      searches++;
      throw Object.assign(Error("database disk image is malformed"), {
        code: "SQLITE_CORRUPT",
      });
    }
    return prepare(sql);
  }) as any);
  try {
    const result = await searchWorkspace({ query: "alpha", scope: "notes" });
    expect(result.error).toBe("Workspace search failed.");
    expect(result.rows).toEqual([]);
    expect(searches).toBe(1);
  } finally {
    spy.mockRestore();
  }
});

test("notes and skills refresh independently while overlapping configured roots are rejected", async () => {
  await fs.writeFile(file("pending.md"), "notesmarker");
  const skillRoot = path.join(ws.workspace, ".pi", "skills");
  const extraRoot = path.join(ws.workspace, "extra");
  await fs.mkdir(skillRoot, { recursive: true });
  await fs.mkdir(extraRoot, { recursive: true });
  await fs.writeFile(path.join(skillRoot, "a.md"), "skillsmarker");
  await fs.writeFile(path.join(extraRoot, "a.md"), "extramarker");
  const open = fs.open;
  let release!: () => void, entered!: () => void;
  const started = new Promise<void>((resolve) => {
    entered = resolve;
  });
  const spy = spyOn(fs, "open").mockImplementation((async (...args: any[]) => {
    if (String(args[0]) === file("pending.md")) {
      entered();
      await new Promise<void>((resolve) => {
        release = resolve;
      });
    }
    return Reflect.apply(open, fs, args);
  }) as any);
  const pending = refreshWorkspaceIndex({ scope: "notes" });
  await started;
  try {
    const skills = await refreshWorkspaceIndex({ scope: "skills" });
    expect(skills.state).toBe("ready");
    expect(getWorkspaceIndexStatus({ scope: "notes" }).state).toBe("indexing");
    expect(
      (
        await searchWorkspace({ query: "skillsmarker", scope: "skills" })
      ).rows.map((r) => r.path),
    ).toEqual([".pi/skills/a.md"]);
    await expect(refreshWorkspaceIndex({ scope: "notes" })).rejects.toThrow(
      "already active",
    );
    await expect(refreshWorkspaceIndex({ scope: "all" })).rejects.toThrow(
      "overlapping roots",
    );
    const setRoots = async (roots: string[]) =>
      fs.writeFile(
        path.join(ws.workspace, ".piclaw/config.json"),
        JSON.stringify({
          domains: {
            access: { mode: "single-user" },
            tools: { workspaceSearchRoots: roots },
          },
        }),
      );
    await setRoots(["."]);
    await expect(refreshWorkspaceIndex({ scope: "all" })).rejects.toThrow(
      "overlapping roots",
    );
    await setRoots(["notes/nested"]);
    await expect(refreshWorkspaceIndex({ scope: "all" })).rejects.toThrow(
      "overlapping roots",
    );
    // The label "all" can refer to a configured root disjoint from notes.
    await setRoots(["extra"]);
    expect((await refreshWorkspaceIndex({ scope: "all" })).state).toBe("ready");
    expect(
      (await searchWorkspace({ query: "extramarker", scope: "all" })).rows.map(
        (r) => r.path,
      ),
    ).toEqual(["extra/a.md"]);
  } finally {
    release();
    spy.mockRestore();
    await pending;
  }
  expect(getWorkspaceIndexStatus({ scope: "notes" }).state).toBe("ready");
  expect(await paths("notesmarker")).toEqual(["notes/pending.md"]);
});
