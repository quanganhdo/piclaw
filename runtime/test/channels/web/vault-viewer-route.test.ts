import { afterEach, expect, test } from 'bun:test';
import { mkdtemp, mkdir, rm, symlink, truncate, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { fetchVaultAsset, fetchVaultDocument } from '../../../src/channels/web/http/vault-document-service.js';
import { parseVaultReference } from '../../../src/channels/web/http/vault-reference.js';
import { generateVaultViewerPage, handleVaultViewerRoute } from '../../../src/channels/web/http/vault-viewer-route.js';

const roots: string[] = [];
afterEach(async () => { await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true }))); });

const unitRef = 'obsidian:////workspace/vaults/learning/Learning/Staff%20Systems/Unit%2001%20-%20Product%20Contract%2C%20Boundaries%2C%20and%20State%20Ownership#Reading%20packet';

test('parseVaultReference accepts only canonical learning-vault notes and preserves headings', () => {
  expect(parseVaultReference(unitRef)).toEqual({
    uri: unitRef,
    path: 'Learning/Staff Systems/Unit 01 - Product Contract, Boundaries, and State Ownership.md',
    title: 'Unit 01 - Product Contract, Boundaries, and State Ownership',
    heading: 'Reading packet',
  });
  expect(parseVaultReference('obsidian:////workspace/vaults/learning/Learning/Note.md').uri).toBe(
    'obsidian:////workspace/vaults/learning/Learning/Note',
  );

  const invalid = [
    'https://example.com/note.md',
    'obsidian:///workspace/vaults/learning/Learning/Note',
    'obsidian:////workspace/vaults/private/Note',
    'obsidian:////workspace/vaults/learning/Learning/../private/Note',
    'obsidian:////workspace/vaults/learning/Learning/%2e%2e/private/Note',
    'obsidian:////workspace/vaults/learning/Learning%2Fprivate/Note',
    'obsidian:////workspace/vaults/learning/Learning/Note?raw=1',
  ];
  for (const value of invalid) expect(() => parseVaultReference(value)).toThrow();
});

test('vault document and assets are bounded by realpath, type, and size checks', async () => {
  const sandbox = await mkdtemp(join(tmpdir(), 'vault-viewer-'));
  roots.push(sandbox);
  const root = join(sandbox, 'vault');
  await mkdir(join(root, 'Learning', 'Unit', 'assets'), { recursive: true });
  await writeFile(join(root, 'Learning', 'Unit', 'note.md'), '# Safe note\n');
  const png = Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00]);
  await writeFile(join(root, 'Learning', 'Unit', 'assets', 'image.png'), png);
  await writeFile(join(root, 'Learning', 'Unit', 'assets', 'handout.pdf'), '%PDF-1.7\n');
  await writeFile(join(root, 'Learning', 'Unit', 'assets', 'fake.png'), 'not a png');
  await writeFile(join(root, 'Learning', 'Unit', 'assets', 'vector.svg'), '<svg/>');
  await writeFile(join(root, 'Learning', 'Unit', 'large.md'), '# Large\n');
  await writeFile(join(root, 'Learning', 'Unit', 'assets', 'large.png'), png);
  await truncate(join(root, 'Learning', 'Unit', 'large.md'), 2 * 1024 * 1024 + 1);
  await truncate(join(root, 'Learning', 'Unit', 'assets', 'large.png'), 12 * 1024 * 1024 + 1);
  await writeFile(join(sandbox, 'outside.md'), '# Outside\n');
  await symlink(join(sandbox, 'outside.md'), join(root, 'Learning', 'Unit', 'escape.md'));
  await symlink(join(root, 'Learning', 'Unit', 'note.md'), join(root, 'Learning', 'Unit', 'alias.md'));

  const reference = parseVaultReference('obsidian:////workspace/vaults/learning/Learning/Unit/note');
  expect(await fetchVaultDocument(reference, root)).toBe('# Safe note\n');
  expect(await fetchVaultAsset(reference, 'assets/image.png', root)).toEqual({ bytes: png, mimeType: 'image/png' });
  expect((await fetchVaultAsset(reference, 'assets/handout.pdf', root)).mimeType).toBe('application/pdf');

  const escaped = parseVaultReference('obsidian:////workspace/vaults/learning/Learning/Unit/escape');
  const aliased = parseVaultReference('obsidian:////workspace/vaults/learning/Learning/Unit/alias');
  await expect(fetchVaultDocument(escaped, root)).rejects.toMatchObject({ status: 404 });
  await expect(fetchVaultDocument(aliased, root)).rejects.toMatchObject({ status: 404 });
  await expect(fetchVaultAsset(reference, '../../../outside.png', root)).rejects.toMatchObject({ status: 403 });
  await expect(fetchVaultAsset(reference, 'assets/missing.png', root)).rejects.toMatchObject({ status: 404 });
  await expect(fetchVaultAsset(reference, 'assets/vector.svg', root)).rejects.toMatchObject({ status: 415 });
  await expect(fetchVaultAsset(reference, 'assets/fake.png', root)).rejects.toMatchObject({ status: 415 });
  await expect(fetchVaultAsset(reference, 'assets/large.png', root)).rejects.toMatchObject({ status: 413 });
  const large = parseVaultReference('obsidian:////workspace/vaults/learning/Learning/Unit/large');
  await expect(fetchVaultDocument(large, root)).rejects.toMatchObject({ status: 413 });
});

