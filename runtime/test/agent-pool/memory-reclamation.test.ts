import { expect, test } from 'bun:test';
import { MemoryReclamationGate } from '../../src/agent-pool/memory-reclamation.js';
const tick = (gate: MemoryReclamationGate, changes = {}) => gate.shouldReclaim({ pressure: true, evicted: false, busy: false, now: 0, intervalMs: 30000, ...changes });
test('reclaims once per continuous pressure episode rather than every tick', () => {
  const gate = new MemoryReclamationGate();
  expect(tick(gate)).toBe(true);
  for (const now of [30000, 60000, 90000]) expect(tick(gate, { now })).toBe(false);
  expect(tick(gate, { pressure: false, now: 120000 })).toBe(false);
  expect(tick(gate, { now: 150000 })).toBe(true);
});
test('defers pressure or eviction reclamation while work is active and flushes when idle', () => {
  const gate = new MemoryReclamationGate();
  expect(tick(gate, { busy: true })).toBe(false);
  expect(tick(gate, { busy: true, now: 30000, evicted: true })).toBe(false);
  expect(tick(gate, { pressure: false, now: 60000 })).toBe(true);
  expect(tick(gate, { pressure: false, now: 90000 })).toBe(false);
});
test('coalesces successive evictions and pressure chatter within existing cleanup interval', () => {
  const gate = new MemoryReclamationGate();
  expect(tick(gate, { pressure: false, evicted: true })).toBe(true);
  expect(tick(gate, { pressure: false, evicted: true, now: 1 })).toBe(false);
  expect(tick(gate, { now: 2 })).toBe(false);
  expect(tick(gate, { pressure: false, now: 29999 })).toBe(false);
  expect(tick(gate, { pressure: false, now: 30000 })).toBe(true);
});
test('normal idle cleanup never forces collection without pressure or eviction', () => {
  const gate = new MemoryReclamationGate();
  for (const now of [0, 30000, 60000]) expect(tick(gate, { pressure: false, now })).toBe(false);
});
