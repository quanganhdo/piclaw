import { afterEach, describe, expect, test } from 'bun:test';

import {
  resolveWorkspaceLayoutBucket,
  shouldCollapseWorkspaceAfterLayoutChange,
} from '../../web/src/ui/workspace-visibility.js';

const originalWindow = (globalThis as any).window;

function createRuntime(options: {
  matchesDesktop?: boolean;
} = {}) {
  return {
    matchMedia: () => ({
      matches: Boolean(options.matchesDesktop),
    }),
  } as any;
}

afterEach(() => {
  (globalThis as any).window = originalWindow;
});

describe('workspace visibility preferences', () => {
  test('resolves layout buckets from the desktop landscape media query', () => {
    expect(resolveWorkspaceLayoutBucket(createRuntime({ matchesDesktop: true }))).toBe('desktop');
    expect(resolveWorkspaceLayoutBucket(createRuntime({ matchesDesktop: false }))).toBe('narrow');
    expect(resolveWorkspaceLayoutBucket(null)).toBe('desktop');
  });

  test('entering narrow layout collapses without auto-opening when widening', () => {
    expect(shouldCollapseWorkspaceAfterLayoutChange('desktop', 'narrow')).toBe(true);
    expect(shouldCollapseWorkspaceAfterLayoutChange('narrow', 'desktop')).toBe(false);
  });
});
