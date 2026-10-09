import { expect, test } from "bun:test";
import { NvmlPoller } from "../../../../src/channels/web/agent/nvml-poller.js";
const sample = { totalBytes: 100, usedBytes: 30, percent: 30, provider: 'nvml' as const };
test('missing library, failed init, absent card, and lost device retry without spinning', async () => {
  for (const mode of ['load', 'empty', 'lost']) {
    let now = 0, attempts = 0, closes = 0, recovered = false;
    const p = new NvmlPoller(async () => {
      attempts++;
      if (mode === 'load' && !recovered) throw Error('load/init failed');
      return { read() { if (recovered) return sample; if (mode === 'lost') throw Error('GPU lost'); return null; }, close() { closes++; } };
    }, () => now);
    expect(await p.sample()).toBeNull();
    for (let i = 0; i < 5; i++) expect(await p.sample()).toBeNull();
    expect(attempts).toBe(1); expect(closes).toBe(mode === 'load' ? 0 : 1);
    recovered = true; now = 60000; expect(await p.sample()).toEqual(sample); expect(attempts).toBe(2);
    expect(await p.sample()).toEqual(sample); expect(attempts).toBe(2);
    p.close(); p.close(); expect(await p.sample()).toBeNull();
  }
});
test('disposal during asynchronous module loading closes the eventual reader', async () => {
  let resolve!: (v: any) => void, closed = 0;
  const p = new NvmlPoller(() => new Promise(r => { resolve = r; }));
  const result = p.sample(); p.close(); resolve({ read: () => sample, close: () => { closed++; } });
  expect(await result).toBeNull(); expect(closed).toBe(1);
});
