import { expect, test } from 'bun:test';
import { generateKeyPairSync } from 'node:crypto';
import { receiptClaim, signReceipt, verifyReceipt, type ApprovedPublisher } from '../../../scripts/trusted-ci-receipt';

const { privateKey, publicKey } = generateKeyPairSync('ed25519');
const policy: ApprovedPublisher = { repository: 'owner/repo', actor: 'approved-bot', keyId: 'test-key', revoked: false,
  publicKey: publicKey.export({ type: 'spki', format: 'pem' }).toString() };
const key = privateKey.export({ type: 'pkcs8', format: 'pem' }).toString();
const source = { repositoryHash: 'a'.repeat(64), commit: 'b'.repeat(40), tree: 'c'.repeat(40), clean: true,
  lockHash: 'd'.repeat(64), commandHash: 'e'.repeat(64), configHash: 'f'.repeat(64), pinnedBun: '1.4.2', actualBun: '1.4.2' };
const raw = { schemaVersion: 1, status: 'passed', exitCode: 0, customCommand: false,
  source, finalSource: { ...source }, startedAt: '2026-10-07T00:00:00Z', endedAt: '2026-10-07T00:01:00Z',
  capabilities: { 'ci-fast': { status: 'passed', counts: { passed: 3, skipped: 1, failed: 0, summaries: 1 }, logHash: '1'.repeat(64) } },
  log: { sha256: '1'.repeat(64) }, privateLog: 'SECRET' };
const issue = '2026-10-07T00:02:00Z', expires = '2026-10-07T01:02:00Z', now = Date.parse('2026-10-07T00:03:00Z');
const envelope = () => signReceipt(raw, policy, key, issue, expires);

test('approved Ed25519 source-bound claim verifies without private receipt fields', () => {
  const signed = envelope();
  expect(JSON.stringify(signed)).not.toContain('SECRET');
  expect(verifyReceipt(signed, [policy], source, 'owner/repo', now).accepted).toBe(true);
  expect(receiptClaim(raw).capability).toBe('ci-fast');
});

test('tampered signature/payload, unknown/revoked actor/key and repository fail closed', () => {
  const signed = envelope();
  for (const mutate of [
    (s: any) => { s.claim.counts.passed++; },
    (s: any) => { s.signature = 'x'.repeat(88); },
    (s: any) => { s.actor = 'unapproved'; },
    (s: any) => { s.keyId = 'other'; },
    (s: any) => { s.repository = 'other/repo'; },
    (s: any) => { s.claim.capability = 'integration'; },
    (s: any) => { s.privateField = 'injected'; },
  ]) {
    const changed = structuredClone(signed); mutate(changed);
    expect(verifyReceipt(changed, [policy], source, 'owner/repo', now).accepted).toBe(false);
  }
  expect(verifyReceipt(signed, [], source, 'owner/repo', now).accepted).toBe(false);
  expect(verifyReceipt(signed, [{ ...policy, revoked: true }], source, 'owner/repo', now).accepted).toBe(false);
  const wrongKey = generateKeyPairSync('ed25519').publicKey.export({ type: 'spki', format: 'pem' }).toString();
  expect(verifyReceipt(signed, [{ ...policy, publicKey: wrongKey }], source, 'owner/repo', now).accepted).toBe(false);
});

test('source/tree/runtime/gate changes and stale/future validity refuse reuse', () => {
  const signed = envelope();
  for (const field of ['repositoryHash', 'commit', 'tree', 'lockHash', 'commandHash', 'configHash', 'actualBun']) {
    expect(verifyReceipt(signed, [policy], { ...source, [field]: 'changed' }, 'owner/repo', now).accepted).toBe(false);
  }
  expect(verifyReceipt(signed, [policy], { ...source, clean: false }, 'owner/repo', now).accepted).toBe(false);
  expect(verifyReceipt(signed, [policy], source, 'owner/repo', Date.parse(expires)).accepted).toBe(false);
  expect(verifyReceipt(signed, [policy], source, 'owner/repo', Date.parse(issue) - 1).accepted).toBe(false);
});

test('failed/dirty/interrupted/incomplete/custom receipts cannot be signed', () => {
  for (const mutate of [
    (r: any) => { r.status = 'failed'; },
    (r: any) => { r.status = 'interrupted'; },
    (r: any) => { r.exitCode = 1; },
    (r: any) => { r.customCommand = true; },
    (r: any) => { r.source.clean = false; },
    (r: any) => { r.finalSource.tree = '0'.repeat(40); },
    (r: any) => { r.capabilities['ci-fast'].counts = null; },
    (r: any) => { r.capabilities['ci-fast'].counts.failed = 1; },
    (r: any) => { r.log.sha256 = '0'.repeat(64); },
  ]) {
    const changed = structuredClone(raw); mutate(changed);
    expect(() => signReceipt(changed, policy, key, issue, expires)).toThrow();
  }
  expect(() => signReceipt(raw, { ...policy, revoked: true }, key, issue, expires)).toThrow();
});
