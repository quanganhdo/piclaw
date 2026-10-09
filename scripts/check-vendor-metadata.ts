#!/usr/bin/env bun
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { join, resolve, relative } from 'node:path';

export function checkVendorMetadata(root: string, manifests: string[]): { checked: number; failures: string[] } {
  const failures: string[] = [];
  let checked = 0;
  for (const path of [...manifests].sort()) {
    const manifest = JSON.parse(readFileSync(join(root, path), 'utf8'));
    if (!manifest.metadataFile) continue;
    const runtime = join(root, 'runtime');
    const metadata = JSON.parse(readFileSync(join(runtime, manifest.metadataFile), 'utf8'));
    if (metadata.manifest_id !== manifest.id) failures.push(`${path}: manifest identity mismatch`);
    const outputs = metadata.output_files ?? [{ output_file: metadata.output_file, sha256: metadata.sha256, size_bytes: metadata.size_bytes }];
    for (const output of outputs) {
      const target = resolve(runtime, output.output_file ?? '');
      if (!relative(runtime, target).startsWith('web/') && !relative(runtime, target).startsWith('extensions/')) {
        failures.push(`${path}: output outside vendor roots`); continue;
      }
      try {
        const bytes = readFileSync(target);
        const hash = createHash('sha256').update(bytes).digest('hex');
        if (hash !== output.sha256 || bytes.length !== output.size_bytes) failures.push(`${path}: stale output ${output.output_file}`);
        checked++;
      } catch { failures.push(`${path}: missing output ${output.output_file}`); }
    }
  }
  return { checked, failures };
}

if (import.meta.main) {
  const root = resolve(import.meta.dir, '..');
  const list = Bun.spawnSync(['git', 'ls-files', 'runtime/vendor-manifests/*.json'], { cwd: root, stdout: 'pipe' });
  if (list.exitCode) throw Error('Cannot list vendor manifests');
  const result = checkVendorMetadata(root, list.stdout.toString().trim().split('\n').filter(Boolean));
  console.log(JSON.stringify(result, null, 2));
  if (result.failures.length && !process.argv.includes('--report')) process.exit(1);
}
