import { expect, test } from 'bun:test';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import { checkVendorMetadata } from '../../../scripts/check-vendor-metadata';

test('vendor metadata binds output size/hash, manifest identity and bounded paths', () => {
  const root = mkdtempSync(join(tmpdir(), 'vendor-meta-'));
  const manifest = 'runtime/vendor-manifests/test.json';
  const metadata = 'web/static/vendor/meta.json';
  const output = 'web/static/vendor/file.js';
  try {
    mkdirSync(join(root, 'runtime/vendor-manifests'), { recursive: true });
    mkdirSync(join(root, 'runtime/web/static/vendor'), { recursive: true });
    writeFileSync(join(root, manifest), JSON.stringify({ id: 'test', metadataFile: metadata }));
    writeFileSync(join(root, 'runtime', output), 'source');
    const value = { manifest_id: 'test', output_file: output, size_bytes: 6,
      sha256: createHash('sha256').update('source').digest('hex') };
    const save = (data: unknown) => writeFileSync(join(root, 'runtime', metadata), JSON.stringify(data));
    save(value);
    expect(checkVendorMetadata(root, [manifest])).toEqual({ checked: 1, failures: [] });
    save({ ...value, size_bytes: 5 });
    expect(checkVendorMetadata(root, [manifest]).failures[0]).toContain('stale');
    save({ ...value, manifest_id: 'wrong' });
    expect(checkVendorMetadata(root, [manifest]).failures[0]).toContain('identity');
    save({ ...value, output_file: '../../private' });
    expect(checkVendorMetadata(root, [manifest]).failures[0]).toContain('outside');
    save({ ...value, output_file: 'web/static/vendor/missing.js' });
    expect(checkVendorMetadata(root, [manifest]).failures[0]).toContain('missing');
    save({ manifest_id: 'test', output_files: [{ output_file: output, sha256: value.sha256, size_bytes: 6 }] });
    expect(checkVendorMetadata(root, [manifest]).failures).toEqual([]);
  } finally { rmSync(root, { recursive: true, force: true }); }
});
