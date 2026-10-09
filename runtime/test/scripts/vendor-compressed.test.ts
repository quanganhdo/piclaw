import { expect, test } from 'bun:test';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { gzipSync } from 'node:zlib';
import { checkCompressedVendors } from '../../../scripts/check-vendor-compressed';

test('compressed vendor pairs require valid matching bytes and tracked source', () => {
  const root = mkdtempSync(join(tmpdir(), 'vendor-compressed-'));
  try {
    writeFileSync(join(root, 'asset.js'), 'source');
    writeFileSync(join(root, 'asset.js.gz'), gzipSync('source'));
    expect(checkCompressedVendors(root, ['asset.js', 'asset.js.gz'])).toBe(1);
    expect(checkCompressedVendors(root, ['asset.js'])).toBe(1);
    expect(() => checkCompressedVendors(root, ['asset.js.gz'])).toThrow('source missing');
    writeFileSync(join(root, 'asset.js.gz'), gzipSync('stale'));
    expect(() => checkCompressedVendors(root, ['asset.js', 'asset.js.gz'])).toThrow('Stale');
    writeFileSync(join(root, 'asset.js.gz'), 'not gzip');
    expect(() => checkCompressedVendors(root, ['asset.js', 'asset.js.gz'])).toThrow('Invalid');
  } finally { rmSync(root, { recursive: true, force: true }); }
});
