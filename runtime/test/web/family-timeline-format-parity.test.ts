import { expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { rewriteOwnedMediaUrl } from '../../web/src/components/post.js';
import { isMermaidSourceAllowedForScopedRendering } from '../../web/src/markdown.js';

const web = join(import.meta.dir, '../../web/src');
const source = (path: string) => readFileSync(join(web, path), 'utf8');

test('family enables standard persisted renderers and owner-authorized viewing actions', () => {
  const family = source('family-chat-surface.ts');
  for (const capability of ['media', 'cards', 'widgets', 'annotations', 'thinking']) {
    expect(family).toContain(`${capability}: true`);
  }
  for (const capability of ['mediaActions', 'widgetActions', 'resourceActions', 'annotationActions', 'cardActions']) expect(family).toContain(`${capability}: true`);
  expect(family).toContain('rewriteImageSrc: rewriteOwnedMediaUrl');
  expect(family).toContain('this.postCapabilities = Object.freeze({');
  expect(family).toContain('loadMediaInfo: (mediaId: number) => this.api.request');
  expect(family).toContain('loadThinking: (messageId: number, chatJid: string) => this.api.request');
  expect(family).toContain('onOpenWidget=${');
  expect(family).toContain('onOpenAttachmentPreview=${');
  expect(family).toContain('attachmentPreview=${this.attachmentPreview}');
  expect(family).toContain('onSaveAnnotations=${async');
  expect(family).toContain('onSubmitCardAction=${async');
  expect(family).toContain("event?.kind!=='widget.submit'");
});

test('family inline and preview images accept only owner-authorized media route shapes', () => {
  expect(rewriteOwnedMediaUrl('/media/42')).toBe('/media/42');
  expect(rewriteOwnedMediaUrl('/media/42/thumbnail')).toBe('/media/42/thumbnail');
  for (const value of ['https://tracker.example/pixel.png', 'data:image/png;base64,abc', '#local-gradient', '/media/0', '/media/42/info', '/media/42?owner=bob']) {
    expect(rewriteOwnedMediaUrl(value)).toBe('');
  }
});

test('scoped Mermaid rendering rejects external resource syntax before rendering', () => {
  expect(isMermaidSourceAllowedForScopedRendering('flowchart LR\nA --> B')).toBe(true);
  expect(isMermaidSourceAllowedForScopedRendering('style A fill:url(#gradient)')).toBe(true);
  for (const source of ['click A https://foreign.example', 'image: data:image/png;base64,abc', 'style A fill:url(https://foreign.example/pixel)']) {
    expect(isMermaidSourceAllowedForScopedRendering(source)).toBe(false);
  }
});

test('shared Post separates rendering from interaction authority', () => {
  const post = source('components/post.ts');
  expect(post).toContain('readOnly: !allowCardActions');
  expect(post).toContain('rewriteResourceUrl: rewriteImageSrc');
  expect(post).toContain('onSubmitCardAction ?? submitAdaptiveCardAction');
  expect(post).toContain("if (!rendered) cardEl.textContent = block.fallback_text || 'Card failed to render.'");
  expect(post).toContain('disabled=${!allowDownload}');
  expect(post).toContain('disabled=${!canOpen}');
  expect(post).toContain("allowMediaActions ? '' : 'post-media-readonly'");
  expect(post).toContain('if (allowAnnotationActions && canAnnotate())');
  expect(post).toContain('renderMarkdown(displayContent, onHashtagClick, { rewriteImageSrc })');
});

test('family shell loads the standard markdown, math, and diagram runtimes', () => {
  const html = readFileSync(join(import.meta.dir, '../../web/static/family.html'), 'utf8');
  expect(html).toContain('/static/common/js/marked.min.js');
  expect(html).toContain('/static/common/js/vendor/katex.min.js');
  expect(html).toContain('/static/common/js/vendor/beautiful-mermaid.js');
  expect(html).toContain('owner-scoped messages, uploads, rich content and live turn controls');
  expect(html).toContain('shell, terminal, VNC and global provider/add-on controls remain unavailable');
});
