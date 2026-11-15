import { afterEach, expect, test } from "bun:test";
import Database from "bun:sqlite";
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

const script = resolve(import.meta.dir, "../../scripts/import-jsonl-sessions.ts");
const roots: string[] = [];
afterEach(() => roots.splice(0).forEach((root) => rmSync(root, { recursive: true, force: true })));

function fixture() {
  const root = mkdtempSync(join(tmpdir(), "piclaw-import-script-"));
  roots.push(root);
  const source = join(root, "session.jsonl");
  writeFileSync(source, [
    JSON.stringify({ type: "session", version: 3, id: "session", cwd: "/workspace" }),
    JSON.stringify({ type: "message", id: "entry", parentId: null, message: { role: "user", content: "hello" } }),
    "",
  ].join("\n"));
  return { root, source, target: join(root, "sessions.db") };
}

async function run(args: string[]) {
  const child = Bun.spawn({ cmd: [process.execPath, script, ...args], stdout: "pipe", stderr: "pipe" });
  const [exitCode, stdout, stderr] = await Promise.all([
    child.exited,
    new Response(child.stdout).text(),
    new Response(child.stderr).text(),
  ]);
  return { exitCode, stdout, stderr };
}

test("dry-run inventories sources without creating a target", async () => {
  const { root, target } = fixture();
  const result = await run(["--source", root, "--target", target, "--layout", "separate", "--dry-run"]);
  expect(result.exitCode).toBe(0);
  expect(JSON.parse(result.stdout).sourceFiles).toBe(1);
  expect(existsSync(target)).toBe(false);
});

test("existing separate stores are backed up before idempotent import", async () => {
  const { root, target } = fixture();
  const first = await run(["--source", root, "--target", target, "--layout", "separate"]);
  expect(first.exitCode).toBe(0);
  const second = await run(["--source", root, "--target", target, "--layout", "separate"]);
  expect(second.exitCode).toBe(0);
  expect(JSON.parse(second.stdout).alreadyImported).toBe(1);
  expect(readdirSync(root).some((name) => name.includes("pre-session-import") && name.endsWith(".backup"))).toBe(true);
});

test("retained archive-layout benchmark runs on disposable inputs and preserves the sources", async () => {
  const {root,source}=fixture();
  const sessions=join(root,"sessions");
  mkdirSync(sessions);copyFileSync(source,join(sessions,"session.jsonl"));
  const messages=join(root,"timeline.db"),out=join(root,"archive-benchmark");
  const timeline=new Database(messages);
  timeline.exec("CREATE TABLE chats(jid TEXT PRIMARY KEY,last_message_time TEXT);INSERT INTO chats VALUES('fixture','preserved')");
  timeline.close();
  const original=readFileSync(source);
  const child=Bun.spawn([process.execPath,resolve(import.meta.dir,"../../scripts/benchmark-sqlite-session-layouts.ts"),
    "--sessions",sessions,"--messages",messages,"--out",out,"--limit","1","--iterations","1"],{stdout:"pipe",stderr:"pipe"});
  const [code,stdout,stderr]=await Promise.all([child.exited,new Response(child.stdout).text(),new Response(child.stderr).text()]);
  expect(code,stderr).toBe(0);
  const report=JSON.parse(stdout);
  expect(report.scope).toBe("archive-layout-only");
  for(const outcome of Object.values(report.faults) as {passed:boolean}[]) expect(outcome.passed).toBe(true);
  expect(readFileSync(source)).toEqual(original);
  const preserved=new Database(messages,{readonly:true});
  try {expect(preserved.query("SELECT * FROM chats").all()).toEqual([{jid:"fixture",last_message_time:"preserved"}]);}
  finally {preserved.close();}
},30000);

test("refuses unified and unrelated targets", async () => {
  const { root, target } = fixture();
  const unified = await run(["--source", root, "--target", target, "--layout", "unified"]);
  expect(unified.exitCode).not.toBe(0);
  expect(unified.stderr).toContain("Unified imports are intentionally unsupported");

  const database = new Database(target, { create: true, strict: true });
  database.exec("CREATE TABLE unrelated(id INTEGER)");
  database.close();
  const unrelated = await run(["--source", root, "--target", target, "--layout", "separate"]);
  expect(unrelated.exitCode).not.toBe(0);
  expect(unrelated.stderr).toContain("unrelated table");
});
