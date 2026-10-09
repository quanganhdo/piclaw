import { expect, test } from 'bun:test';
import { duration, report, summarise, type Job, type Sample } from '../../../scripts/actions-efficiency-report';

const job: Job = { id: 10, name: 'CI', conclusion: 'success',
  started_at: '2026-10-01T00:00:00Z', completed_at: '2026-10-01T00:02:00Z',
  steps: [{ name: 'Run canonical fast CI contract', conclusion: 'success',
    started_at: '2026-10-01T00:00:30Z', completed_at: '2026-10-01T00:01:30Z' }] };
const sample: Sample = { repository: 'owner/repo', since: '2026-10-01', until: '2026-10-15', collectedAt: '2026-10-15',
  runs: [{ id: 1, name: 'CI', head_sha: 'a'.repeat(40), run_attempt: 2, conclusion: 'success', created_at: '2026-10-01' }],
  jobs: [job, job, { ...job, id: 11, conclusion: 'cancelled', steps: [], completed_at: '2026-10-01T00:01:00Z' }],
  artifacts: [{ id: 1, size_in_bytes: 200, expired: false }, { id: 1, size_in_bytes: 200, expired: false },
    { id: 2, size_in_bytes: 300, expired: true }], truncated: false, incomplete: false };

test('distinct job/artifact IDs prevent carried-forward retry double counting', () => {
  const result = summarise(sample);
  expect(result.distinctJobExecutions).toBe(2);
  expect(result.jobSeconds).toBe(180);
  expect(result.additionalRunAttempts).toBe(1);
  expect(result.cancelledJobs).toBe(1);
  expect(result.artifactBytes).toBe(500);
  expect(result.expiredArtifactBytes).toBe(300);
  expect(result.steps['Run canonical fast CI contract'].seconds).toBe(60);
  expect(result.namedSuccessfulSteps).toEqual({ 'named-fast-ci-step': 1 });
});

test('invalid, unfinished and reversed timestamps stay unknown', () => {
  expect(duration({ name: 'missing', conclusion: null })).toBeNull();
  expect(duration({ ...job, started_at: 'invalid' })).toBeNull();
  expect(duration({ ...job, completed_at: '2025-01-01' })).toBeNull();
  const result = summarise({ ...sample, jobs: [{ ...job, completed_at: undefined, steps: [] }] });
  expect(result.jobSeconds).toBe(0);
  expect(result.unknownJobDurations).toBe(1);
});

test('report distinguishes observed time from trust, coverage and billing evidence', () => {
  const text = report({ ...sample, incomplete: true, truncated: true });
  expect(text).toContain('truncated=true; incomplete=true');
  expect(text).toContain('No savings comparison');
  expect(text).toContain('not billing or quota evidence');
  expect(text).toContain('not certify complete capability coverage');
  expect(text).not.toContain('token');
  expect(text).not.toContain('logs_url');
});
