import { expect, test } from 'bun:test';
import { boundHostRequestCost } from '../../src/budget/request-cost-bound.js';
const model = () => ({ contextWindow: 100, maxTokens: 20, cost: { input: 2, output: 8, cacheRead: 1, cacheWrite: 3 } });

test('host ceiling includes all overlapping token categories and exact output ceiling', () => {
  expect(boundHostRequestCost(model(), 10)).toEqual({ amountMicros: 680, reason: 'catalogue_ceiling' });
  expect(boundHostRequestCost(model(), 20).amountMicros).toBe(760);
});
test('request-wide tiers use the largest rate per category, not optimistic threshold selection', () => {
  const cost = { ...model().cost, tiers: [
    { inputTokensAbove: 1000, input: 10, output: 1, cacheRead: 0, cacheWrite: 0 },
    { inputTokensAbove: 2000, input: 0, output: 20, cacheRead: 4, cacheWrite: 5 },
  ] };
  expect(boundHostRequestCost({ ...model(), cost }, 10).amountMicros).toBe(2100);
});
test('decimal category ceilings round upwards without binary floating point under-reservation', () => {
  expect(boundHostRequestCost({ contextWindow: 10, maxTokens: 10, cost: { input: 0.1, output: 0.2, cacheRead: 0.3, cacheWrite: 0 } }, 10).amountMicros).toBe(6);
  expect(boundHostRequestCost({ contextWindow: 3, maxTokens: 1, cost: { input: 0.1, output: 0, cacheRead: 0.1, cacheWrite: 0.1 } }, 1).amountMicros).toBe(3);
  expect(boundHostRequestCost({ contextWindow: 1, maxTokens: 1, cost: { input: 1e-9, output: 0, cacheRead: 0, cacheWrite: 0 } }, 1).amountMicros).toBe(1);
});
test('free requires independent host classification and cannot override positive pricing', () => {
  const free = { ...model(), cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 } };
  expect(boundHostRequestCost(free, 10)).toEqual({ amountMicros: null, reason: 'unknown_pricing' });
  expect(boundHostRequestCost(free, 10, true)).toEqual({ amountMicros: 0, reason: 'documented_free' });
  expect(boundHostRequestCost(model(), 10, true).amountMicros).toBeNull();
});
test('invalid ceilings and incomplete pricing produce no trusted bound', () => {
  for (const output of [0, -1, 1.5, NaN, Infinity, 21, Number.MAX_SAFE_INTEGER + 1]) expect(boundHostRequestCost(model(), output).reason).toBe('invalid_limits');
  expect(boundHostRequestCost({ ...model(), contextWindow: 0 }, 1).reason).toBe('invalid_limits');
  expect(boundHostRequestCost({ ...model(), maxTokens: NaN }, 1).reason).toBe('invalid_limits');
  for (const value of [NaN, Infinity, -1, undefined]) expect(boundHostRequestCost({ ...model(), cost: { ...model().cost, cacheWrite: value as number } }, 1).amountMicros).toBeNull();
});
test('invalid tier metadata and safe integer overflow fail closed', () => {
  const tier = { inputTokensAbove: 100, ...model().cost };
  for (const inputTokensAbove of [-1, NaN, 0.5]) expect(boundHostRequestCost({ ...model(), cost: { ...model().cost, tiers: [{ ...tier, inputTokensAbove }] } }, 10).amountMicros).toBeNull();
  expect(boundHostRequestCost({ ...model(), cost: { ...model().cost, tiers: [tier, tier] } }, 10).amountMicros).toBeNull();
  expect(boundHostRequestCost({ ...model(), cost: { ...model().cost, input: Number.MAX_VALUE } }, 10).amountMicros).toBeNull();
});
test('larger output allowance cannot reduce a fixed trusted bound', () => {
  let previous = 0;
  for (let output = 1; output <= 20; output++) { const bound = boundHostRequestCost(model(), output).amountMicros!; expect(bound).toBeGreaterThanOrEqual(previous); previous = bound; }
});
