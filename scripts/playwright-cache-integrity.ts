#!/usr/bin/env bun
import { createHash } from 'node:crypto';
import { existsSync, lstatSync, mkdirSync, readFileSync, readdirSync, readlinkSync, rmSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { homedir } from 'node:os';

const manifestName = '.piclaw-browser-cache-integrity.json';
export function browserManifest(root: string): Record<string, string> {
  const files: Record<string, string> = {};
  function scan(dir: string, prefix: string) {
    for (const name of readdirSync(dir).sort()) {
      if (!prefix && name === manifestName) continue;
      const path = join(dir, name);
      const relative = prefix ? `${prefix}/${name}` : name;
      const stat = lstatSync(path);
      if (stat.isSymbolicLink()) files[relative] = `link:${readlinkSync(path)}`;
      else if (stat.isDirectory()) scan(path, relative);
      else if (stat.isFile()) files[relative] = `${stat.mode & 0o777}:${createHash('sha256').update(readFileSync(path)).digest('hex')}`;
      else throw new Error('Unexpected browser cache entry');
    }
  }
  scan(root, '');
  return files;
}

export function verifyBrowserCache(root: string): 'cold' | 'warm' | 'discarded' {
  if (!existsSync(root)) return 'cold';
  try {
    const expected = JSON.parse(readFileSync(join(root, manifestName), 'utf8'));
    if (JSON.stringify(expected) === JSON.stringify(browserManifest(root))) return 'warm';
  } catch { /* Missing or malformed integrity record is a cache miss. */ }
  rmSync(root, { recursive: true, force: true });
  return 'discarded';
}

export function saveBrowserManifest(root: string): void {
  mkdirSync(root, { recursive: true });
  writeFileSync(join(root, manifestName), `${JSON.stringify(browserManifest(root))}\n`);
}

if (import.meta.main) {
  // No configurable deletion target: production only touches Playwright's default cache.
  const root = resolve(homedir(), '.cache/ms-playwright');
  if (process.argv[2] === 'verify') console.log(`Browser cache: ${verifyBrowserCache(root)}`);
  else if (process.argv[2] === 'record') saveBrowserManifest(root);
  else throw new Error('Expected verify or record');
}
