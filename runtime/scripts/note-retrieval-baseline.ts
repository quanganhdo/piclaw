/** @file Provider-free current-search evaluation. Run with bun run test:local -- bun runtime/scripts/note-retrieval-baseline.ts. */
import { mkdirSync, mkdtempSync } from 'node:fs';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import { assessRetrievalBudgets } from './note-retrieval-budget.js';
import { assertPathWithinTestFilesystemIsolation, getActiveTestFilesystemIsolationRoot } from './test-filesystem-isolation.js';
const root = getActiveTestFilesystemIsolationRoot();
if (!root) throw Error('Must run under the filesystem-isolated local test launcher');
const args = process.argv.slice(2);
if (args.some(arg => arg !== '--small' && arg !== '--repeat-build')) throw Error('Only --small and --repeat-build are supported');
const scales = args.includes('--small') ? [0] : [0, 500];
const reports: any[] = [];
const repetitions = args.includes('--repeat-build') ? 2 : 1;
for (let repetition = 0; repetition < repetitions; repetition++) for (const scale of scales) {
 const workspace = mkdtempSync(join(root, `retrieval-baseline-${scale}-${repetition}-`));
 assertPathWithinTestFilesystemIsolation(workspace);
 mkdirSync(workspace, { recursive: true });
 for (const mode of ['build', 'reopen']) {
  const child = Bun.spawn([process.execPath, join(import.meta.dir, '../test/fixtures/note-retrieval/baseline-worker.ts'), mode, String(scale)], {
   env: { ...process.env, PICLAW_WORKSPACE: workspace, PICLAW_STORE: join(workspace,'.piclaw/store'), PICLAW_DATA: join(workspace,'.piclaw/data'), PICLAW_DB_IN_MEMORY: '0', PICLAW_DISABLE_BACKGROUND_WORKSPACE_INDEX: '1' },
   stdout: 'pipe', stderr: 'pipe',
  });
  const timeout = setTimeout(() => child.kill(), 120_000);
  let out: string, err: string, exit: number;
  try { [out, err, exit] = await Promise.all([new Response(child.stdout).text(), new Response(child.stderr).text(), child.exited]); }
  finally { clearTimeout(timeout); }
  if (exit !== 0) throw Error(`Baseline worker failed (${exit}): ${err.slice(-3000)} ${out.slice(-3000)}`);
  const line = out.split('\n').find(line => line.startsWith('NOTE_RETRIEVAL_REPORT='));
  if (!line) throw Error('Worker did not produce report');
  reports.push({ repetition, ...JSON.parse(line.slice('NOTE_RETRIEVAL_REPORT='.length)) });
 }
 const [build, reopen] = reports.slice(-2);
 const ranking = (report: any) => report.results.filter((r: any) => r.paths).map((r: any) => ({ id: r.id, paths: r.paths }));
 const stable = JSON.stringify(ranking(build)) === JSON.stringify(ranking(reopen));
 if (!stable || [build,reopen].some(r => r.results.some((q: any) => q.repeatStable === false))) throw Error('Ranking order changed across repeated queries or fresh-process reopen');
}
const rebuildChecks: { scale: number; rankingStable: boolean; identicalScoreTieStable: boolean | null }[] = [];
for (const scale of scales) {
 const builds = reports.filter(report => report.scale === scale && report.mode === 'build');
 const paths = (report: any) => JSON.stringify(report.results.filter((row: any) => row.paths).map((row: any) => row.paths));
 const rankingStable = builds.every(report => paths(report) === paths(builds[0]));
 const tie = (report: any) => JSON.stringify(report.results.find((row: any) => row.id === 'tie-checks')?.order);
 rebuildChecks.push({ scale, rankingStable, identicalScoreTieStable: builds.length > 1 ? builds.every(report => tie(report) === tie(builds[0])) : null });
}
const git = (args: string[]) => Bun.spawnSync(["git", ...args], { cwd: join(import.meta.dir, "../..") }).stdout.toString().trim();
const measuredCommit = git(["rev-parse", "HEAD"]);
const workingTreeModified = Boolean(git(["status", "--porcelain", "--untracked-files=no"]));
const report = { schema:1, measuredCommit, workingTreeModified, corpusCommit:'2b21a5c09b1e31244a58fb1ba175b854762b2989', productionBaseline:'dc577cbb89b97ccc5d43f5e49f539ecec056897d', repeatsPerQuery:5, rankingStable:rebuildChecks.every(check => check.rankingStable), rebuildChecks, reports };
const budgetsText = await Bun.file(join(import.meta.dir, '../test/fixtures/note-retrieval/budgets.json')).text();
const budgets = JSON.parse(budgetsText);
const budgetSha256 = createHash('sha256').update(budgetsText).digest('hex');
console.log(JSON.stringify({ ...report, budgetSha256, budgetAssessment: assessRetrievalBudgets(report, budgets) },null,2));
