import { expect, test } from 'bun:test';
import { getGeneratedWidgetCsp, getGeneratedWidgetSandbox } from '../../web/src/ui/generated-widget-policy';

for (const widget of [{ source: 'live', kind: 'html' }, { kind: 'html', capabilities: [' Interactive '] }]) {
  test(`interactive default policy: ${JSON.stringify(widget)}`, () => {
    const csp = getGeneratedWidgetCsp(widget);
    expect(csp).toContain("connect-src 'self'");
    expect(csp).toContain("frame-src 'self'");
    expect(csp).toContain("script-src 'unsafe-inline' 'self' 'wasm-unsafe-eval'");
    expect(csp).not.toContain("'unsafe-eval'");
    expect(getGeneratedWidgetSandbox(widget)).toContain('allow-scripts');
  });
}
for (const widget of [{ kind: 'html' }, { source: 'live', kind: 'svg' }, { kind: 'html', capabilities: ['wasm', 'same-origin-fetch'] }]) {
  test(`static default policy: ${JSON.stringify(widget)}`, () => {
    const csp = getGeneratedWidgetCsp(widget);
    expect(csp).toContain("connect-src 'none'");
    expect(csp).toContain("frame-src 'none'");
    expect(csp).toContain("script-src 'none'");
    expect(getGeneratedWidgetSandbox(widget)).toBe('allow-downloads');
  });
}

test('same-origin styles remain available for interactive and static widgets', () => {
  for(const policy of [{source:'live',kind:'html'},{source:'message',kind:'html'}])expect(getGeneratedWidgetCsp(policy)).toContain("style-src 'self' 'unsafe-inline'");
});
