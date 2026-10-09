import { afterEach, expect, test } from 'bun:test';
import {
  METERS_COLLAPSED_EVENT_NAME,
  METERS_COLLAPSED_STORAGE_KEY,
  METERS_EVENT_NAME,
  METERS_STORAGE_KEY,
  applyMetersCollapsed,
  applyMetersEnabled,
  readStoredMetersCollapsed,
  readStoredMetersEnabled,
  toggleMetersCollapsed,
} from '../../web/src/ui/meters.ts';
import { SYSTEM_METERS_COMPACT_BREAKPOINT_PX, buildCompactMetersSummary, buildSparklinePath, formatBytesCompact, resolveCurrentRssBytes, resolveGpuMeterSnapshots, GpuSnapshotTracker, shouldShowRss, shouldShowVram } from '../../web/src/components/system-meters-hud.ts';

test('legacy NVIDIA aggregate memory remains discoverable through transient reader failure', () => {
    const tracker = new GpuSnapshotTracker();
    const good = { gpus: [], gpu_provider: 'nvml', vram_percent: 0, vram_total_bytes: 4096, vram_used_bytes: 0, vram_series: [0] };
    expect(tracker.resolve({gpus:[]})).toEqual([]);
    expect(tracker.resolve(good)).toHaveLength(1);
    const [missing] = tracker.resolve({gpus:[],gpu_provider:null,vram_percent:null,vram_total_bytes:0});
    expect(missing.provider).toBe('nvml');expect(missing.status).toBe('unavailable');expect(missing.memory.used_bytes).toBeUndefined();
    const devices=[{id:'nv0',provider:'nvml',disabled:true}];expect(tracker.resolve({gpus:devices})).toEqual(devices);
    expect(tracker.resolve({gpus:[]})).toEqual([]);
});

const originalWindow = globalThis.window;

function makeWindow(initial = {}) {
  const store = new Map(Object.entries(initial));
  const events: Array<{ type: string; detail: any }> = [];
  return {
    localStorage: {
      getItem: (key: string) => (store.has(key) ? String(store.get(key)) : null),
      setItem: (key: string, value: string) => {
        store.set(key, value);
      },
    },
    dispatchEvent: (event: Event & { detail?: any }) => {
      events.push({ type: event.type, detail: (event as any).detail });
      return true;
    },
    __events: events,
  } as any;
}

afterEach(() => {
  globalThis.window = originalWindow;
});

test('applyMetersEnabled persists state and dispatches a meters-change event', () => {
  const win = makeWindow();
  globalThis.window = win;

  const next = applyMetersEnabled(true);

  expect(next).toBe(true);
  expect(win.localStorage.getItem(METERS_STORAGE_KEY)).toBe('true');
  expect(readStoredMetersEnabled(false)).toBe(true);
  expect(win.__events).toEqual([
    { type: METERS_EVENT_NAME, detail: { enabled: true } },
  ]);
});

test('applyMetersCollapsed persists state and dispatches a collapsed-change event', () => {
  const win = makeWindow();
  globalThis.window = win;

  const next = applyMetersCollapsed(true);

  expect(next).toBe(true);
  expect(win.localStorage.getItem(METERS_COLLAPSED_STORAGE_KEY)).toBe('true');
  expect(win.__events).toEqual([
    { type: METERS_COLLAPSED_EVENT_NAME, detail: { collapsed: true } },
  ]);
});

test('system meters compact breakpoint is 600px', () => {
  expect(SYSTEM_METERS_COMPACT_BREAKPOINT_PX).toBe(600);
});

test('buildCompactMetersSummary uses fat bullet separators and includes Linux buffer/cache when present', () => {
  expect(buildCompactMetersSummary({
    cpu_percent: 18,
    ram_percent: 62,
    buffer_cache_bytes: 512 * 1024 * 1024,
    swap_percent: 7,
    swap_total_bytes: 1024,
  })).toBe('CPU 18% • RAM 62% • BUF 512M • SWP 7%');
  expect(buildCompactMetersSummary({
    cpu_percent: 18,
    ram_percent: 62,
    buffer_cache_bytes: null,
    vram_percent: 33,
    vram_total_bytes: 8 * 1024 * 1024 * 1024,
    vram_used_bytes: 3 * 1024 * 1024 * 1024,
    vram_series: [25, 33],
    swap_percent: null,
    swap_total_bytes: 0,
  })).toBe('CPU 18% • RAM 62% • VRAM 33%');
  expect(buildCompactMetersSummary({ cpu_percent: 18, ram_percent: 62, buffer_cache_bytes: null, swap_percent: null, swap_total_bytes: 0 })).toBe('CPU 18% • RAM 62%');
});

test('buildSparklinePath supports dynamically scaled byte series and flat lines', () => {
  expect(buildSparklinePath([100, 200], 56, 16)).toBe('M 0.00 16.00 L 56.00 0.00');
  expect(buildSparklinePath([512, 512], 56, 16)).toBe('M 0 8.00 L 56 8.00');
});

