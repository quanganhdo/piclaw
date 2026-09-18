import { expect, test } from 'bun:test';

import {
  applyDraftDeltaBuffer,
  applyThoughtDeltaBuffer,
  buildCollapsedAgentPreviewState,
  buildExpandedAgentPreviewState,
  inferAgentPreviewTotalLines,
  resolveAgentPlanText,
} from '../../web/src/ui/app-agent-previews.js';

test('inferAgentPreviewTotalLines prefers explicit totals and falls back to newline counting', () => {
  expect(inferAgentPreviewTotalLines('one\ntwo', 5)).toBe(5);
  expect(inferAgentPreviewTotalLines('one\ntwo', null)).toBe(2);
  expect(inferAgentPreviewTotalLines('', null)).toBe(0);
});

test('buildCollapsedAgentPreviewState preserves text and inferred totals', () => {
  expect(buildCollapsedAgentPreviewState('one\ntwo', null)).toEqual({
    text: 'one\ntwo',
    totalLines: 2,
  });
});

test('buildExpandedAgentPreviewState keeps collapsed preview text while exposing full text', () => {
  expect(buildExpandedAgentPreviewState('alpha\nbeta', { text: 'alpha', totalLines: 1 })).toEqual({
    text: 'alpha',
    totalLines: 2,
    fullText: 'alpha\nbeta',
  });
});

test('resolveAgentPlanText handles replace and append modes', () => {
  expect(resolveAgentPlanText('old', 'new', 'replace')).toBe('new');
  expect(resolveAgentPlanText('old', 'new', 'append')).toBe('oldnew');
  expect(resolveAgentPlanText('', 'new', undefined)).toBe('new');
});

test('draft and thought delta helpers preserve existing buffer semantics', () => {
  expect(applyDraftDeltaBuffer('base', { delta: ' plus' })).toBe('base plus');
  expect(applyDraftDeltaBuffer('base', { reset: true, delta: 'fresh' })).toBe('fresh');
  expect(applyDraftDeltaBuffer('base', { delta: 5 })).toBe('base5');

  expect(applyThoughtDeltaBuffer('base', { delta: ' plus' })).toBe('base plus');
  expect(applyThoughtDeltaBuffer('base', { reset: true, delta: 'fresh' })).toBe('fresh');
  expect(applyThoughtDeltaBuffer('base', { delta: 5 })).toBe('base');
  expect(applyThoughtDeltaBuffer('prefix', { delta: ' suffix', text: 'prefix suffix' })).toBe('prefix suffix');
  expect(applyThoughtDeltaBuffer('prefixprefix extended', { delta: ' ignored', text: 'prefix extended' })).toBe('prefix extended');
  expect(applyThoughtDeltaBuffer('stale', { reset: true, delta: 'fresh', text: 'fresh' })).toBe('fresh');
});
