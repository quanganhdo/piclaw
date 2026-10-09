import '../setup-filesystem-isolation.js';
import { AgentPool } from '../../src/agent-pool.js';
import { initDatabase, getDb, closeDatabase } from '../../src/db.js';
import { createAgentPoolModelOptions } from '../model-services-fixture.js';
import { withTempWorkspaceEnv } from '../helpers.js';
const disk = process.argv[2] === 'disk';
const protect = process.argv[3] === 'busy';
const cadence = Number(process.argv[4] ?? 5), ticks = Number(process.argv[5] ?? 12);
await withTempWorkspaceEnv('cleanup-profile-', { PICLAW_MAIN_SESSION_PRESSURE_RSS_BYTES: '1', PICLAW_DB_IN_MEMORY: disk ? '0' : '1' }, async () => {
  // helpers deliberately enforce memory mode; opt into the owned disk fixture here.
  process.env.PICLAW_DB_IN_MEMORY = disk ? '0' : '1';
  initDatabase();
  const db = getDb();
  const database = db.query('PRAGMA database_list').all();
  const journal = db.query('PRAGMA journal_mode').get();
  const synchronous = db.query('PRAGMA synchronous').get();
  if (disk && !(database as any[]).some(row => typeof row.file === 'string' && row.file.length > 0)) throw Error('Disk fixture was not opened');
  const pool = new AgentPool({ ...createAgentPoolModelOptions(), createSession: async () => { throw Error('Unused'); } });
  const held = Array.from({length:20000},(_,i)=>({i,text:`Synthetic retained object ${i}`.repeat(100)}));
  const before = process.memoryUsage(), cpu = process.cpuUsage(), calls:number[]=[];
  const originalGc = Bun.gc;
  let collections = 0;
  const rssSamples: number[] = [];
  Bun.gc = ((...args: Parameters<typeof Bun.gc>) => { collections++; return originalGc(...args); }) as typeof Bun.gc;
  const release = protect ? (pool as any).sessionManager.acquireEvictionProtection('web:synthetic-busy') : () => {};
  try {
    for(let i=0;i<ticks;i++) { const at=performance.now(); (pool as any).evictIdle(); calls.push(performance.now()-at); rssSamples.push(process.memoryUsage.rss()); await Bun.sleep(cadence); }
    release();
    const idleStart = performance.now(); (pool as any).evictIdle(); const firstIdleMs = performance.now() - idleStart;
    console.log(JSON.stringify({disk,database,journal,synchronous,protect,cadence,ticks,collections,rssSamples,firstIdleMs,calls,totalMs:calls.reduce((a,b)=>a+b,0),maxMs:Math.max(...calls),cpuUs:process.cpuUsage(cpu),before,after:process.memoryUsage(),heldCount:held.length,scope:'Actual AgentPool cleanup under forced pressure, retained synthetic object graph, no sessions/provider calls/liveDB'}));
  } finally {Bun.gc = originalGc;release();await pool.shutdown();closeDatabase();}
});
