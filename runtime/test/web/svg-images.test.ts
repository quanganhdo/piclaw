import { expect, test } from 'bun:test';
import { renderSvgFences, escapeSvgSource, encodeSvgSource, decodeSvgSource } from '../../web/src/utils/svg-images.js';

test('ordinary Markdown is passed through once, without a DOM or external process', () => {
  let calls = 0;
  const source = 'Before [link][ref]\n\n```xml\n<svg/>\n```\n\n[ref]: /local';
  expect(renderSvgFences(source, text => { calls++; return text; }, () => { throw Error('unexpected SVG'); })).toBe(source);
  expect(calls).toBe(1);
});

test('incomplete SVG preserves exact CRLF/entity source without XML parsing', () => {
  const source = '<svg><text>&lt;name&gt;</text>\r\n';
  const result = renderSvgFences('```SVG\r\n' + source, text => text, text => `<pre>${escapeSvgSource(text)}</pre>`);
  expect(result).toContain('&lt;svg&gt;'); expect(result).toContain('&amp;lt;name&amp;gt;');
  expect(result).toContain('\r\n'); expect(result).not.toContain('PICLAWSVG');
  expect(decodeSvgSource(encodeSvgSource(source))).toBe(source);
});

test('SVG-looking fences inside another fence or YAML frontmatter stay ordinary Markdown', () => {
  for (const source of ['````markdown\n```svg\n<svg/>\n```\n````', '---\nexample: |\n```svg\n<svg/>\n```\n---\nbody']) {
    expect(renderSvgFences(source, text => text, () => { throw Error('nested SVG'); })).toBe(source);
  }
});
