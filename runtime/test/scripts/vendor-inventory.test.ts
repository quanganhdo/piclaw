import { expect, test } from 'bun:test';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { buildInventory, isVendorAsset } from '../../../scripts/vendor-inventory';

test('inventory covers declared outputs, vendor directories, fonts and WASM without profiles', () => {
  const root = mkdtempSync(join(tmpdir(), 'vendor-inventory-'));
  const tracked = ['runtime/vendor-manifests/example.json', 'runtime/web/static/common/js/vendor/a.js',
    'runtime/web/static/common/js/built.js', 'runtime/web/static/common/fonts/font.woff2',
    'skel/vendor/copy.js', 'skel/tool.wasm', 'skel/.piclaw/profile.json'];
  try {
    for (const path of tracked) {
      mkdirSync(join(root, path, '..'), { recursive: true });
      writeFileSync(join(root, path), path.endsWith('example.json') ? JSON.stringify({ outputFile: 'web/static/common/js/built.js',
        outputDir: 'web/static/common/js/vendor' }) : path.endsWith('.js') ? 'same binary' : 'content');
    }
    const first = buildInventory(root, tracked);
    expect(first.files).toHaveLength(5);
    expect(first.files.find(f => f.path.endsWith('built.js'))?.provenance).toBe('manifest-linked');
    expect(first.unrecorded).toContain('skel/tool.wasm');
    expect(first.duplicatePayloads.some(paths => paths.length === 3)).toBe(true);
    expect(JSON.stringify(buildInventory(root, [...tracked].reverse()))).toBe(JSON.stringify(first));
    writeFileSync(join(root, 'skel/tool.wasm'), 'changed');
    expect(buildInventory(root, tracked).files.find(f => f.path === 'skel/tool.wasm')?.sha256)
      .not.toBe(first.files.find(f => f.path === 'skel/tool.wasm')?.sha256);
    expect(isVendorAsset('notes/vendor/private.js')).toBe(false);
    expect(isVendorAsset('skel/.piclaw/profile.json')).toBe(false);
  } finally { rmSync(root, { recursive: true, force: true }); }
});
