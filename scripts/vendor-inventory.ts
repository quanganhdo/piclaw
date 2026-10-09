#!/usr/bin/env bun
import { createHash } from 'node:crypto';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

export interface InventoryFile { path: string; bytes: number; sha256: string; manifests: string[]; provenance: 'manifest-linked' | 'unrecorded' }
export function isVendorAsset(path: string): boolean {
  return /^(runtime\/web\/static\/|skel\/)/.test(path) &&
    (/(?:^|\/)vendor\//.test(path) || /\.(?:wasm|woff2?|ttf|otf)$/.test(path));
}
export function buildInventory(root: string, tracked: string[]) {
  const assets = new Set(tracked.filter(isVendorAsset));
  const links = new Map<string, Set<string>>();
  const manifests = tracked.filter(path => /^runtime\/vendor-manifests\/.*\.json$/.test(path)).sort();
  function link(path: string, manifest: string) {
    if (!tracked.includes(path)) return;
    assets.add(path);
    const owners = links.get(path) ?? new Set(); owners.add(manifest); links.set(path, owners);
  }
  for (const manifest of manifests) {
    const data = JSON.parse(readFileSync(join(root, manifest), 'utf8'));
    for (const value of [data.outputFile, data.outputCss]) if (typeof value === 'string') link(`runtime/${value}`, manifest);
    if (typeof data.outputDir === 'string') {
      const prefix = `runtime/${data.outputDir}/`;
      for (const path of tracked) if (path.startsWith(prefix)) link(path, manifest);
    }
    for (const entry of data.exports ?? []) if (typeof entry.to === 'string') link(`runtime/${entry.to}`, manifest);
    // Linking identifies declared ownership, not verified upstream authenticity.
  }
  const files: InventoryFile[] = [...assets].sort().map(path => {
    const content = readFileSync(join(root, path));
    const owners = [...(links.get(path) ?? [])].sort();
    return { path, bytes: content.length, sha256: createHash('sha256').update(content).digest('hex'),
      manifests: owners, provenance: owners.length ? 'manifest-linked' : 'unrecorded' };
  });
  const groups = new Map<string, string[]>();
  for (const file of files) { const paths = groups.get(file.sha256) ?? []; paths.push(file.path); groups.set(file.sha256, paths); }
  return { schemaVersion: 1, scope: 'tracked core/skel vendor directories, fonts, WASM and declared vendor outputs',
    files, duplicatePayloads: [...groups.values()].filter(paths => paths.length > 1),
    unrecorded: files.filter(file => file.provenance === 'unrecorded').map(file => file.path) };
}

if (import.meta.main) {
  const root = resolve(import.meta.dir, '..');
  const proc = Bun.spawnSync(['git', 'ls-files', '-z'], { cwd: root, stdout: 'pipe' });
  if (proc.exitCode) throw Error('Cannot inventory tracked files');
  const tracked = proc.stdout.toString().split('\0').filter(Boolean);
  const text = `${JSON.stringify(buildInventory(root, tracked), null, 2)}\n`;
  const path = join(root, 'runtime/vendor-manifests/inventory.json');
  if (process.argv.includes('--write')) writeFileSync(path, text);
  else if (process.argv.includes('--check')) {
    if (!existsSync(path) || readFileSync(path, 'utf8') !== text) throw Error('Vendor inventory stale; run bun scripts/vendor-inventory.ts --write');
    console.log('Tracked vendor inventory checksums match.');
  } else console.log(text.trimEnd());
}
