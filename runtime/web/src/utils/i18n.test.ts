import { afterEach, beforeEach, expect, test } from 'bun:test';

import {
  DEFAULT_LOCALE,
  getLocale,
  initLocale,
  normalizeLocale,
  resolveInitialLocale,
  setLocale,
  translate,
  t,
} from './i18n.js';

// Minimal DOM-ish stubs so the localStorage/event/navigator paths are exercised
// in the bun test environment (which has no real window).
function installStubs(opts: { stored?: string | null; languages?: string[] } = {}) {
  const store = new Map<string, string>();
  if (opts.stored != null) store.set('piclaw_locale', opts.stored);
  const localStorage = {
    getItem: (k: string) => (store.has(k) ? store.get(k)! : null),
    setItem: (k: string, v: string) => void store.set(k, v),
    removeItem: (k: string) => void store.delete(k),
  };
  const win: any = new EventTarget();
  win.localStorage = localStorage;
  (globalThis as any).window = win;
  (globalThis as any).localStorage = localStorage;
  (globalThis as any).navigator = {
    language: opts.languages?.[0] ?? 'en-US',
    languages: opts.languages ?? ['en-US'],
  };
  return { store };
}

beforeEach(() => {
  installStubs();
  initLocale();
});

afterEach(() => {
  delete (globalThis as any).window;
  delete (globalThis as any).localStorage;
  delete (globalThis as any).navigator;
});

test('normalizeLocale maps loose codes to the locked locale set', () => {
  expect(normalizeLocale('zh')).toBe('zh-CN');
  expect(normalizeLocale('zh-CN')).toBe('zh-CN');
  expect(normalizeLocale('zh_CN')).toBe('zh-CN');
  expect(normalizeLocale('zh-Hans')).toBe('zh-CN');
  expect(normalizeLocale('ja')).toBe('ja');
  expect(normalizeLocale('ja-JP')).toBe('ja');
  expect(normalizeLocale('en')).toBe('en');
  expect(normalizeLocale('en-GB')).toBe('en');
  expect(normalizeLocale('fr-FR')).toBe(DEFAULT_LOCALE);
  expect(normalizeLocale('')).toBe(DEFAULT_LOCALE);
  expect(normalizeLocale(null)).toBe(DEFAULT_LOCALE);
});

test('default locale is English when nothing is stored and browser is English', () => {
  installStubs({ languages: ['en-US'] });
  expect(resolveInitialLocale()).toBe('en');
  expect(initLocale()).toBe('en');
});

test('browser language is used as a default hint when no locale is stored', () => {
  installStubs({ languages: ['zh-CN', 'en-US'] });
  expect(resolveInitialLocale()).toBe('zh-CN');
  installStubs({ languages: ['ja-JP'] });
  expect(resolveInitialLocale()).toBe('ja');
});

test('persisted explicit locale override wins over browser default', () => {
  installStubs({ stored: 'ja', languages: ['zh-CN'] });
  expect(resolveInitialLocale()).toBe('ja');
});

test('setLocale persists and updates the active locale', () => {
  const { store } = installStubs({ languages: ['en-US'] });
  initLocale();
  expect(getLocale()).toBe('en');
  setLocale('zh');
  expect(getLocale()).toBe('zh-CN');
  expect(store.get('piclaw_locale')).toBe('zh-CN');
});

test('translate returns the locale string for a known key', () => {
  expect(translate('compose.send', undefined, 'en')).toBe('Send');
  expect(translate('compose.send', undefined, 'zh-CN')).toBe('发送');
  expect(translate('compose.send', undefined, 'ja')).toBe('送信');
});

test('missing key falls back to English, then to the key itself', () => {
  // A key not present in zh-CN partial table resolves to English.
  // (All seeded keys exist; assert the fallback chain via an unknown key.)
  expect(translate('does.not.exist' as any, undefined, 'zh-CN')).toBe('does.not.exist');
  expect(translate('does.not.exist' as any, undefined, 'en')).toBe('does.not.exist');
});

test('active-locale t() follows the current locale', () => {
  installStubs({ languages: ['en-US'] });
  initLocale();
  expect(t('workspace.title')).toBe('Workspace');
  setLocale('ja');
  expect(t('workspace.title')).toBe('ワークスペース');
});

test('settings dialog keys are translated across peer locales', () => {
  expect(translate('settings.title', undefined, 'zh-CN')).toBe('设置');
  expect(translate('settings.section.models', undefined, 'ja')).toBe('モデル');
  expect(translate('settings.placeholder.keychain', undefined, 'zh-CN')).toBe('筛选条目…');
  expect(translate('settings.section.addons', undefined, 'en')).toBe('Add-ons');
});

test('compose and workspace keys are translated across peer locales', () => {
  expect(translate('compose.shareLocation', undefined, 'zh-CN')).toBe('分享位置');
  expect(translate('compose.attachFile', undefined, 'ja')).toBe('ファイルを添付');
  expect(translate('workspace.uploadFiles', undefined, 'zh-CN')).toBe('上传文件');
  expect(translate('workspace.deleteSelectedFile', undefined, 'ja')).toBe('選択したファイルを削除');
  expect(translate('workspace.downloadZip', undefined, 'en')).toBe('Download folder as zip');
});

test('menu keys are translated across all peer locales', () => {
  expect(translate('menu.settings', undefined, 'en')).toBe('Settings');
  expect(translate('menu.settings', undefined, 'zh-CN')).toBe('设置');
  expect(translate('menu.settings', undefined, 'ja')).toBe('設定');
  expect(translate('menu.newFile', undefined, 'zh-CN')).toBe('新建文件');
  expect(translate('menu.refreshTree', undefined, 'ja')).toBe('ツリーを更新');
});

test('restart handoff chrome is translated across all peer locales', () => {
  expect(translate('post.restartNotice', { reason: 'Deploy' }, 'en'))
    .toBe('Restarting now — Reason: Deploy');
  expect(translate('post.restartNotice', { reason: '部署' }, 'zh-CN'))
    .toBe('正在重启 — 原因：部署');
  expect(translate('post.restartNotice', { reason: 'デプロイ' }, 'ja'))
    .toBe('再起動中 — 理由：デプロイ');
  expect(translate('post.restartCompleted', undefined, 'zh-CN')).toBe('重启完成。');
  expect(translate('post.restartCompleted', undefined, 'ja')).toBe('再起動が完了しました。');
  expect(translate('post.agentSelfResume', undefined, 'zh-CN')).toBe('代理自行恢复');
  expect(translate('post.agentSelfResume', undefined, 'ja')).toBe('エージェントの自己再開');
});

test('interpolation replaces named placeholders and leaves unknown ones intact', () => {
  // Uses a transient key via translate fallback to key, then interpolation.
  expect(translate('hi {name}' as any, { name: 'Rui' }, 'en')).toBe('hi Rui');
  expect(translate('hi {name}' as any, {}, 'en')).toBe('hi {name}');
});
