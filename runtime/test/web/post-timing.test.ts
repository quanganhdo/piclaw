import { expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import {
  buildPostTimeTooltip,
  extractAgentTimingBlock,
  formatAgentReplyDuration,
  formatAgentTokenStats,
} from '../../web/src/components/post.ts';

const repoRoot = resolve(import.meta.dir, '../../..');

test('formatAgentReplyDuration keeps reply timings compact', () => {
  expect(formatAgentReplyDuration(420)).toBe('420ms');
  expect(formatAgentReplyDuration(1420)).toBe('1.4s');
  expect(formatAgentReplyDuration(38_420)).toBe('38s');
  expect(formatAgentReplyDuration(62_400)).toBe('1m 02s');
  expect(formatAgentReplyDuration(3_720_000)).toBe('1h 02m');
  expect(formatAgentReplyDuration(null)).toBe(null);
});

test('formatAgentTokenStats keeps each token category on a bounded line', () => {
  expect(formatAgentTokenStats({
    input_tokens: 1000,
    output_tokens: 234,
    reasoning_tokens: 40,
    cache_read_tokens: 50,
    cache_write_tokens: 25,
    total_tokens: 1309,
  })).toBe([
    'Tokens: 1,309 total',
    'Input: 1,000',
    'Output: 234',
    'Reasoning: 40',
    'Cache read: 50',
    'Cache write: 25',
  ].join('\n'));
  expect(formatAgentTokenStats(null)).toBe(null);
});

test('buildPostTimeTooltip includes persisted agent timing and token stats when present', () => {
  const post = {
    timestamp: '2026-06-21T11:16:02.000Z',
    data: {
      content_blocks: [
        {
          type: 'agent_timing',
          started_at: '2026-06-21T11:15:23.580Z',
          completed_at: '2026-06-21T11:16:02.000Z',
          duration_ms: 38_420,
          usage: {
            input_tokens: 1000,
            output_tokens: 234,
            cache_read_tokens: 50,
            cache_write_tokens: 25,
            total_tokens: 1309,
            provider_cost_total: 0.00123,
            cost_total: 0.00123,
            cost_provenance: 'provider_reported',
          },
        },
      ],
    },
  };

  expect(extractAgentTimingBlock(post.data.content_blocks)?.duration_ms).toBe(38_420);
  const tooltip = buildPostTimeTooltip(post);
  expect(tooltip).toContain('Sent');
  expect(tooltip).toContain('Agent reply took 38s');
  expect(tooltip).toContain('Tokens: 1,309 total\nInput: 1,000\nOutput: 234\nCache read: 50\nCache write: 25');
  expect(tooltip).toContain('Provider-reported cost: $0.0012');
  expect(tooltip).toContain('Started');
  expect(tooltip.split('\n').every((line) => line.length < 80)).toBe(true);
});

test('buildPostTimeTooltip labels catalogue estimates without inventing missing cost', () => {
  expect(buildPostTimeTooltip({ timestamp: '2026-06-21T11:16:02.000Z' }, {
    usage: { input_tokens: 10, total_tokens: 10, cost_total: 0.00456, cost_provenance: 'catalogue_estimate' },
  })).toContain('Catalogue cost estimate: ~$0.0046');
  expect(buildPostTimeTooltip({ timestamp: '2026-06-21T11:16:02.000Z' }, {
    usage: { input_tokens: 10, total_tokens: 10 },
  })).not.toContain('cost');
});

test('terminal agent outcomes attach agent_timing content blocks', () => {
  const handlerSource = readFileSync(resolve(repoRoot, 'runtime/src/channels/web/handlers/agent.ts'), 'utf8');
  const streamingRuntimeSource = readFileSync(
    resolve(repoRoot, 'runtime/src/channels/web/runtime/process-chat-streaming-runtime.ts'),
    'utf8',
  );
  expect(handlerSource).toContain('streamRuntime.buildAgentTimingBlock(output.usage)');
  expect(streamingRuntimeSource).toContain('type: "agent_timing"');
  expect(streamingRuntimeSource).toContain('buildAgentTimingBlock: (usage) =>');
});
