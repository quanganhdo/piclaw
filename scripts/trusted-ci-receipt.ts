import { createPrivateKey, createPublicKey, sign, verify } from 'node:crypto';

export interface ReceiptSource {
  repositoryHash: string; commit: string; tree: string; clean: boolean;
  lockHash: string; pinnedBun: string; actualBun: string; commandHash: string; configHash: string;
}
export interface ReceiptClaim {
  schemaVersion: 1; source: ReceiptSource; startedAt: string; endedAt: string;
  capability: 'ci-fast'; counts: { passed: number; skipped: number; failed: number; summaries: number };
  logHash: string;
}
export interface SignedReceipt {
  version: 1; repository: string; actor: string; keyId: string;
  issuedAt: string; expiresAt: string; claim: ReceiptClaim; signature: string;
}
export interface ApprovedPublisher {
  repository: string; actor: string; keyId: string; publicKey: string; revoked: boolean;
}
const hash = (value: unknown): value is string => typeof value === 'string' && /^[a-f0-9]{64}$/.test(value);
const sha = (value: unknown): value is string => typeof value === 'string' && /^[a-f0-9]{40}$/.test(value) && !/^0+$/.test(value);
function require(value: unknown): asserts value {
  if (!value) throw new Error('Receipt is not eligible for trusted publication');
}
function instant(value: unknown): number {
  require(typeof value === 'string' && /^\d{4}-\d\d-\d\dT/.test(value));
  const time = Date.parse(value);
  require(Number.isFinite(time));
  return time;
}
function source(value: any): ReceiptSource {
  require(value && value.clean === true && sha(value.commit) && sha(value.tree));
  for (const key of ['repositoryHash', 'lockHash', 'commandHash', 'configHash']) require(hash(value[key]));
  require(typeof value.pinnedBun === 'string' && /^\d+\.\d+\.\d+$/.test(value.pinnedBun) && value.actualBun === value.pinnedBun);
  return { repositoryHash: value.repositoryHash, commit: value.commit, tree: value.tree, clean: true,
    lockHash: value.lockHash, pinnedBun: value.pinnedBun, actualBun: value.actualBun,
    commandHash: value.commandHash, configHash: value.configHash };
}
function counts(value: any): ReceiptClaim['counts'] {
  require(value && ['passed', 'skipped', 'failed', 'summaries'].every(key => Number.isSafeInteger(value[key]) && value[key] >= 0));
  require(value.failed === 0 && value.summaries > 0 && value.passed > 0);
  return { passed: value.passed, skipped: value.skipped, failed: value.failed, summaries: value.summaries };
}
/** Project only shareable claims; raw receipt extras, commands and logs are excluded. */
export function receiptClaim(receipt: any): ReceiptClaim {
  require(receipt?.schemaVersion === 1 && receipt.status === 'passed' && receipt.exitCode === 0 && receipt.customCommand === false);
  const before = source(receipt.source);
  require(JSON.stringify(before) === JSON.stringify(source(receipt.finalSource)));
  require(instant(receipt.startedAt) <= instant(receipt.endedAt));
  const capability = receipt.capabilities?.['ci-fast'];
  require(capability?.status === 'passed' && hash(capability.logHash) && capability.logHash === receipt.log?.sha256);
  return { schemaVersion: 1, source: before, startedAt: receipt.startedAt, endedAt: receipt.endedAt,
    capability: 'ci-fast', counts: counts(capability.counts), logHash: capability.logHash };
}
function canonicalClaim(value: any): ReceiptClaim {
  require(value?.schemaVersion === 1 && value.capability === 'ci-fast' && hash(value.logHash));
  require(instant(value.startedAt) <= instant(value.endedAt));
  return { schemaVersion: 1, source: source(value.source), startedAt: value.startedAt,
    endedAt: value.endedAt, capability: 'ci-fast', counts: counts(value.counts), logHash: value.logHash };
}
function unsigned(value: any) {
  require(value?.version === 1 && /^[\w.-]+\/[\w.-]+$/.test(value.repository) &&
    typeof value.actor === 'string' && /^[\w.-]+$/.test(value.actor) &&
    typeof value.keyId === 'string' && /^[\w.-]+$/.test(value.keyId));
  return { version: 1 as const, repository: value.repository as string, actor: value.actor as string,
    keyId: value.keyId as string, issuedAt: value.issuedAt as string, expiresAt: value.expiresAt as string,
    claim: canonicalClaim(value.claim) };
}
function message(value: ReturnType<typeof unsigned>): Buffer {
  return Buffer.from(`piclaw-local-ci-receipt-v1\n${JSON.stringify(value)}`);
}

/** Trusted host only. Never call with a key accessible to tested repository code. */
export function signReceipt(receipt: unknown, publisher: ApprovedPublisher, privateKey: string,
  issuedAt: string, expiresAt: string): SignedReceipt {
  require(!publisher.revoked);
  const value = unsigned({ version: 1, repository: publisher.repository, actor: publisher.actor,
    keyId: publisher.keyId, issuedAt, expiresAt, claim: receiptClaim(receipt) });
  require(instant(value.claim.endedAt) <= instant(issuedAt) && instant(expiresAt) > instant(issuedAt));
  const key = createPrivateKey(privateKey);
  require(key.asymmetricKeyType === 'ed25519');
  require(createPublicKey(key).export({ type: 'spki', format: 'pem' }).toString() ===
    createPublicKey(publisher.publicKey).export({ type: 'spki', format: 'pem' }).toString());
  return { ...value, signature: sign(null, message(value), key).toString('base64') };
}

/** Policy and expected identities must come from protected configuration, never the envelope. */
export function verifyReceipt(envelope: unknown, policy: ApprovedPublisher[], expected: ReceiptSource,
  repository: string, now: number): { accepted: boolean; reason: string } {
  try {
    require(Number.isFinite(now));
    const raw: any = envelope;
    const value = unsigned(raw);
    // Reject injected fields and non-canonical payloads instead of silently dropping them.
    require(JSON.stringify({ ...value, signature: raw.signature }) === JSON.stringify(raw));
    require(value.repository === repository);
    const publisher = policy.find(p => p.repository === repository && p.actor === value.actor && p.keyId === value.keyId);
    require(publisher && !publisher.revoked);
    const issued = instant(value.issuedAt), expiry = instant(value.expiresAt);
    require(instant(value.claim.endedAt) <= issued && issued <= now && expiry > now && expiry > issued);
    require(JSON.stringify(value.claim.source) === JSON.stringify(source(expected)));
    const key = createPublicKey(publisher.publicKey);
    require(key.asymmetricKeyType === 'ed25519' && typeof raw.signature === 'string');
    const signature = Buffer.from(raw.signature, 'base64');
    require(signature.length === 64 && signature.toString('base64') === raw.signature);
    require(verify(null, message(value), key, signature));
    return { accepted: true, reason: 'verified ci-fast claim' };
  } catch {
    return { accepted: false, reason: 'unverified: run ordinary hosted checks' };
  }
}
