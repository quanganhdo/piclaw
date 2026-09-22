import { afterEach, beforeEach, expect, test } from 'bun:test';
import { addRecentFile, getRecentFiles, openRecentFile, RECENT_FILES_KEY, removeRecentFile } from '../../web/src/ui/recent-files.js';

const originalStorage = Object.getOwnPropertyDescriptor(globalThis, 'localStorage');
const originalFetch = globalThis.fetch;
let storage: Map<string, string>;
beforeEach(() => {
  storage = new Map();
  Object.defineProperty(globalThis, 'localStorage', { configurable: true, value: {
    getItem: (key: string) => storage.get(key) ?? null,
    setItem: (key: string, value: string) => storage.set(key, value),
  } });
});
afterEach(() => {
  globalThis.fetch = originalFetch;
  if (originalStorage) Object.defineProperty(globalThis, 'localStorage', originalStorage);
  else Reflect.deleteProperty(globalThis, 'localStorage');
});

test('removing a recent path preserves other entries and existing exclusions', () => {
  for (const path of ['notes/a.md', 'notes/b.md', 'notes/a.md', 'piclaw://terminal/1', '__vnc-1']) addRecentFile(path);
  expect(getRecentFiles()).toEqual(['notes/a.md', 'notes/b.md']);
  removeRecentFile(' notes/a.md ');
  expect(getRecentFiles()).toEqual(['notes/b.md']);
  expect(JSON.parse(storage.get(RECENT_FILES_KEY)!)).toEqual(['notes/b.md']);
  removeRecentFile('missing.md'); expect(getRecentFiles()).toEqual(['notes/b.md']);
});

test('confirmed not-found removes only the selected path and never opens/re-adds it', async () => {
  addRecentFile('keep.md'); addRecentFile('gone #?.md');
  const opened: string[] = [];
  globalThis.fetch = (async (url: string, options: RequestInit) => {
    expect(url).toBe('/workspace/stat?path=gone%20%23%3F.md'); expect(options.cache).toBe('no-store');
    // A different open occurs while this check is in flight.
    addRecentFile('concurrent.md');
    return Response.json({ code: 'FILE_NOT_FOUND', error: 'File not found' }, { status: 404 });
  }) as typeof fetch;
  await openRecentFile('gone #?.md', path => { opened.push(path); addRecentFile(path); });
  expect(opened).toEqual([]); expect(getRecentFiles()).toEqual(['concurrent.md', 'keep.md']);
});

for (const status of [200, 400, 401, 403, 404, 429, 500, 503]) test(`status ${status} without confirmed absence retains the recent and existing open behavior`, async () => {
  addRecentFile('file.md');
  globalThis.fetch = (async () => Response.json({ error: 'opaque failure' }, { status })) as typeof fetch;
  const opened: string[] = [];
  await openRecentFile('file.md', path => { opened.push(path); });
  expect(opened).toEqual(['file.md']); expect(getRecentFiles()).toEqual(['file.md']);
});

test('offline and malformed not-found responses retain entries', async () => {
  addRecentFile('file.md'); let opens = 0;
  globalThis.fetch = (async () => { throw new TypeError('offline fixture'); }) as typeof fetch;
  await openRecentFile('file.md', () => { opens++; });
  globalThis.fetch = (async () => new Response('<html>not found</html>', { status: 404 })) as typeof fetch;
  await openRecentFile('file.md', () => { opens++; });
  expect(opens).toBe(2); expect(getRecentFiles()).toEqual(['file.md']);
});

test('unavailable storage and absent opener do not throw or start a check', async () => {
  Object.defineProperty(globalThis, 'localStorage', { configurable: true, value: { getItem: () => { throw Error('blocked'); }, setItem: () => { throw Error('blocked'); } } });
  globalThis.fetch = (async () => { throw Error('must not fetch'); }) as typeof fetch;
  removeRecentFile('file.md'); await openRecentFile('file.md');
  expect(getRecentFiles()).toEqual([]);
});
