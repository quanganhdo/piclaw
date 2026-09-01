import { expect, test } from 'bun:test';
import { buildDocumentViewerUrl, resolveDocumentViewerReference } from '../../web/src/panes/document-viewer-pane.js';

const vault = 'obsidian:////workspace/vaults/learning/Learning/Staff%20Systems/Unit%2001#Reading%20packet';
const qmd = 'qmd://books/designing-data-intensive-applications/chapters/summary.md:59:66';

test('document viewer resolves strict Vault and QMD references', () => {
  expect(resolveDocumentViewerReference(vault)).toEqual({ kind: 'vault', reference: vault });
  expect(resolveDocumentViewerReference(qmd)).toEqual({ kind: 'qmd', reference: qmd });
  expect(resolveDocumentViewerReference('obsidian:////workspace/vaults/private/Secret')).toBeNull();
  expect(resolveDocumentViewerReference('qmd://books/../secret.md')).toBeNull();
  expect(resolveDocumentViewerReference('https://example.com')).toBeNull();
});

test('document viewer routes both renderer types in embedded mode', () => {
  expect(buildDocumentViewerUrl(vault)).toBe(`/vault-viewer/?ref=${encodeURIComponent(vault)}&embedded=1`);
  expect(buildDocumentViewerUrl(qmd)).toBe(`/qmd-viewer/?ref=${encodeURIComponent(qmd)}&embedded=1`);
  expect(buildDocumentViewerUrl('javascript:alert(1)')).toBeNull();
});
