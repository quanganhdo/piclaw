import { mkdirSync, appendFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { Reporter, TestCase, TestResult, TestStep } from '@playwright/test/reporter';

/** Incremental identifiers and timings only; no prompts, errors, headers or credentials. */
export default class ProgressReporter implements Reporter {
  private readonly path = join(process.cwd(), 'reports', 'progress.jsonl');
  onBegin() { mkdirSync(join(process.cwd(), 'reports'), { recursive: true }); writeFileSync(this.path, ''); }
  private record(value: Record<string, unknown>) { appendFileSync(this.path, JSON.stringify({ at: new Date().toISOString(), ...value }) + '\n'); }
  onTestBegin(test: TestCase, result: TestResult) { this.record({ event: 'test_start', id: test.id, retry: result.retry, file: test.location.file.split(/[\\/]/).pop(), line: test.location.line }); }
  onStepBegin(test: TestCase, _result: TestResult, step: TestStep) { if (step.category === 'test.step') this.record({ event: 'phase_start', id: test.id, phase: step.title }); }
  onStepEnd(test: TestCase, _result: TestResult, step: TestStep) { if (step.category === 'test.step') this.record({ event: 'phase_end', id: test.id, phase: step.title, durationMs: step.duration, failed: !!step.error }); }
  onTestEnd(test: TestCase, result: TestResult) { this.record({ event: 'test_end', id: test.id, status: result.status, durationMs: result.duration, retry: result.retry }); }
}
