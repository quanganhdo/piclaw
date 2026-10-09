#!/usr/bin/env bun
import { writeFileSync } from 'node:fs';

export interface Step { name: string; conclusion: string | null; started_at?: string; completed_at?: string }
export interface Job extends Step { id: number; run_attempt?: number; steps: Step[] }
export interface Run { id: number; name: string; head_sha: string; run_attempt: number; conclusion: string | null; created_at: string }
export interface Sample { repository: string; since: string; until: string; collectedAt: string;
  runs: Run[]; jobs: Job[]; artifacts: { id: number; size_in_bytes: number; expired: boolean }[];
  truncated: boolean; incomplete: boolean }

export function duration(value: Step): number | null {
  const start = Date.parse(value.started_at ?? '');
  const end = Date.parse(value.completed_at ?? '');
  return Number.isFinite(start) && Number.isFinite(end) && end >= start ? (end - start) / 1000 : null;
}
export function summarise(sample: Sample) {
  const jobs = [...new Map(sample.jobs.map(job => [job.id, job])).values()];
  const artifacts = [...new Map(sample.artifacts.map(a => [a.id, a])).values()];
  const totals: Record<string, { executions: number; seconds: number; unknownDurations: number; conclusions: Record<string, number> }> = {};
  const coverage: Record<string, number> = {};
  for (const job of jobs) {
    for (const step of job.steps) {
      const total = totals[step.name] ??= { executions: 0, seconds: 0, unknownDurations: 0, conclusions: {} };
      total.executions++;
      const seconds = duration(step);
      if (seconds === null) total.unknownDurations++; else total.seconds += seconds;
      const conclusion = step.conclusion ?? 'unfinished';
      total.conclusions[conclusion] = (total.conclusions[conclusion] ?? 0) + 1;
      // These labels report successful named steps, not inferred acceptance coverage.
      if (step.conclusion === 'success') {
        const label = /canonical fast CI/i.test(step.name) ? 'named-fast-ci-step' :
          /Run E2E tests|Run add-on UX tests/.test(step.name) ? 'named-e2e-step' :
          /Verify shared SVG/.test(step.name) ? 'named-browser-step' :
          /Smoke-test isolated Git global install/.test(step.name) ? 'named-install-smoke-step' :
          /Run full integration suite/.test(step.name) ? 'named-integration-step' : null;
        if (label) coverage[label] = (coverage[label] ?? 0) + 1;
      }
    }
  }
  return {
    distinctJobExecutions: jobs.length,
    jobSeconds: jobs.reduce((sum, job) => sum + (duration(job) ?? 0), 0),
    unknownJobDurations: jobs.filter(job => duration(job) === null).length,
    cancelledJobs: jobs.filter(job => job.conclusion === 'cancelled').length,
    unsuccessfulJobs: jobs.filter(job => !['success', 'skipped'].includes(job.conclusion ?? '')).length,
    additionalRunAttempts: sample.runs.reduce((sum, run) => sum + Math.max(0, run.run_attempt - 1), 0),
    artifactBytes: artifacts.reduce((sum, a) => sum + a.size_in_bytes, 0),
    expiredArtifactBytes: artifacts.filter(a => a.expired).reduce((sum, a) => sum + a.size_in_bytes, 0),
    namedSuccessfulSteps: coverage, steps: totals,
    trustedReuse: 'not measured: no approved trusted-reuse publisher is active',
    billing: 'not measured: runner wall time and artifact bytes are not billing or quota evidence',
  };
}

