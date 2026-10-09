import { expect, test } from "bun:test";
import { GpuMetricsCache, type GpuMetricsWorker } from "../../../../src/channels/web/agent/gpu-metrics-cache.js";
const sample = { totalBytes: 1000, usedBytes: 100, percent: 10, provider: "nvml" };
class FakeWorker implements GpuMetricsWorker {
  onmessage: ((event: MessageEvent) => void) | null = null;
  onerror: ((event: ErrorEvent) => void) | null = null;
  messages: any[] = [];
  postMessage(m: unknown) { this.messages.push(m); }
  reply(snapshot: unknown, id = this.messages.at(-1).id) { this.onmessage?.({ data: { id, snapshot } } as MessageEvent); }
}
function setup() {
  let now = 0, creations = 0;
  const worker = new FakeWorker();
  const cache = new GpuMetricsCache(() => { creations++; return worker; }, () => now);
  return { cache, worker, tick: (ms: number) => { now += ms; }, creations: () => creations };
}
test("many HUD clients share one worker and at most one request per interval", () => {
  const h = setup();
  for (let i = 0; i < 100; i++) expect(h.cache.read()).toBeNull();
  expect(h.creations()).toBe(1); expect(h.worker.messages).toHaveLength(1);
  h.worker.reply(sample); expect(h.cache.read()).toEqual(sample);
  const copy = h.cache.read()!; copy.usedBytes = 999;
  expect(h.cache.read()).toEqual(sample);
  h.tick(2000); h.cache.read(); expect(h.worker.messages).toHaveLength(2);
});
test("device absence, permission/library errors and invalid messages back off and recover", () => {
  for (const value of [null, {}, { ...sample, usedBytes: NaN }, { ...sample, percent: 99 }, { ...sample, provider: 'bad' }]) {
    const h = setup(); h.cache.read(); h.worker.reply(value);
    expect(h.cache.read()).toBeNull(); h.tick(59999); h.cache.read(); expect(h.worker.messages).toHaveLength(1);
    h.tick(1); h.cache.read(); h.worker.reply(sample); expect(h.cache.read()).toEqual(sample);
  }
});
test("stale and late native results never show a false zero or create replacement workers", () => {
  const h = setup(); h.cache.read(); h.worker.reply(sample); h.tick(2000); h.cache.read();
  h.tick(5000); expect(h.cache.read()).toBeNull();
  h.tick(600000); h.cache.read(); expect(h.creations()).toBe(1); expect(h.worker.messages).toHaveLength(2);
  h.worker.reply(sample); expect(h.cache.read()).toBeNull();
  h.tick(60000); h.cache.read(); h.worker.reply(sample); expect(h.cache.read()).toEqual(sample);
});
test("worker errors open circuit; disposal prevents callbacks restarting state", () => {
  const h = setup(); h.cache.read(); const oldCallback = h.worker.onmessage;
  h.worker.onerror?.({ preventDefault() {} } as ErrorEvent);
  oldCallback?.({ data: { id: 1, snapshot: sample } } as MessageEvent);
  h.tick(600000); expect(h.cache.read()).toBeNull(); expect(h.creations()).toBe(1);
  expect(h.worker.messages.at(-1)).toEqual({ type: 'close' });
});
test("worker construction failure retries with backoff; wrong request IDs are ignored", () => {
  let now = 0, count = 0;
  const cache = new GpuMetricsCache(() => { count++; throw Error('worker unavailable'); }, () => now);
  expect(cache.read()).toBeNull(); expect(cache.read()).toBeNull(); expect(count).toBe(1);
  now = 60000; cache.read(); expect(count).toBe(2);
  const h = setup(); h.cache.read(); h.worker.reply(sample, 999); expect(h.cache.read()).toBeNull();
  h.worker.reply(sample, 1); expect(h.cache.read()).toEqual(sample);
});
