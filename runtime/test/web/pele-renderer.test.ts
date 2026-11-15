import { expect, test } from 'bun:test';
import { renderDiagram, DIAGRAM_LIMITS } from '../../web/src/vendor/pele-entry';
import { DIAGRAM_CORPUS } from './fixtures/diagram-corpus';

for (const fixture of DIAGRAM_CORPUS) test(`Pele corpus: ${fixture.name}`, () => {
  const svg = renderDiagram(fixture.source);
  expect(svg).toStartWith('<svg');
  expect(svg).toContain(`pele-${fixture.type}`);
  expect(svg).toContain('viewBox=');
  expect(svg).not.toMatch(/NaN|Infinity|<script|<foreignObject|@import/);
  for (const label of fixture.labels) expect(svg.replaceAll('&amp;', '&')).toContain(label);
  expect(svg).toContain('--pele-fg:var(--text-primary');
  expect(svg).toContain('--pele-bg:var(--bg-primary');
  expect(svg).toContain('--pele-series-1:var(--accent-color');
});

test('Pele adapter preserves explicit direction and fixed authored paints', () => {
  const horizontal = renderDiagram('flowchart LR\nA-->B');
  const vertical = renderDiagram('flowchart TD\nA-->B');
  const size = (svg: string) => svg.match(/viewBox="0 0 ([\d.]+) ([\d.]+)"/)!.slice(1).map(Number);
  const [width, height] = size(horizontal), [verticalWidth, verticalHeight] = size(vertical);
  expect(width).toBeGreaterThan(height);
  expect(verticalHeight).toBeGreaterThan(verticalWidth);
  expect(renderDiagram('flowchart LR\nA[Authored]\nstyle A fill:#879a39')).toContain('#879a39');
});

test('Pele adapter gives each diagram distinct accessibility references', () => {
  const source = 'flowchart LR\naccTitle: Pipeline\naccDescr: Input to output\nA-->B';
  const first = renderDiagram(source), second = renderDiagram(source);
  const ids = (svg: string) => Array.from(svg.matchAll(/(?<![-\w])id="([^"]+)"/g), match => match[1]);
  expect(ids(first).length).toBeGreaterThan(0);
  expect(ids(first).some(id => ids(second).includes(id))).toBe(false);
  expect(first).toContain('aria-labelledby=');
});

test('Pele adapter never enables new diagram navigation or resource loads', () => {
  for (const url of ['https://foreign.invalid/pixel', '/media/42', 'javascript:alert(1)', '//foreign.invalid/pixel']) {
    const svg = renderDiagram(`flowchart LR\nA-->B\nclick A "${url}"`);
    expect(svg).not.toMatch(/<a\b|<image\b|href=/);
  }
});

test('Pele adapter retains size/output/edge limits and rejects invalid source', () => {
  expect(DIAGRAM_LIMITS).toEqual({ limit: 50_000, outputLimit: 4_000_000, maxEdges: 5_000 });
  expect(() => renderDiagram('flowchart LR\n' + ' '.repeat(50_000))).toThrow();
  expect(() => renderDiagram('unknownDiagram\n<img src=x>')).toThrow();
  expect(() => renderDiagram('flowchart LR\n' + Array.from({ length: 5001 }, (_, i) => `A-->B${i}`).join('\n'))).toThrow();
});
