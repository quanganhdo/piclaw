import { test, expect } from 'bun:test';
import { mkdtempSync, readFileSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { resolve, join } from 'node:path';
import { runEarendilPackageAdmission } from '../../../scripts/check-earendil-package-admission.ts';
const root = resolve(import.meta.dir, '../../..');
const receipts = join(root, 'docs/design/earendil-agent-harness-integration-adr/evidence/receipts');
test('Pi1.1.0 missing registry gitHead does not permit altered identity or provider receipts', () => {
  const dir = mkdtempSync(join(tmpdir(), 'pi110-negative-'));
  try {
    writeFileSync(join(dir, 'package.json'), JSON.stringify({ dependencies: { '@earendil-works/pi-coding-agent': '1.1.0' } }));
    const registry = JSON.parse(readFileSync(join(receipts, 'earendil-110-registry.json'), 'utf8'));
    const provider = readFileSync(join(receipts, 'earendil-110-provider-auth.json'), 'utf8');
    const registryPath = join(dir, 'registry.json'), providerPath = join(dir, 'provider.json');
    const options = { consumerRoot: dir, version: '1.1.0', gitHead: 'abe508e1b89912adde45528136c3221eb69acdd7', registryReceiptPath: registryPath, providerReceiptPath: providerPath, tarballDir: dir, bunExecutable: process.execPath };
    writeFileSync(providerPath, provider);
    const mutations: { mutate: (r: any[]) => void; error: string }[] = [
      { mutate: r => { r[0].gitHead = '0'.repeat(40); }, error: 'gitHead mismatch' },
      { mutate: r => { r[0].dist.integrity = 'sha512-' + Buffer.alloc(64).toString('base64'); }, error: 'integrity mismatch' },
      { mutate: r => { r.push(r[0]); }, error: 'duplicate package' },
      { mutate: r => { r[0].version = '1.0.4'; }, error: 'version mismatch' },
    ];
    for (const { mutate, error } of mutations) {
      const changed = structuredClone(registry); mutate(changed); writeFileSync(registryPath, JSON.stringify(changed));
      expect(() => runEarendilPackageAdmission(options)).toThrow(error);
    }
    writeFileSync(registryPath, JSON.stringify(registry));
    writeFileSync(providerPath, provider + ' ');
    expect(() => runEarendilPackageAdmission(options)).toThrow('provider auth receipt hash differs from exact 1.1.0 receipt');
  } finally { rmSync(dir, { recursive: true, force: true }); }
});
