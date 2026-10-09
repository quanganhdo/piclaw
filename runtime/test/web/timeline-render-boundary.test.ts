import { expect, test } from 'bun:test';
import {
  estimateTimelinePostHeight,
  findTimelineIndexAtOffset,
  getLatestTimelineWindow,
  getTimelineWindowAroundIndex,
  getTimelineViewportWindow,
  haveSameTimelineProps,
} from '../../web/src/components/timeline.js';

test('timeline render boundary ignores parent updates when timeline props retain identity', () => {
  const posts = [{ id: 1 }];
  const onLoadMore = () => {};
  const current = { posts, hasMore: true, onLoadMore, searchQuery: null };
  const next = { posts, hasMore: true, onLoadMore, searchQuery: null };

  expect(haveSameTimelineProps(current, next)).toBe(true);
});

test('timeline render boundary updates for changed timeline data or callbacks', () => {
  const posts = [{ id: 1 }];
  const onLoadMore = () => {};
  const current = { posts, hasMore: true, onLoadMore };

  expect(haveSameTimelineProps(current, { ...current, posts: [...posts] })).toBe(false);
  expect(haveSameTimelineProps(current, { ...current, hasMore: false })).toBe(false);
  expect(haveSameTimelineProps(current, { ...current, onLoadMore: () => {} })).toBe(false);
  expect(haveSameTimelineProps(current, { ...current, searchQuery: null })).toBe(false);
});

test('timeline window stays bounded at the newest posts', () => {
  expect(getLatestTimelineWindow(1000)).toEqual({ start: 984, end: 1000 });
  expect(getLatestTimelineWindow(20)).toEqual({ start: 4, end: 20 });
});

test('timeline reveal window centers historical posts without exceeding bounds', () => {
  expect(getTimelineWindowAroundIndex(500, 1000)).toEqual({ start: 492, end: 508 });
  expect(getTimelineWindowAroundIndex(2, 1000)).toEqual({ start: 0, end: 16 });
  expect(getTimelineWindowAroundIndex(999, 1000)).toEqual({ start: 984, end: 1000 });
});

test('timeline offset lookup resolves scroll jumps into omitted history', () => {
  expect(findTimelineIndexAtOffset([0, 100, 250, 400], 0)).toBe(0);
  expect(findTimelineIndexAtOffset([0, 100, 250, 400], 249)).toBe(1);
  expect(findTimelineIndexAtOffset([0, 100, 250, 400], 400)).toBe(2);
});

test('timeline height estimate is bounded and accounts for rich content', () => {
  expect(estimateTimelinePostHeight({ data: { content: '' } })).toBe(76);
  expect(estimateTimelinePostHeight({ data: { content: 'x'.repeat(100), media_ids: [1] } })).toBe(318);
  expect(estimateTimelinePostHeight({ data: { content: 'x'.repeat(10000) } })).toBe(1200);
});
test('viewport windows cover tall viewports with short messages and retain a row buffer', () => {
  const prefix=Array.from({length:201},(_,n)=>n*72);
  const latest=getTimelineViewportWindow(prefix,0,1800,true);expect(latest.end).toBe(200);expect(latest.end-latest.start).toBeGreaterThan(25);
  const middle=getTimelineViewportWindow(prefix,5000,1000);expect(prefix[middle.start]).toBeLessThanOrEqual(5000);expect(prefix[middle.end]).toBeGreaterThanOrEqual(6000);
});
