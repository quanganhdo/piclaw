import { readdirSync, readFileSync, existsSync } from 'node:fs';
import { join, relative, resolve, dirname } from 'node:path';

const root = resolve(import.meta.dir, '../..');
const preload = join(root, 'runtime/test/setup-filesystem-isolation.ts');
const dirs = new Set<string>();
function walk(dir: string) {
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    if (['node_modules', '.git', '.tmp', 'generated', 'reports', 'test-results'].includes(e.name)) continue;
    const p = join(dir, e.name);
    if (e.isDirectory()) walk(p);
    else if (/\.(test|spec)\.[cm]?[jt]sx?$/.test(e.name)) dirs.add(dirname(p));
  }
}
walk(join(root, 'runtime/test')); walk(join(root, 'tests'));
for (const dir of dirs) {
  const expected = `[test]\npreload = ["${relative(dir, preload).replaceAll('\\', '/').replace(/^(?!\.)/, './')}"]\n`;
  const file = join(dir, 'bunfig.toml');
  if (!existsSync(file) || readFileSync(file, 'utf8').replace(/\r\n/g, '\n') !== expected) throw new Error(`Missing test-directory isolation preload: ${relative(root, dir)}`);
}
console.log(`Test preload coverage: ${dirs.size} test directories`);
