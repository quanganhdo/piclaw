import { afterEach, expect, test } from 'bun:test';

import { getAttachmentPreviewKind, getAttachmentPreviewLabel } from '../../web/src/ui/attachment-preview.js';
import { paneRegistry } from '../../web/src/panes/index.js';
import {
  buildAddonAttachmentPreviewFrameUrl,
  createAddonWebApi,
  getAddonAttachmentPreviewNote,
  registerAddonAttachmentPreview,
  registerAddonPane,
  registerAddonSettingsPane,
  registerAddonStandaloneTabUrlResolver,
  resolveAddonStandaloneTabUrl,
  resetAddonWebRegistriesForTests,
} from '../../web/src/ui/addon-web-extensions.ts';
import { getRegisteredSettingsPanes } from '../../web/src/components/settings/pane-registry.js';

afterEach(() => {
  resetAddonWebRegistriesForTests();
});

test('addon web API exposes the current chat jid to add-on settings panes', () => {
  const runtimeWindow = {
    __piclawCurrentChatJid: 'web:branch-123',
    location: { href: 'http://localhost/?chat_jid=web%3Adefault' },
  } as any;
  const api = createAddonWebApi(runtimeWindow);
  expect(api.getCurrentChatJid()).toBe('web:branch-123');

  runtimeWindow.__piclawCurrentChatJid = '';
  runtimeWindow.location.href = 'http://localhost/?chat_jid=web%3Abranch-456';
  expect(api.getCurrentChatJid()).toBe('web:branch-456');

  runtimeWindow.location.href = 'http://localhost/';
  expect(api.getCurrentChatJid()).toBe('web:default');
});

test('addon web registries support workspace panes, settings panes, standalone URLs, and attachment previews', () => {
  registerAddonPane({
    id: 'example-addon-pane',
    label: 'Example Addon Pane',
    capabilities: ['edit'],
    placement: 'tabs',
    canHandle: () => 60,
    mount() {
      return {
        getContent() { return undefined; },
        isDirty() { return false; },
        focus() {},
        dispose() {},
      };
    },
  });
  registerAddonSettingsPane({
    id: 'example-addon-settings',
    label: 'Example Addon Settings',
    icon: '⚙️',
    component() { return null; },
    order: 210,
  });
  registerAddonStandaloneTabUrlResolver((path, { hasPopOutTab } = {}) => {
    if (!/\.example$/i.test(String(path || '')) || hasPopOutTab) return null;
    return '/example-addon/view?path=' + encodeURIComponent(path);
  });
  registerAddonAttachmentPreview({
    id: 'example-preview',
    label: 'Example add-on preview',
    match(contentType, filename) {
      return String(contentType || '').toLowerCase() === 'application/x-example' || /\.example$/i.test(String(filename || ''));
    },
    buildFrameUrl(mediaId, filename) {
      return `/example-addon/view?media=${encodeURIComponent(String(mediaId))}&name=${encodeURIComponent(filename || 'sample.example')}`;
    },
    note: 'Example add-on preview note.',
  });

  expect(paneRegistry.get('example-addon-pane')).toBeTruthy();
  expect(getRegisteredSettingsPanes().some((pane) => pane.id === 'example-addon-settings')).toBe(true);
  expect(resolveAddonStandaloneTabUrl('/workspace/sample.example', { hasPopOutTab: false })).toBe('/example-addon/view?path=%2Fworkspace%2Fsample.example');
  expect(resolveAddonStandaloneTabUrl('/workspace/sample.example', { hasPopOutTab: true })).toBeNull();
  expect(getAttachmentPreviewKind('application/x-example', 'sample.example')).toBe('example-preview');
  expect(getAttachmentPreviewLabel('example-preview')).toBe('Example add-on preview');
  expect(buildAddonAttachmentPreviewFrameUrl('example-preview', 7, 'sample.example')).toContain('/example-addon/view?media=7');
  expect(getAddonAttachmentPreviewNote('example-preview')).toContain('Example add-on preview note.');
});

test('owner-bound dictation registration is unavailable globally and rollback removes selected provider', () => {
  const provider = {id:'test-dictation', label:'Test', availability:()=>({available:true}), start:async()=>({finish:async()=>({status:'finished' as const}),cancel:async()=>{}})};
  expect(() => createAddonWebApi(null).registerComposerDictationProvider(provider)).toThrow('loaded add-on');
  const rollback:Array<()=>void>=[];
  const api=createAddonWebApi(null,'test-owner',rollback);
  api.registerComposerDictationProvider(provider);api.selectComposerDictationProvider(provider.id);
  expect(rollback).toHaveLength(1);
  for(const dispose of rollback.reverse())dispose();
  expect(() => api.selectComposerDictationProvider(provider.id)).toThrow('another add-on');
});
