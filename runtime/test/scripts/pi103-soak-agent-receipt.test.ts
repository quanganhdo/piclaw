import { expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const root = resolve(import.meta.dir, '../../..');
const receipt = JSON.parse(readFileSync(resolve(root, 'docs/development/receipts/pi-103-soak-agent.json'), 'utf8'));
const text = readFileSync(resolve(root, 'docs/development/pi-103-soak-agent.md'), 'utf8');

test('bounded soak receipt preserves source splits, actual agent scope and unaccepted production gates', () => {
  expect(receipt.pi).toBe('1.0.3');
  expect(receipt.scope).toMatchObject({ liveState: false, credentials: false, paidInference: false, deployment: false, restart: false, wholePlanAccepted: false });
  expect(receipt.rows).toHaveLength(9);
  expect(receipt.sourceBinding.before).toEqual(receipt.sourceBinding.after);
  for (const row of receipt.rows) {
    expect(row.exit).toBe(0);
    expect(row.sourceBefore).toEqual(row.sourceAfter);
    expect(row.logSha256).toMatch(/^[a-f0-9]{64}$/);
    if (row.job.name.startsWith('soak-')) {
      expect(row.result).toMatchObject({ exactContextPayloadAndOrder: true, explicitGcCalls: 0, retainedControls: 3, noHeldFinalizers: true });
      expect(row.result.requestedMs).toBe(60000);
      expect(row.result.naturalFinalizedManagers).toBeLessThanOrEqual(row.result.openedDroppedManagers);
    } else {
      expect(row.result).toMatchObject({ realAgentPool: true, realLeafRestored: true, durableSourceSettled: true, networkAttempts: 0, childProcessAttempts: 0, providerCalls: 2 });
    }
  }
  expect(receipt.priorSeries.qualifyingForCorrectedSoak).toBe(false);
  expect(receipt.failures.every((row: { qualifying: boolean }) => row.qualifying === false)).toBe(true);
  for (const phrase of ['No explicit GC', 'does not prove leak absence', 'complete persisted topology', 'separate approval']) expect(text).toContain(phrase);
});
