import { expect, test } from 'bun:test';

import { bindSseWakeLifecycle } from '../../web/src/ui/use-sse-connection.js';

function createEventTarget() {
  const listeners = new Map<string, Set<(...args: any[]) => void>>();
  return {
    addEventListener(type: string, listener: (...args: any[]) => void) {
      if (!listeners.has(type)) listeners.set(type, new Set());
      listeners.get(type)!.add(listener);
    },
    removeEventListener(type: string, listener: (...args: any[]) => void) {
      listeners.get(type)?.delete(listener);
    },
    dispatch(type: string, payload: Record<string, unknown> = {}) {
      for (const listener of listeners.get(type) || []) {
        listener({ type, ...payload });
      }
    },
    count(type: string) {
      return listeners.get(type)?.size || 0;
    },
  };
}

test('bindSseWakeLifecycle reconnects on focus but does not wake on visible-only churn when focus reconnect is enabled', () => {
  const win = createEventTarget() as any;
  const doc = createEventTarget() as any;
  doc.visibilityState = 'visible';

  let reconnects = 0;
  let wakes = 0;
  const dispose = bindSseWakeLifecycle({
    sse: {
      reconnectIfNeeded() {
        reconnects += 1;
      },
    },
    onWake() {
      wakes += 1;
    },
  }, {
    window: win,
    document: doc,
    useFocusReconnect: true,
  });

  win.dispatch('focus');
  win.dispatch('pageshow');
  doc.dispatch('visibilitychange');

  expect(reconnects).toBe(1);
  expect(wakes).toBe(0);

  dispose();
  expect(win.count('focus')).toBe(0);
  expect(win.count('pageshow')).toBe(0);
  expect(doc.count('visibilitychange')).toBe(0);
  expect(win.count('online')).toBe(0);
});

test('persisted pageshow and online recover without a recorded hidden event, coalescing wake signals', () => {
  const win = createEventTarget() as any, doc = createEventTarget() as any;
  doc.visibilityState = 'visible';
  let now = 1000, wakes = 0;
  const reconnects: unknown[] = [];
  const dispose = bindSseWakeLifecycle({ sse: {
    forceReconnect: options => reconnects.push(options), reconnectIfNeeded: () => false,
  }, onWake: () => { wakes++; } }, { window: win, document: doc, now: () => now });
  win.dispatch('pageshow', { persisted: true });
  win.dispatch('online');
  win.dispatch('focus');
  expect(reconnects).toEqual([{ immediate: true }]);
  expect(wakes).toBe(1);
  now += 600;
  win.dispatch('online');
  expect(reconnects).toHaveLength(2);
  expect(wakes).toBe(2);
  dispose();
  expect(win.count('online')).toBe(0);
});

test('focus performs stale-aware recovery even without a visibility event and refreshes only when reconnecting', () => {
  const win = createEventTarget() as any, doc = createEventTarget() as any;
  doc.visibilityState = 'visible';
  let stale = false, wakes = 0;
  const options: unknown[] = [];
  const dispose = bindSseWakeLifecycle({ sse: { reconnectIfNeeded: option => { options.push(option); return stale; } },
    onWake: () => { wakes++; } }, { window: win, document: doc });
  win.dispatch('focus');
  expect(wakes).toBe(0);
  stale = true;
  win.dispatch('focus');
  expect(wakes).toBe(1);
  expect(options).toEqual([{ immediate: true }, { immediate: true }]);
  dispose();
});

test('bindSseWakeLifecycle reconnects and wakes once after a real return without raw focus reconnect on iOS-style paths', () => {
  const win = createEventTarget() as any;
  const doc = createEventTarget() as any;
  doc.visibilityState = 'visible';

  let now = 1000;
  let reconnects = 0;
  let forcedReconnects = 0;
  let wakes = 0;
  const dispose = bindSseWakeLifecycle({
    sse: {
      reconnectIfNeeded() {
        reconnects += 1;
      },
      forceReconnect() {
        forcedReconnects += 1;
      },
    },
    onWake() {
      wakes += 1;
    },
  }, {
    window: win,
    document: doc,
    now: () => now,
    useFocusReconnect: false,
  });

  doc.visibilityState = 'hidden';
  doc.dispatch('visibilitychange');
  now += 175;
  doc.visibilityState = 'visible';
  win.dispatch('pageshow');
  doc.dispatch('visibilitychange');

  expect(reconnects).toBe(0);
  expect(forcedReconnects).toBe(1);
  expect(wakes).toBe(1);

  dispose();
});
