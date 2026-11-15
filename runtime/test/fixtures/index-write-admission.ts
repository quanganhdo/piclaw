import { mkdirSync,writeFileSync } from "node:fs";
import { join } from "node:path";
import '../setup-filesystem-isolation.js';
import assert from 'node:assert/strict';
import { Database } from 'bun:sqlite';
import { initDatabase, getDb, closeDatabase } from '../../src/db/connection.js';
import { ensureNoteSchema } from '../../src/note-retrieval/schema.js';
import { markNoteIndexDirty } from '../../src/note-retrieval/coordinator.js';
import { markWorkspaceIndexStale, refreshWorkspaceIndex, setBackgroundWorkspaceIndexRefreshRequesterForTests } from '../../src/workspace-search.js';

assert.equal(process.env.PICLAW_DB_IN_MEMORY, '0'); initDatabase();
const db = getDb(); ensureNoteSchema(db);
const file = (db.query('PRAGMA database_list').all() as {name:string;file:string}[]).find(row => row.name === 'main')!.file;
const blocker = new Database(file), policy = db.query('PRAGMA busy_timeout').get();
const state = () => db.query('SELECT dirty,coverage,state FROM note_retrieval_state').get() as {dirty:number;coverage:number;state:string};
const legacy = () => db.query("SELECT state FROM workspace_index_status WHERE scope='notes'").get();
const requests: string[] = []; let cases = 0;
setBackgroundWorkspaceIndexRefreshRequesterForTests(params => requests.push(String(params?.scope)));
try {
  db.query("INSERT INTO workspace_index_status(scope,state,indexed_file_count,roots_json,updated_at) VALUES('notes','ready',1,'[\"notes\"]','fixture')").run();
  const old = state(); blocker.exec('BEGIN IMMEDIATE'); let done = false;
  const pending = markWorkspaceIndexStale({paths:['notes/a.md']}).then(() => { done = true; });
  await Bun.sleep(20); assert(!done); assert.equal(requests.length, 0); assert.deepEqual(state(), old);
  assert.deepEqual(db.query('PRAGMA busy_timeout').get(), policy);
  blocker.exec('ROLLBACK'); await pending;
  assert.equal(state().dirty, old.dirty + 1); assert.deepEqual(legacy(), {state:'stale'});
  assert.deepEqual(requests, ['notes','all']); cases++;

  const beforeFault = state(), requestCount = requests.length;
  db.exec("UPDATE workspace_index_status SET state='ready'; CREATE TRIGGER invalidation_fault BEFORE UPDATE ON workspace_index_status BEGIN SELECT RAISE(ABORT,'fixture fault'); END");
  await assert.rejects(markWorkspaceIndexStale({paths:['notes/a.md']}), /fixture fault/);
  assert.deepEqual(state(), beforeFault); assert.deepEqual(legacy(), {state:'ready'}); assert.equal(requests.length, requestCount);
  db.exec('DROP TRIGGER invalidation_fault'); cases++;

  blocker.exec('BEGIN IMMEDIATE'); let authorised = true;
  const revoked = markWorkspaceIndexStale({paths:['notes/a.md']}, {authorise:() => { if (!authorised) throw Error('revoked'); }});
  const rejection = assert.rejects(revoked, /revoked/); await Bun.sleep(20); authorised = false; blocker.exec('ROLLBACK'); await rejection;
  assert.deepEqual(state(), beforeFault); assert.deepEqual(legacy(), {state:'ready'}); assert.equal(requests.length, requestCount); cases++;

  blocker.exec('BEGIN IMMEDIATE'); const controller = new AbortController();
  const cancelled = markWorkspaceIndexStale({paths:['notes/a.md']}, {signal:controller.signal});
  const cancellation = assert.rejects(cancelled, /cancelled/); await Bun.sleep(20); controller.abort(Error('cancelled')); await cancellation; blocker.exec('ROLLBACK');
  assert.deepEqual(state(), beforeFault); assert.equal(requests.length, requestCount); cases++;

  blocker.exec('BEGIN IMMEDIATE'); let marked = false;
  const dirty = Promise.resolve(markNoteIndexDirty(['notes/b.md'])).then(() => { marked = true; });
  await Bun.sleep(20); assert(!marked); blocker.exec('ROLLBACK'); await dirty; assert.equal(state().dirty, beforeFault.dirty + 1); cases++;
  mkdirSync(join(process.env.PICLAW_WORKSPACE!,'notes'),{recursive:true});
  const note=join(process.env.PICLAW_WORKSPACE!,'notes','wal-index.md');writeFileSync(note,'old indexed content');
  blocker.exec('BEGIN IMMEDIATE');let refreshed=false;
  const refresh=refreshWorkspaceIndex({scope:'notes'}).then(value=>{refreshed=true;return value;});
  await Bun.sleep(20);assert(!refreshed);assert.deepEqual(db.query('PRAGMA busy_timeout').get(),policy);blocker.exec('ROLLBACK');
  assert.equal((await refresh).state,'ready');cases++;
  const oldFts=db.query("SELECT content,path FROM workspace_fts WHERE path='notes/wal-index.md'").get();assert(oldFts);writeFileSync(note,'new content that must roll back');
  db.exec("CREATE TRIGGER index_file_fault BEFORE INSERT ON workspace_files BEGIN SELECT RAISE(ABORT,'index file fault'); END");
  await assert.rejects(refreshWorkspaceIndex({scope:'notes'}),/index file fault/);
  assert.deepEqual(db.query("SELECT content,path FROM workspace_fts WHERE path='notes/wal-index.md'").get(),oldFts);cases++;
  assert.equal(db.inTransaction, false); assert.deepEqual(db.query('PRAGMA busy_timeout').get(), policy);
  console.log(JSON.stringify({kind:'index-write-admission', cases, realWal:true}));
} finally {
  setBackgroundWorkspaceIndexRefreshRequesterForTests(null);
  if (blocker.inTransaction) blocker.exec('ROLLBACK'); blocker.close(); closeDatabase();
}
