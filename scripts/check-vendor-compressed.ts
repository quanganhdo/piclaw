#!/usr/bin/env bun
import { existsSync, readFileSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { gunzipSync } from 'node:zlib';

/** Check tracked and generated precompressed payloads against inventoried source. */
export function checkCompressedVendors(root: string, paths: string[]): number {
  const tracked = new Set(paths);
  let checked = 0;
  const compressed = new Set(paths.filter(path => path.endsWith('.gz')));
  for (const source of paths) if (!source.endsWith('.gz') && existsSync(join(root, `${source}.gz`))) compressed.add(`${source}.gz`);
  for (const path of [...compressed].sort()) {
    if (!path.endsWith('.gz')) continue;
    const source = path.slice(0, -3);
    if (!tracked.has(source)) throw new Error(`Compressed vendor source missing: ${source}`);
    let decoded: Buffer;
    try { decoded = gunzipSync(readFileSync(join(root, path))); }
    catch { throw new Error(`Invalid compressed vendor payload: ${path}`); }
    if (!decoded.equals(readFileSync(join(root, source)))) throw new Error(`Stale compressed vendor payload: ${path}`);
    checked++;
  }
  return checked;
}

if (import.meta.main) {
  const root = resolve(import.meta.dir, '..');
  const inventory = JSON.parse(readFileSync(join(root, 'runtime/vendor-manifests/inventory.json'), 'utf8'));
  // The inventory bounds this check to tracked vendor assets and declared outputs.
  console.log(`Compressed vendor pairs checked: ${checkCompressedVendors(root, inventory.files.map((f: { path: string }) => f.path))}`);
}