test('formatBytesCompact keeps RSS labels short enough for the HUD', () => {
  expect(formatBytesCompact(0)).toBe('0B');
  expect(formatBytesCompact(512 * 1024 * 1024)).toBe('512M');
  expect(formatBytesCompact(1536 * 1024 * 1024)).toBe('1.5G');
});

test('resolveCurrentRssBytes prefers Linux VmRSS but still exposes cross-platform RSS', () => {
  expect(resolveCurrentRssBytes({ process_memory: { vm_rss_bytes: 256, rss_bytes: 128 } })).toBe(256);
  expect(resolveCurrentRssBytes({ process_memory: { vm_rss_bytes: null, rss_bytes: 128 } })).toBe(128);
  expect(resolveCurrentRssBytes({ process_memory: { vm_rss_bytes: 0, rss_bytes: 128 } })).toBe(128);
});

test('shouldShowRss allows Windows and macOS resident-memory meters when RSS data exists', () => {
  expect(shouldShowRss({
    platform: 'win32',
    process_memory: { vm_rss_bytes: null, rss_bytes: 200 },
    process_rss_series_bytes: [100, 200],
  })).toBe(true);
  expect(shouldShowRss({
    platform: 'darwin',
    process_memory: { vm_rss_bytes: null, rss_bytes: 300 },
    process_rss_series_bytes: [150, 300],
  })).toBe(true);
  expect(shouldShowRss({
    platform: 'linux',
    process_memory: { vm_rss_bytes: 0, rss_bytes: 0 },
    process_rss_series_bytes: [0, 0],
  })).toBe(false);
  expect(shouldShowRss({
    platform: 'win32',
    process_memory: { vm_rss_bytes: null, rss_bytes: 300 },
    process_rss_series_bytes: [],
  })).toBe(false);
});

test('shouldShowVram requires valid optional GPU memory telemetry', () => {
  expect(shouldShowVram({
    vram_percent: 50,
    vram_total_bytes: 8 * 1024 * 1024 * 1024,
    vram_used_bytes: 4 * 1024 * 1024 * 1024,
    vram_series: [25, 50],
    gpu_provider: 'nvidia-smi',
  })).toBe(true);
  expect(shouldShowVram({
    vram_percent: null,
    vram_total_bytes: 8 * 1024 * 1024 * 1024,
    vram_used_bytes: 4 * 1024 * 1024 * 1024,
    vram_series: [25, 50],
  })).toBe(false);
  expect(shouldShowVram({
    vram_percent: 50,
    vram_total_bytes: 0,
    vram_used_bytes: 0,
    vram_series: [50],
  })).toBe(false);
  expect(shouldShowVram({
    vram_percent: 50,
    vram_total_bytes: 8 * 1024 * 1024 * 1024,
    vram_used_bytes: 4 * 1024 * 1024 * 1024,
    vram_series: [],
  })).toBe(false);
});
test('aggregate non-Intel telemetry supplies a generic GPU memory popup only when enabled and available',()=>{
 const value={gpu_provider:'nvml',gpus:[],vram_percent:50,vram_total_bytes:4096,vram_used_bytes:2048,vram_series:[25,50]};expect(resolveGpuMeterSnapshots(value)).toMatchObject([{name:'GPU',provider:'nvml',memory:{used_bytes:2048,total_bytes:4096}}]);expect(resolveGpuMeterSnapshots({...value,vram_percent:null})).toEqual([]);expect(resolveGpuMeterSnapshots({...value,gpus:[{id:'nvidia0',provider:'nvml'}]})).toHaveLength(1);
});
test('invalid or missing aggregate memory counters do not fabricate enabled GPU rows',()=>{
 const value={gpu_provider:'nvml',gpus:[],vram_percent:50,vram_total_bytes:4096,vram_used_bytes:2048,vram_series:[50]};
 for(const patch of [{vram_used_bytes:null},{vram_used_bytes:undefined},{vram_percent:101},{vram_total_bytes:Infinity},{vram_used_bytes:8192}])expect(resolveGpuMeterSnapshots({...value,...patch})).toEqual([]);
});
test('compact system summary omits disabled optional lines without turning null into idle zero',()=>{
 expect(buildCompactMetersSummary({cpu_percent:null,ram_percent:0,swap_percent:null,swap_total_bytes:4096,vram_percent:null,vram_total_bytes:4096,vram_used_bytes:0,vram_series:[0]})).toBe('RAM 0%');
});

test('toggleMetersCollapsed flips the stored collapsed state', () => {
  const win = makeWindow({ [METERS_COLLAPSED_STORAGE_KEY]: 'true' });
  globalThis.window = win;

  expect(readStoredMetersCollapsed(false)).toBe(true);
  expect(toggleMetersCollapsed()).toBe(false);
  expect(readStoredMetersCollapsed(false)).toBe(false);
});

test('applyMetersFromEvent applies server-persisted enabled and collapsed state', async () => {
  const win = makeWindow();
  globalThis.window = win;
  const { applyMetersFromEvent } = await import('../../web/src/ui/meters.ts');

  applyMetersFromEvent({ enabled: true, collapsed: true });

  expect(readStoredMetersEnabled(false)).toBe(true);
  expect(readStoredMetersCollapsed(false)).toBe(true);
});
