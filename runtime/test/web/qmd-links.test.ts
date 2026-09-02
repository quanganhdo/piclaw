import { expect, test } from 'bun:test';
import { dispatchQmdViewerOpen, qmdLinkLabel, sanitizeQmdHref } from '../../web/src/qmd-links.js';

test('sanitizeQmdHref preserves safe collection and document-ID references', () => {
  expect(sanitizeQmdHref('qmd://books/designing%20systems/chapter.md:10:20')).toBe(
    'qmd://books/designing%20systems/chapter.md:10:20',
  );
  expect(sanitizeQmdHref('qmd://doc/%23abc123:4')).toBe('qmd://doc/%23abc123:4');
  expect(sanitizeQmdHref('qmd:#abc123')).toBe('qmd:#abc123');
  expect(qmdLinkLabel('qmd://books/path/chapter.md:10:20')).toBe('chapter.md');
});

test('sanitizeQmdHref rejects credentials, queries, traversal, and non-Markdown paths', () => {
  expect(sanitizeQmdHref('qmd://user:pass@books/chapter.md')).toBeNull();
  expect(sanitizeQmdHref('qmd://books/chapter.md?download=1')).toBeNull();
  expect(sanitizeQmdHref('qmd://books/folder/%2Fetc.md')).toBeNull();
  expect(sanitizeQmdHref('qmd://books/../private.md')).toBeNull();
  expect(sanitizeQmdHref('qmd://books/folder/%2e%2e/private.md')).toBeNull();
  expect(sanitizeQmdHref('qmd://books/chapter.html')).toBeNull();
});

test('dispatchQmdViewerOpen emits the generic pane event for validated references', () => {
  const events: CustomEvent[] = [];
  const target = { dispatchEvent: (event: CustomEvent) => { events.push(event); return true; } } as unknown as EventTarget;
  expect(dispatchQmdViewerOpen(target, 'qmd://books/chapter.md:5:10')).toBe(true);
  expect(events[0]?.type).toBe('pane:open-tab');
  expect(events[0]?.detail).toEqual({ path: 'qmd://books/chapter.md:5:10', label: 'chapter.md' });
  expect(dispatchQmdViewerOpen(target, 'javascript:alert(1)')).toBe(false);
});