export function report(sample: Sample): string {
  const s = summarise(sample);
  return `# Actions execution measurements\n\nRepository: ${sample.repository}\nWindow: ${sample.since} to ${sample.until} (run creation time)\nCollected: ${sample.collectedAt}\nSample: ${sample.runs.length} runs; truncated=${sample.truncated}; incomplete=${sample.incomplete}\n\n` +
    `- Distinct job executions: ${s.distinctJobExecutions}\n- Runner job wall time: ${s.jobSeconds.toFixed(1)} seconds (${(s.jobSeconds / 60).toFixed(2)} minutes)\n- Jobs with unknown duration: ${s.unknownJobDurations}\n- Cancelled jobs: ${s.cancelledJobs}\n- Additional run attempts: ${s.additionalRunAttempts}\n- Retained artifact metadata: ${s.artifactBytes} bytes (${s.expiredArtifactBytes} expired)\n\n` +
    `Job IDs are deduplicated across attempts. Step time is diagnostic and is not added to job time. In-progress duration is unknown; no end time is invented. Artifact bytes cover returned metadata, not deleted artifacts or total historical transfer.\n\n` +
    `Trusted reuse: ${s.trustedReuse}.\nBilling: ${s.billing}. No savings comparison is inferred from this sample. Successful named steps describe observed workflow labels; they do not certify complete capability coverage.\n\n` +
    '## Steps\n\n| Step | Executions | Seconds | Unknown durations |\n|---|---:|---:|---:|\n' +
    Object.entries(s.steps).sort(([a], [b]) => a.localeCompare(b)).map(([name, v]) =>
      `| ${name.replace(/[|\r\n]/g, ' ')} | ${v.executions} | ${v.seconds.toFixed(1)} | ${v.unknownDurations} |`).join('\n') + '\n';
}

function api(path: string): any {
  const proc = Bun.spawnSync(['gh', 'api', path], { stdout: 'pipe', stderr: 'pipe' });
  if (proc.exitCode !== 0) throw new Error('GitHub metadata request failed');
  return JSON.parse(proc.stdout.toString());
}
function pages(path: string, key: string): any[] {
  const values: any[] = [];
  for (let page = 1; ; page++) {
    const response = api(`${path}${path.includes('?') ? '&' : '?'}per_page=100&page=${page}`)[key];
    values.push(...response);
    if (response.length < 100) return values;
  }
}

if (import.meta.main) {
  const [repository, since, until, output, limitArg = '100'] = process.argv.slice(2);
  const limit = Number(limitArg);
  if (!/^[\w.-]+\/[\w.-]+$/.test(repository ?? '') || !Number.isFinite(Date.parse(since ?? '')) ||
    !Number.isFinite(Date.parse(until ?? '')) || Date.parse(since) >= Date.parse(until) ||
    !output || !Number.isInteger(limit) || limit < 1 || limit > 500)
    throw new Error('Usage: script owner/repo since-ISO until-ISO output-prefix [max-runs 1..500]');
  const query = encodeURIComponent(`${since}..${until}`);
  const listed: any[] = [];
  let truncated = false;
  for (let page = 1; ; page++) {
    const response = api(`repos/${repository}/actions/runs?created=${query}&per_page=100&page=${page}`).workflow_runs;
    listed.push(...response);
    if (listed.length > limit) { truncated = true; break; }
    if (response.length < 100) break;
  }
  const selected = listed.slice(0, limit);
  const sample: Sample = { repository, since, until, collectedAt: new Date().toISOString(),
    runs: [], jobs: [], artifacts: [], truncated, incomplete: false };
  for (const run of selected) {
    sample.runs.push({ id: run.id, name: run.name, head_sha: run.head_sha, run_attempt: run.run_attempt,
      conclusion: run.conclusion, created_at: run.created_at });
    for (let attempt = 1; attempt <= run.run_attempt; attempt++) {
      try {
        sample.jobs.push(...pages(`repos/${repository}/actions/runs/${run.id}/attempts/${attempt}/jobs`, 'jobs')
          .map((j: any) => ({ id: j.id, name: j.name, run_attempt: j.run_attempt,
            conclusion: j.conclusion, started_at: j.started_at, completed_at: j.completed_at,
            steps: (j.steps ?? []).map((s: any) => ({ name: s.name, conclusion: s.conclusion,
              started_at: s.started_at, completed_at: s.completed_at })) })));
      } catch { sample.incomplete = true; }
    }
    try {
      sample.artifacts.push(...pages(`repos/${repository}/actions/runs/${run.id}/artifacts`, 'artifacts')
        .map((a: any) => ({ id: a.id, size_in_bytes: a.size_in_bytes, expired: a.expired })));
    } catch { sample.incomplete = true; }
  }
  writeFileSync(`${output}.json`, `${JSON.stringify(sample, null, 2)}\n`);
  writeFileSync(`${output}.md`, report(sample));
  console.log(`${sample.runs.length} runs; ${summarise(sample).distinctJobExecutions} distinct job executions; incomplete=${sample.incomplete}; truncated=${sample.truncated}`);
}
