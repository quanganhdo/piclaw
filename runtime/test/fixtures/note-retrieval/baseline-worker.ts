/** Owned-fixture worker. Invoked only through the isolated local test launcher.
 * No live paths, provider credentials or network services are required. */
import { mkdirSync, readFileSync, writeFileSync, readdirSync, statSync, unlinkSync, utimesSync } from 'node:fs';
import { join } from 'node:path';
import { performance } from 'node:perf_hooks';
import { assertPathWithinTestFilesystemIsolation, getActiveTestFilesystemIsolationRoot } from '../../../scripts/test-filesystem-isolation.js';
import { loadCorpus, percentile, summariseScores } from './scoring.js';

if (!getActiveTestFilesystemIsolationRoot()) throw Error('Run through bun run test:local; refusing unisolated benchmark');
const cwd = process.env.PICLAW_WORKSPACE!;
assertPathWithinTestFilesystemIsolation(cwd);
for (const name of ['PICLAW_STORE','PICLAW_DATA','PICLAW_PI_AGENT_DIR']) assertPathWithinTestFilesystemIsolation(process.env[name]!);
const mode = process.argv[2] || 'build';
const scale = Number(process.argv[3] || 0);
if (!['build','reopen'].includes(mode) || !Number.isInteger(scale) || scale < 0 || scale > 1900) throw Error('Invalid bounded benchmark parameters');
process.env.PICLAW_DB_IN_MEMORY = '0';
process.env.PICLAW_DISABLE_BACKGROUND_WORKSPACE_INDEX = '1';
const corpusRoot = import.meta.dir;
const corpus = loadCorpus(corpusRoot);
if (mode === 'build') {
  mkdirSync(join(cwd, '.piclaw'), { recursive: true });
  writeFileSync(join(cwd, '.piclaw', 'config.json'), JSON.stringify({ domains: { access: { mode: 'single-user' }, tools: { workspaceSearchRoots: ['notes'], searchMatchMode: 'or' } } }));
  mkdirSync(join(cwd, 'notes'), { recursive: true });
  for (const file of readdirSync(join(corpusRoot, 'notes')).sort()) writeFileSync(join(cwd, 'notes', file), readFileSync(join(corpusRoot, 'notes', file)));
  for (let i = 0; i < scale; i++) writeFileSync(join(cwd, 'notes', `scale-${String(i).padStart(4,'0')}.md`), `# Synthetic filler ${i}\n\n${'Neutral inventory padding about trays and baskets. '.repeat(150)}\n`);
}
const dbModule = await import('../../../src/db.js');
const search = await import('../../../src/workspace-search.js');
search.setBackgroundWorkspaceIndexRefreshRequesterForTests(() => {});
dbModule.initDatabase();
const { getSearchMatchMode } = await import('../../../src/core/config.js');
if (getSearchMatchMode() !== 'or') throw Error('Unexpected baseline match mode');
const db = dbModule.getDb();
const databaseBytes = () => Number((db.query('PRAGMA page_count').get() as any).page_count) * Number((db.query('PRAGMA page_size').get() as any).page_size);
const initialDatabaseBytes = databaseBytes();
const { workspaceSearch } = await import('../../../src/extensions/workspace-search.js');
let executeTool: any;
workspaceSearch({ on: () => {}, registerTool: (tool: any) => { if (tool.name === 'search_workspace') executeTool = tool.execute; } } as any);
const timings: Record<string, number> = {};
let status;
if (mode === 'build') {
  const start = performance.now(); status = await search.refreshWorkspaceIndex({ scope: 'notes', max_kb: 512 }); timings.initialRefreshMs = performance.now() - start;
  if (status.state !== 'ready' || status.indexed_file_count !== 12 + scale) throw Error('Fixture index incomplete');
}
const results: any[] = [];
const latencies: number[] = [];
const firstQueries: number[] = [];
for (const query of corpus.queries) {
  const start = performance.now();
  const found = await search.searchWorkspace({ query: query.query, scope: 'notes', limit: 5, refresh: false });
  firstQueries.push(performance.now() - start);
  if (found.error) throw Error(`Query failed: ${query.id}: ${found.error}`);
  const encode = JSON.stringify(await executeTool('fixture-call', { query: query.query, scope: 'notes', limit: 5, refresh: false }, undefined, undefined, { hasUI: false }));
  const bytes = Buffer.byteLength(encode);
  const paths = found.rows.map(row => row.path);
  let repeatStable = true;
  for (let i = 0; i < 5; i++) {
    const t = performance.now(); const repeat = await search.searchWorkspace({ query: query.query, scope: 'notes', limit: 5 }); latencies.push(performance.now()-t);
    if (JSON.stringify(repeat.rows.map(row => row.path)) !== JSON.stringify(paths)) repeatStable = false;
  }
  results.push({ id: query.id, paths, snippets: found.rows.map(row => row.snippet), bytes, estimatedTokensAt4Bytes: Math.ceil(bytes/4), repeatStable });
}
if (mode === 'build') {
  const measuredDatabaseBytes = databaseBytes();
  let start = performance.now(); await search.refreshWorkspaceIndex({ scope: 'notes' }); timings.noChangeRefreshMs = performance.now()-start;
  const changed = join(cwd,'notes','decisions.md');
  writeFileSync(changed, readFileSync(changed,'utf8') + '\nIncremental fixture observation: auroraupdate.\n');
  start=performance.now();await search.refreshWorkspaceIndex({scope:'notes'});timings.editRefreshMs=performance.now()-start;
  const editVisible=(await search.searchWorkspace({query:'auroraupdate',scope:'notes'})).rows.some(r=>r.path==='notes/decisions.md');
  writeFileSync(join(cwd,'notes','added.md'),'# Incremental addition\nNovel marker silveraddition.\n');
  start=performance.now();await search.refreshWorkspaceIndex({scope:'notes'});timings.addRefreshMs=performance.now()-start;
  const addVisible=(await search.searchWorkspace({query:'silveraddition',scope:'notes'})).rows.some(r=>r.path==='notes/added.md');
  unlinkSync(join(cwd,'notes','added.md'));start=performance.now();await search.refreshWorkspaceIndex({scope:'notes'});timings.deleteRefreshMs=performance.now()-start;
  const deleteVisible=(await search.searchWorkspace({query:'silveraddition',scope:'notes'})).rows.length===0;
  // Equal-text tie probe is separate from the frozen relevance corpus. Record
  // observed order, but do not impose a nonexistent SQL tie-break contract.
  for (const name of ['tie-b.md', 'tie-a.md']) writeFileSync(join(cwd,'notes',name),'# Identical tie fixture\nUnique tieprobe marker.\n');
  await search.refreshWorkspaceIndex({scope:'notes'});
  const tieOrders: string[][] = [];
  for (let n = 0; n < 5; n++) tieOrders.push((await search.searchWorkspace({query:'tieprobe',scope:'notes'})).rows.map(row => row.path));
  if (tieOrders.some(paths => JSON.stringify(paths)!==JSON.stringify(tieOrders[0]))) throw Error('Equal-score tie changed on repeated reads');
  if (JSON.stringify([...tieOrders[0]].sort()) !== JSON.stringify(['notes/tie-a.md','notes/tie-b.md'])) throw Error('Tie probe corpus mismatch');
  for (const name of ['tie-b.md', 'tie-a.md']) unlinkSync(join(cwd,'notes',name));
  await search.refreshWorkspaceIndex({scope:'notes'});
  results.push({id:'tie-checks',order:tieOrders[0],repeatStable:true,contract:'equal BM25 scores use binary path order'});
  // Regression probe: equal-size/equal-mtime edits must refresh indexed text.
  const original=readFileSync(changed,'utf8');
  const fixedTime = new Date('2030-01-01T00:00:00.000Z');
  utimesSync(changed, fixedTime, fixedTime);
  await search.refreshWorkspaceIndex({scope:'notes'});
  const before = statSync(changed);
  const indexed = db.query('SELECT mtime_ms,size_bytes FROM workspace_files WHERE path=?').get('notes/decisions.md') as any;
  writeFileSync(changed, original.replace('SQLite','DuckDB'));utimesSync(changed,fixedTime,fixedTime);
  const after = statSync(changed);
  if (before.mtimeMs !== after.mtimeMs || before.size !== after.size || indexed.mtime_ms !== Math.round(after.mtimeMs)) throw Error('Same-metadata edit fixture is not exact');
  await search.refreshWorkspaceIndex({scope:'notes'});
  const sameMetadataEditDetected=(await search.searchWorkspace({query:'DuckDB',scope:'notes'})).rows.some(r=>r.path==='notes/decisions.md');
  results.push({ id:'incremental-checks',editVisible,addVisible,deleteVisible,sameMetadataEditDetected, sameMetadataPreserved: true, sourceChangedWhileIndexUnchanged: !sameMetadataEditDetected, databaseBeforeMutations: measuredDatabaseBytes });
  // Restore frozen bytes for a fresh-process reopen against exactly the same corpus.
  writeFileSync(changed,readFileSync(join(corpusRoot,'notes','decisions.md')));
  await search.refreshWorkspaceIndex({scope:'notes'});
}
const pages=Number((db.query('PRAGMA page_count').get() as any).page_count),pageSize=Number((db.query('PRAGMA page_size').get() as any).page_size);
let indexOwnedBytes: number | null;
try { indexOwnedBytes = Number((db.query("SELECT sum(pgsize) AS bytes FROM dbstat WHERE name LIKE 'workspace_%'").get() as any).bytes); }
catch { indexOwnedBytes = null; /* Some SQLite builds omit dbstat; never invent zero. */ }
const index=(db.query('SELECT count(*) as files,sum(size_bytes) as sourceBytes FROM workspace_files').get() as any);
const report={schema:1,mode,scale,versions:{bun:Bun.version,sqlite:(db.query('SELECT sqlite_version() AS version').get() as any).version},scope:'notes',matchMode:'or',scoring:'file-level hits; section coverage optimistic upper bound; no citation capability',results,
 metrics:{development:summariseScores(corpus.queries.filter(q=>q.split==='development'),results,5),heldOut:summariseScores(corpus.queries.filter(q=>q.split==='held-out'),results,5)},
 qualityAtK: Object.fromEntries([1,3,5].map(k => [k, { development: summariseScores(corpus.queries.filter(q=>q.split==='development'),results,k), heldOut: summariseScores(corpus.queries.filter(q=>q.split==='held-out'),results,k) }])),
 latency:{firstQueryMs:firstQueries[0],firstPassP50Ms:percentile(firstQueries,.5),firstPassP95Ms:percentile(firstQueries,.95),warmP50Ms:percentile(latencies,.5),warmP95Ms:percentile(latencies,.95),samples:latencies.length,coldDefinition:'fresh-process SQLite reopen; OS page cache NOT flushed'},timings,index:{...index,databaseLogicalBytes:pages*pageSize,indexOwnedBytes,applicationDatabaseBeforeIndexBytes:mode==='build'?initialDatabaseBytes:null},memory:{rssBytes:process.memoryUsage().rss}};
dbModule.closeDatabase();
console.log('NOTE_RETRIEVAL_REPORT='+JSON.stringify(report));
