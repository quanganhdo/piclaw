import { expect, test } from 'bun:test';

import { normalizeStatusHints } from '../../web/src/components/status.ts';

test('normalizeStatusHints keeps SVG-based extension hints renderable by the status UI', () => {
  const hints = normalizeStatusHints([
    {
      key: 'ssh',
      icon_svg: '<svg viewBox="0 0 24 24"><rect x="5" y="11" width="14" height="10" rx="2"></rect></svg>',
      label: 'agent@example.com',
      title: 'SSH target',
    },
    {
      key: 'addon-service',
      icon_svg: '<svg viewBox="0 0 24 24"><rect x="3" y="3" width="8" height="8"></rect></svg>',
      label: 'api.example.com',
      title: 'Add-on service target',
    },
  ]);

  expect(hints).toEqual([
    {
      key: 'ssh',
      iconSvg: '<svg viewBox="0 0 24 24"><rect x="5" y="11" width="14" height="10" rx="2"></rect></svg>',
      label: 'agent@example.com',
      title: 'SSH target',
    },
    {
      key: 'addon-service',
      iconSvg: '<svg viewBox="0 0 24 24"><rect x="3" y="3" width="8" height="8"></rect></svg>',
      label: 'api.example.com',
      title: 'Add-on service target',
    },
  ]);
});

test('normalizeStatusHints drops incomplete hint records', () => {
  expect(normalizeStatusHints([
    { key: 'bad-a', icon_svg: '', label: 'missing icon' },
    { key: 'bad-b', icon_svg: '<svg></svg>', label: '' },
    { key: 'ok', icon_svg: '<svg></svg>', label: 'pve.example.com:8006' },
  ])).toEqual([
    {
      key: 'ok',
      iconSvg: '<svg></svg>',
      label: 'pve.example.com:8006',
      title: '',
    },
  ]);
});
