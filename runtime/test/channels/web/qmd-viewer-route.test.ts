import { expect, test } from 'bun:test';
import { QmdDocumentError } from '../../../src/channels/web/http/qmd-document-service.js';
import { parseQmdReference, QmdReferenceError } from '../../../src/channels/web/http/qmd-reference.js';
import { generateQmdViewerPage, handleQmdViewerRoute } from '../../../src/channels/web/http/qmd-viewer-route.js';

test('parseQmdReference accepts collection paths, document IDs, and bounded line ranges', () => {
  expect(parseQmdReference('qmd://books/designing-data-intensive-applications/chapters/008-summary.md:100:40')).toEqual({
    uri: 'qmd://books/designing-data-intensive-applications/chapters/008-summary.md:100:40',
    file: 'qmd://books/designing-data-intensive-applications/chapters/008-summary.md',
    title: '008-summary.md',
    collection: 'books',
    path: 'designing-data-intensive-applications/chapters/008-summary.md',
    fromLine: 100,
    maxLines: 40,
  });
  expect(parseQmdReference('qmd://doc/%23abc123:7')).toMatchObject({
    uri: 'qmd://doc/%23abc123:7',
    file: '#abc123',
    title: '#abc123',
    docId: 'abc123',
    fromLine: 7,
  });
  expect(parseQmdReference('qmd:#abc123:9:3')).toMatchObject({ file: '#abc123', fromLine: 9, maxLines: 3 });
});

test('parseQmdReference rejects unsafe or unbounded references', () => {
  const invalid = [
    'https://example.com/doc.md',
    'qmd://user:pass@books/chapter.md',
    'qmd://books/chapter.txt',
    'qmd://books/folder/%2Fetc.md',
    'qmd://books/../private.md',
    'qmd://books/folder/%2e%2e/private.md',
    'qmd://books/chapter.md?raw=1',
    'qmd://books/chapter.md:0',
    'qmd://books/chapter.md:1:5001',
    'qmd://doc/%23ab',
  ];
  for (const reference of invalid) {
    expect(() => parseQmdReference(reference), reference).toThrow(QmdReferenceError);
  }
});

test('QMD viewer page is same-origin, CSP constrained, and fetches the authenticated document endpoint', () => {
  const page = generateQmdViewerPage();
  expect(page).toContain('/qmd-viewer/document?ref=');
  expect(page).toContain('/static/common/js/marked.min.js');
  expect(page).toContain("safeTags = new Set");
  expect(page).not.toContain('allow-scripts');
});

test('QMD document route validates and resolves references through the injected service', async () => {
  let received: ReturnType<typeof parseQmdReference> | null = null;
  const ref = 'qmd://books/system-design/chapter.md:12:8';
  const response = await handleQmdViewerRoute(
    new Request(`https://example.com/qmd-viewer/document?ref=${encodeURIComponent(ref)}`),
    '/qmd-viewer/document',
    { fetchDocument: async (reference) => { received = reference; return '# Chapter\n\nSafe content.'; } },
  );
  expect(response?.status).toBe(200);
  expect(received).toMatchObject({ collection: 'books', path: 'system-design/chapter.md', fromLine: 12, maxLines: 8 });
  expect(await response?.json()).toEqual({
    title: 'chapter.md',
    source: ref,
    markdown: '# Chapter\n\nSafe content.',
    fromLine: 12,
    maxLines: 8,
  });
});

test('QMD document route returns bounded public errors', async () => {
  const invalid = await handleQmdViewerRoute(
    new Request('https://example.com/qmd-viewer/document?ref=javascript%3Aalert(1)'),
    '/qmd-viewer/document',
  );
  expect(invalid?.status).toBe(400);

  const missing = await handleQmdViewerRoute(
    new Request('https://example.com/qmd-viewer/document?ref=qmd%3A%2F%2Fbooks%2Fmissing.md'),
    '/qmd-viewer/document',
    { fetchDocument: async () => { throw new QmdDocumentError(404, 'QMD document not found.'); } },
  );
  expect(missing?.status).toBe(404);
  expect(await missing?.json()).toEqual({ error: 'QMD document not found.' });

  const method = await handleQmdViewerRoute(
    new Request('https://example.com/qmd-viewer/document', { method: 'POST' }),
    '/qmd-viewer/document',
  );
  expect(method?.status).toBe(405);
});
