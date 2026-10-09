import { expect, test } from 'bun:test';
import { readFileSync, existsSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
const root = resolve(import.meta.dir, '../../..');
const file = resolve(root, 'docs/design/earendil-agent-harness-integration-adr/evidence/earendil-102-remaining-acceptance.md');
const text = readFileSync(file, 'utf8');
const receipt = JSON.parse(readFileSync(resolve(root, 'docs/development/receipts/pi-102-acceptance-checkpoint.json'), 'utf8'));

test('released acceptance keeps all requirements and historical evidence separate', () => {
  for (const [prefix, count] of [['MCP', 15], ['AUTH', 8]] as const) {
    for (let n = 1; n <= count; n++) expect(text.match(new RegExp(`^\\| ${prefix}-${String(n).padStart(2, '0')} `, 'gm'))).toHaveLength(1);
  }
  for (const phrase of ['remain inactive', 'Partial synthetic foundation', 'post-cutover writes quarantined', 'three callback-port conflict cases failed', 'stale local adapter', 'No hosted checks', 'no whole-system performance acceptance']) expect(text).toContain(phrase);
  expect(receipt.scope).toMatchObject({ productionDelegateActivated: false, installation: false, restart: false, providerSpend: false, liveCredentials: false });
  expect(receipt.failures.every((r: { qualifying: boolean }) => r.qualifying === false)).toBe(true);
  expect(receipt.authCurrentSkip.newQualification).toBe(false);
});

test('source, hosted, fixture overlay and rollback attestations remain explicit', () => {
  expect(receipt.target.pi).toBe('1.0.2');
  expect(receipt.target.core).toBe('d26e9b7858895d883f36c88d2e8ab2377643b662');
  expect(receipt.settings.publishedHead).toBe('42b9058b68a195e361ad922d18d9e9708cd7790e');
  expect(receipt.settings.hostedCi).toMatchObject({ id: 37286187765, conclusion: 'success' });
  expect(receipt.callbackFixture).toMatchObject({ treeParity: true, productionSourceChanged: false, corePinChanged: false, overlayExplicit: true, changedPaths: ['mcp-callback-server.test.ts'], typecheck: { exit: 0 } });
  expect(receipt.callbackFixture.headTree).toBe(receipt.callbackFixture.mergeTree);
  expect(receipt.sourceAttestations).toHaveLength(3);
  for (const attestation of receipt.sourceAttestations) {
    expect(attestation.before).toEqual(attestation.after);
    expect(attestation.before.head).toBe(receipt.target.core);
    expect(attestation.before.runtimeDependencyTestScriptParity).toBe(true);
    expect(attestation.exit).toBe(0);
  }
  expect(receipt.executedWrapperSourceAttestation.before).toEqual(receipt.executedWrapperSourceAttestation.after);
  expect(receipt.executedWrapperSourceAttestation.before).toMatchObject({ runtimeAndUnmodifiedTestsParity: true, changedPaths: ['mcp-callback-server.test.ts'], testTransformer: { typescript: '5.9.3', productionDependencyChanged: false } });
  expect(receipt.executedWrapperSourceAttestation.exit).toBe(0);
  expect(receipt.executedWrapperSourceAttestation.pass).toBe(316);
  expect(receipt.rollback).toMatchObject({ status: 'pass', snapshotBytesVerified: true, postCutoverWritesQuarantined: true, postCutoverWritesReplayed: false, realCredentials: false });
  expect(receipt.rollback.rows.map((r: { version: string }) => r.version)).toEqual(['1.0.1', '1.0.2', '1.0.1']);
});

test('checkpoint links exist and both ADR indexes expose the current matrix', () => {
  for (const match of text.matchAll(/\[[^\]]*\]\(([^)]+)\)/g)) {
    const link = match[1].split('#')[0];
    if (!link || /^https?:/.test(link)) continue;
    expect(existsSync(resolve(dirname(file), link)), link).toBe(true);
  }
  for (const index of [resolve(dirname(file), 'README.md'), resolve(dirname(file), '../README.md')]) expect(readFileSync(index, 'utf8')).toContain('earendil-102-remaining-acceptance.md');
});