test('vault viewer page reuses the authenticated Markdown viewer pattern with wiki links and anchors', () => {
  const page = generateVaultViewerPage();
  expect(page).toContain('/vault-viewer/document?ref=');
  expect(page).toContain('/vault-viewer/asset?ref=');
  expect(page).toContain('rewriteWikiLinks');
  expect(page).toContain('scrollToHeading');
  expect(page).toContain('navigationEntries');
  expect(page).toContain('captureCurrentPosition');
  expect(page).toContain('moveInHistory');
  expect(page).toContain('aria-label="Back"');
  expect(page).not.toContain('history.pushState');
  expect(page).toContain("location.href = '/qmd-viewer/?ref='");
  expect(page).toContain("safeTags = new Set");
  const scriptStart = page.indexOf('<script>\n(function');
  const scriptEnd = page.indexOf('</script>', scriptStart);
  expect(() => new Function(page.slice(scriptStart + 8, scriptEnd))).not.toThrow();
});

test('vault document and asset routes return bounded responses', async () => {
  let receivedPath = '';
  const document = await handleVaultViewerRoute(
    new Request(`https://example.com/vault-viewer/document?ref=${encodeURIComponent(unitRef)}`),
    '/vault-viewer/document',
    { fetchDocument: async (reference) => { receivedPath = reference.path; return '# Unit\n'; } },
  );
  expect(document.status).toBe(200);
  expect(receivedPath).toContain('Unit 01 - Product Contract');
  expect(await document.json()).toMatchObject({ heading: 'Reading packet', markdown: '# Unit\n' });

  const pdf = Uint8Array.from(Buffer.from('%PDF-1.7\n'));
  const asset = await handleVaultViewerRoute(
    new Request(`https://example.com/vault-viewer/asset?ref=${encodeURIComponent(unitRef)}&path=${encodeURIComponent('artifact.pdf')}`),
    '/vault-viewer/asset',
    { fetchAsset: async () => ({ bytes: pdf, mimeType: 'application/pdf' }) },
  );
  expect(asset.status).toBe(200);
  expect(asset.headers.get('content-type')).toBe('application/pdf');
  expect(asset.headers.get('x-content-type-options')).toBe('nosniff');
  expect(asset.headers.get('cross-origin-resource-policy')).toBe('same-origin');

  const invalid = await handleVaultViewerRoute(
    new Request('https://example.com/vault-viewer/document?ref=obsidian%3A%2F%2F%2F%2Fetc%2Fpasswd'),
    '/vault-viewer/document',
  );
  expect(invalid.status).toBe(400);
});
