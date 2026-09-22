/** Pure assessment of the frozen #1346 fixture budgets. No runtime or filesystem access. */
export interface RetrievalBudgets {
  version: number;
  status: string;
  appliesTo: string;
  quality: Record<string, number | boolean>;
  resource: Record<string, number>;
}
export type BudgetStatus = 'pass' | 'fail' | 'unsupported' | 'insufficient_evidence';
export interface BudgetCheck {
  id: string;
  status: BudgetStatus;
  threshold: number | boolean;
  observed: number | boolean | null;
  samples: number;
  detail: string;
}
type Row = Record<string, any>;
const finite = (value: unknown): value is number => typeof value === 'number' && Number.isFinite(value) && value >= 0;

export function assessRetrievalBudgets(report: Row, budgets: RetrievalBudgets) {
  if (report?.schema !== 1 || budgets?.version !== 1 || typeof budgets.status !== 'string' || !budgets.quality || !budgets.resource) {
    throw new Error('Unsupported report or budget schema');
  }
  const runs: Row[] = Array.isArray(report.reports) ? report.reports : [];
  const small = runs.filter(run => run.scale === 0);
  const large = runs.filter(run => run.scale === 500);
  const builds = runs.filter(run => run.mode === 'build');
  const largeBuilds = large.filter(run => run.mode === 'build');
  // Two independent builds, each reopened, at both sizes. Duplicate rows cannot
  // fill a missing slot, and a --small run cannot certify the large-fixture limits.
  const slots = new Set(runs.map(run => `${run.scale}/${run.repetition}/${run.mode}`));
  const complete = runs.length === 8 && slots.size === 8 && [0, 500].every(scale =>
    [0, 1].every(repetition => ['build', 'reopen'].every(mode => slots.has(`${scale}/${repetition}/${mode}`))));
  const checks: BudgetCheck[] = [];
  function numeric(id: string, threshold: unknown, values: unknown[], minimum = false, detail = '') {
    if (!finite(threshold)) throw new Error(`Invalid numeric budget ${id}`);
    const valid = values.filter(finite);
    const observed = valid.length ? (minimum ? Math.min(...valid) : Math.max(...valid)) : null;
    checks.push({ id, threshold, observed, samples: valid.length, detail,
      status: !complete || !values.length || valid.length !== values.length ? 'insufficient_evidence'
        : (minimum ? observed! >= threshold : observed! <= threshold) ? 'pass' : 'fail' });
  }
  function booleans(id: string, threshold: unknown, values: unknown[], detail: string) {
    if (typeof threshold !== 'boolean') throw new Error(`Invalid boolean budget ${id}`);
    const valid = values.filter((value): value is boolean => typeof value === 'boolean');
    const observed = valid.length ? valid.every(value => value === threshold) ? threshold : !threshold : null;
    checks.push({ id, threshold, observed, samples: valid.length, detail,
      status: !complete || !values.length || valid.length !== values.length ? 'insufficient_evidence' : observed === threshold ? 'pass' : 'fail' });
  }
  const metrics = runs.flatMap(run => [run.metrics?.development, run.metrics?.heldOut]);
  for (const [key, field] of [['fileRecallAt5MinimumPerSplit','fileRecall'], ['fileMrrAt5MinimumPerSplit','mrr'], ['filePrecisionAt5MinimumPerSplit','filePrecision']] as const) {
    numeric(key, budgets.quality[key], metrics.map(value => value?.[field]), true, 'Worst split/run; file-level scores, not passage citation quality.');
  }
  numeric('futureUnanswerableFalsePositiveRateMaximum', budgets.quality.futureUnanswerableFalsePositiveRateMaximum,
    metrics.map(value => value?.unanswerableFalsePositiveRate), false, 'Returning lexical hits to an unanswerable query counts as a false positive.');
  const citationKey = 'futureCitationCorrectnessMinimum';
  numeric(citationKey, budgets.quality[citationKey], metrics.map(value => value?.citationCorrectness), true, 'File-level search does not emit revision-bound line citations.');
  if (complete && metrics.length && metrics.every(value => value?.citationCorrectness === null && typeof value?.citationSupport === 'string' && value.citationSupport.startsWith('unsupported:'))) {
    checks[checks.length - 1].status = 'unsupported';
  }
  booleans('futureSameMetadataEditDetected', budgets.quality.futureSameMetadataEditDetected,
    builds.map(run => run.results?.find((row: Row) => row.id === 'incremental-checks')?.sameMetadataEditDetected),
    'All four build probes; exact same-size/same-mtime fixture.');
  const ties = Array.isArray(report.rebuildChecks) ? report.rebuildChecks : [];
  booleans('futureIdenticalScoreRebuildOrderStable', budgets.quality.futureIdenticalScoreRebuildOrderStable,
    [0, 500].map(scale => ties.filter((row: Row) => row.scale === scale).length === 1
      ? ties.find((row: Row) => row.scale === scale)?.identicalScoreTieStable : undefined),
    'Both size cases must compare independent builds, not only repeated reads.');

  const queryRows = runs.flatMap(run => Array.isArray(run.results) ? run.results.filter((row: Row) => Array.isArray(row.paths)) : []);
  numeric('toolResponseBytesMaximum', budgets.resource.toolResponseBytesMaximum, queryRows.map(row => row.bytes));
  numeric('estimatedTokensAt4BytesMaximum', budgets.resource.estimatedTokensAt4BytesMaximum, queryRows.map(row => row.estimatedTokensAt4Bytes), false, 'Byte/4 estimate, not tokenizer output.');
  if (runs.some(run => {
    const rows: Row[] = Array.isArray(run.results) ? run.results.filter((row: Row) => Array.isArray(row.paths)) : [];
    return rows.length !== 24 || new Set(rows.map(row => row.id)).size !== 24;
  })) {
    for (const check of checks.slice(-2)) check.status = 'insufficient_evidence';
  }
  numeric('warmQueryP95MsMaximum', budgets.resource.warmQueryP95MsMaximum, runs.map(run => run.latency?.warmP95Ms), false, 'Comparable local runner only; reported, not a portable CI timing gate.');
  numeric('freshProcessFirstQueryMsMaximum', budgets.resource.freshProcessFirstQueryMsMaximum, runs.filter(run => run.mode === 'reopen').map(run => run.latency?.firstQueryMs), false, 'Fresh process/SQLite connection; OS cache not flushed.');
  numeric('smallInitialRefreshMsMaximum', budgets.resource.smallInitialRefreshMsMaximum, small.filter(run => run.mode === 'build').map(run => run.timings?.initialRefreshMs));
  numeric('largeInitialRefreshMsMaximum', budgets.resource.largeInitialRefreshMsMaximum, largeBuilds.map(run => run.timings?.initialRefreshMs));
  numeric('largeIncrementalRefreshMsMaximum', budgets.resource.largeIncrementalRefreshMsMaximum,
    largeBuilds.flatMap(run => ['noChangeRefreshMs','editRefreshMs','addRefreshMs','deleteRefreshMs'].map(key => run.timings?.[key])));
  numeric('indexOwnedBytesPerSourceByteMaximum', budgets.resource.indexOwnedBytesPerSourceByteMaximum,
    large.map(run => finite(run.index?.indexOwnedBytes) && finite(run.index?.sourceBytes) && run.index.sourceBytes > 0 ? run.index.indexOwnedBytes / run.index.sourceBytes : null), false, 'Index-owned SQLite pages; not total store/WAL size.');
  numeric('smallIndexOwnedBytesMaximum', budgets.resource.smallIndexOwnedBytesMaximum, small.map(run => run.index?.indexOwnedBytes));
  numeric('runtimeRssBytesMaximum', budgets.resource.runtimeRssBytesMaximum, runs.map(run => run.memory?.rssBytes), false, 'Sampled RSS near worker end; no peak RSS guarantee.');
  const counts = Object.fromEntries((['pass','fail','unsupported','insufficient_evidence'] as const).map(status => [status, checks.filter(check => check.status === status).length]));
  return { schema: 1, budgetVersion: budgets.version, budgetStatus: budgets.status, scope: budgets.appliesTo,
    completeFixtureMatrix: complete, allBudgetsSatisfied: complete && checks.every(check => check.status === 'pass'),
    acceptance: 'not inferred from execution; thresholds remain in their recorded approval state',
    counts, checks };
}
