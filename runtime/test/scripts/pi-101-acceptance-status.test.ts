import { expect, test } from 'bun:test';
import { readFileSync, existsSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { missingSeams } from '../../../scripts/check-earendil-mcp-public-101.js';
const root = resolve(import.meta.dir, '../../..');
const evidence = 'docs/design/earendil-agent-harness-integration-adr/evidence/';
const path = resolve(root, evidence, 'earendil-101-remaining-acceptance.md');
const text = readFileSync(path, 'utf8');
test('current acceptance inventory keeps all MCP and AUTH requirements distinct', () => {
  for (const [prefix, count] of [['MCP', 15], ['AUTH', 8]] as const) {
    for (let n = 1; n <= count; n++) expect(text.match(new RegExp(`^\\| ${prefix}-${String(n).padStart(2, '0')} `, 'gm'))).toHaveLength(1);
  }
  for (const seam of missingSeams) expect(text).toContain(`| \`${seam.symbol}\` | ${seam.code} | ${seam.requirement} |`);
});
test('acceptance document links exist and both indexes expose it', () => {
  const files = [path, resolve(root, evidence, 'README.md'), resolve(root, 'docs/design/earendil-agent-harness-integration-adr/README.md')];
  for (const file of files) {
    const body = readFileSync(file, 'utf8');
    for (const match of body.matchAll(/\[[^\]]*\]\(([^)]+)\)/g)) {
      const link = match[1].split('#')[0];
      if (!link || /^https?:/.test(link)) continue;
      expect(existsSync(resolve(dirname(file), link)), `${file}: ${link}`).toBe(true);
    }
  }
  for (const file of files.slice(1)) expect(readFileSync(file, 'utf8')).toContain('earendil-101-remaining-acceptance.md');
});
test('acceptance status preserves activation, rollout and historical boundaries', () => {
  for (const phrase of ['Pi-durable qualification and implementation are outside this task', 'installer remains inactive', 'Core still pins `2400aec`', 'closure is not evidence of a fix', 'separate permission for installation, restart', 'Historical 0.99.1/1.0.0 fixtures and receipts retain their original status']) expect(text).toContain(phrase);
  expect(text).toContain('1534040a19b1841bb64cdc80797176531ba9efff');
  expect(text).toContain('a7229ddc21810d6245105978033b7df645ecc2f7');
});
