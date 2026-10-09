import { test, expect } from 'bun:test';
import { CdpViewConnection, registerCdpViewSource, assertCdpViewToolControl } from '../../../src/channels/web/cdp-view.js';
import { cdpPoint } from '../../../web/src/panes/cdp-pane.js';

test('scale-to-fit input excludes letterboxing and maps viewport coordinates', () => {
  const rect = { left: 10, top: 20, width: 800, height: 800 };
  expect(cdpPoint(rect, 1600, 900, 1600, 900, 410, 420)).toEqual({ x: 800, y: 450 });
  expect(cdpPoint(rect, 1600, 900, 1600, 900, 410, 21)).toBeNull();
  expect(cdpPoint(rect, 1600, 900, 3200, 1800, 410, 420)).toEqual({ x: 1600, y: 900 });
});

test('trusted sources validate identity and cannot overwrite another browser', () => {
  expect(() => registerCdpViewSource({ id: 'cdp', label: 'bad', port: 9224 })).toThrow();
  expect(() => registerCdpViewSource({ id: 'other', label: 'bad', port: 80 })).toThrow();
  const close = registerCdpViewSource({ id: 'fixture', label: 'test', port: 19333 });
  expect(() => registerCdpViewSource({ id: 'fixture', label: 'test', port: 19334 })).toThrow();
  close(); close();
  registerCdpViewSource({ id: 'fixture', label: 'test', port: 19334 })();
});

test('unattached viewer refuses input and arbitrary commands; close is idempotent', async () => {
  const output: any[] = [];
  const view = new CdpViewConnection({ send: value => output.push(JSON.parse(value)), close() {} });
  view.message(JSON.stringify({ type: 'input', kind: 'text', text: 'no' }));
  view.message(JSON.stringify({ type: 'Runtime.evaluate', expression: 'bad' }));
  view.message('null');
  await Bun.sleep(10);
  expect(output.map(row => row.type)).toEqual(['error', 'error', 'error']);
  expect(output.some(row => row.message.includes('Take control'))).toBe(true);
  expect(() => assertCdpViewToolControl('cdp')).not.toThrow();
  view.close(); view.close();
});
