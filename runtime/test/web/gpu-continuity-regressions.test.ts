import { expect, test } from 'bun:test';
import { GpuMeterHistory, getGpuMeterRows } from '../../web/src/components/intel-gpu-meters.js';
import { GpuSnapshotTracker } from '../../web/src/components/system-meters-hud.js';
const gpu = (patch: any = {}) => ({ id: 'device', name: 'Fixture GPU', provider: 'intel-drm-fdinfo', sample_time_ms: 1000, status: 'ok', busy_percent: 20, memory: { resident_bytes: 100 }, history: [{ timestamp_ms: 1000, busy_percent: 20, resident_bytes: 100 }], ...patch });
test('new objects containing the same sample cannot append duplicate null gaps', () => {
  const history = new GpuMeterHistory(); history.update([gpu()], { nowMs: 1001 });
  const missing = gpu({ sample_time_ms: 2000, status: 'unavailable', busy_percent: null, memory: { resident_bytes: null }, history: [] });
  const [first] = history.update([missing], { nowMs: 2001 });
  for (let i = 0; i < 35; i++) {
    const [same] = history.update([structuredClone(missing)], { nowMs: 2001 });
    expect(same.rows.busySparkPath).toBe(first.rows.busySparkPath);
  }
  expect(first.rows.busySparkPath).not.toBe('');
});
test('recovery without backend history preserves the null gap and earlier samples', () => {
  const history = new GpuMeterHistory(); history.update([gpu()], { nowMs: 1001 });
  history.update([gpu({ sample_time_ms: 2000, status: 'unavailable', busy_percent: null, memory: { resident_bytes: null }, history: [] })], { nowMs: 2001 });
  const [recovery] = history.update([gpu({ sample_time_ms: 3000, busy_percent: 50, memory: { resident_bytes: 200 }, history: [] })], { nowMs: 3001 });
  expect((recovery.rows.busySparkPath.match(/M /g) ?? []).length).toBe(2);
});
test('a replacement provider clears legacy aggregate identity instead of retaining two devices', () => {
  const tracker = new GpuSnapshotTracker();
  tracker.resolve({ gpus: [], gpu_provider: 'nvml', vram_percent: 50, vram_total_bytes: 1000, vram_used_bytes: 500, vram_series: [50] });
  const replacement = [gpu({ provider: 'intel-drm-fdinfo' })];
  expect(tracker.resolve({ gpus: replacement, gpu_provider: null })).toEqual(replacement);
  expect(tracker.resolve({ gpus: [], gpu_provider: null })).toEqual([]);
});
test('initial timestamped history is sorted and deduplicated for both metrics', () => {
  const h = new GpuMeterHistory();
  const [meter] = h.update([gpu({ sample_time_ms: 3000, busy_percent: 80, memory: { resident_bytes: 300 }, history: [{ timestamp_ms: 3000, busy_percent: 80, resident_bytes: 300 }, { timestamp_ms: 1000, busy_percent: 20, resident_bytes: 100 }, { timestamp_ms: 2000, busy_percent: null, resident_bytes: null }, { timestamp_ms: 3000, busy_percent: 80, resident_bytes: 300 }] })], { nowMs: 3001 });
  expect(meter.rows.busySparkPath).toStartWith('M 0.00 12.20');
  expect((meter.rows.busySparkPath.match(/M /g) ?? []).length).toBe(2);
  expect(meter.rows.busySparkPath).toContain('M 56.00 3.80');
  expect(meter.rows.residentSparkPath).toStartWith('M 0.00 15.00');
});
test('backend samples collected between polls preserve timestamped null gaps for both metrics', () => {
  const history = new GpuMeterHistory(); history.update([gpu()], { nowMs: 1001 });
  const next = gpu({ sample_time_ms: 3000, busy_percent: 50, memory: { resident_bytes: 200 }, history: [{ timestamp_ms: 1000, busy_percent: 20, resident_bytes: 100 }, { timestamp_ms: 2000, busy_percent: null, resident_bytes: null }, { timestamp_ms: 3000, busy_percent: 50, resident_bytes: 200 }] });
  const [meter] = history.update([next], { nowMs: 3001 });
  expect((meter.rows.busySparkPath.match(/M /g) ?? []).length).toBe(2);
  expect((meter.rows.residentSparkPath.match(/M /g) ?? []).length).toBe(2);
  for (let i = 0; i < 3; i++) expect(history.update([structuredClone(next)], { nowMs: 3001 })[0].rows.busySparkPath).toBe(meter.rows.busySparkPath);
});
test('stale transport appends one null per poll, not per render, then ages history out', () => {
  const history = new GpuMeterHistory(), sample = gpu();
  history.update([sample], { nowMs: 1001, pollId: 1 });
  const [first] = history.update([sample], { nowMs: 9000, pollId: 2 });
  for (let i = 0; i < 35; i++) expect(history.update([sample], { nowMs: 9000 + i, pollId: 2 })[0].rows.busySparkPath).toBe(first.rows.busySparkPath);
  let last;
  for (let pollId = 3; pollId < 35; pollId++) [last] = history.update([sample], { nowMs: 9000 + pollId * 2000, pollId });
  expect(last.rows.busySparkPath).toBe('');
  expect(getGpuMeterRows(last).map(row => row.value)).toEqual(['—', '—']);
});
test('explicit disabled device cannot be replaced by stale aggregate data', () => {
  const tracker = new GpuSnapshotTracker();
  const explicit = [gpu({ provider: 'nvml', disabled: true })];
  expect(tracker.resolve({ gpus: explicit, gpu_provider: 'nvml', vram_percent: 50, vram_total_bytes: 1000, vram_used_bytes: 500, vram_series: [50] })).toEqual(explicit);
  expect(tracker.resolve({ gpus: [], gpu_provider: null })).toEqual([]);
});
test('device identity changes and clearing the mounted HUD revoke proven capability', () => {
  const history = new GpuMeterHistory(); history.update([gpu()], { nowMs: 1001 });
  const missing = gpu({ name: 'Replacement GPU', status: 'unavailable', busy_percent: null, memory: {}, history: [] });
  expect(getGpuMeterRows(history.update([missing], { nowMs: 1002 })[0])).toEqual([]);
  history.update([gpu()], { nowMs: 1001 }); history.clear();
  expect(getGpuMeterRows(history.update([gpu({ status: 'unavailable', busy_percent: null, memory: {}, history: [] })], { nowMs: 1002 })[0])).toEqual([]);
});
test('legacy nullable history retains gaps rather than turning null into zero', () => {
  const tracker = new GpuSnapshotTracker();
  const [meter] = tracker.resolve({ gpus: [], gpu_provider: 'nvml', vram_percent: 50, vram_total_bytes: 1000, vram_used_bytes: 500, vram_series: [25, null, 50] });
  expect(meter.history.map(row => row.resident_bytes)).toEqual([250, null, 500]);
});
test('established byte-unit history does not switch its value label when capacity later appears', () => {
  const history = new GpuMeterHistory();
  history.update([gpu({ provider: 'nvml', memory: { used_bytes: 1024 }, history: [] })], { nowMs: 1001 });
  const [withCapacity] = history.update([gpu({ provider: 'nvml', sample_time_ms: 2000, memory: { used_bytes: 2048, total_bytes: 4096 }, history: [] })], { nowMs: 2001 });
  expect(withCapacity.rows.residentText).toBe('2.0K');
  expect(withCapacity.rows.residentSparkPath).not.toContain('NaN');
});
test('unknown NVIDIA readings retain established percentage history and never switch to bytes', () => {
  const history = new GpuMeterHistory();
  history.update([gpu({ provider: 'nvml', memory: { used_bytes: 500, total_bytes: 1000 }, history: [{ timestamp_ms: 1000, busy_percent: 20, resident_bytes: 500 }] })], { nowMs: 1001 });
  const [missing] = history.update([gpu({ provider: 'nvml', sample_time_ms: 2000, status: 'unavailable', memory: {}, busy_percent: null, history: [] })], { nowMs: 2001 });
  expect(getGpuMeterRows(missing).map(row => row.value)).toEqual(['—', '—']);
  expect(missing.rows.residentSparkPath).toContain('8.00');
});
