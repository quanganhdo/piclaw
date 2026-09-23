# Fixed-workload price comparison — 22 September 2026

Same September 5 illustrative workload: eight tasks / 150 minutes per day, 30 days, 870 calls, 25.8M prompt and 1.65M output tokens. Cache mix: 94.4553% reads, 4.0751% writes, 1.4696% ordinary input. These are scenario assumptions, not Rui's measured habits or a fleet replay.

| Provider | Model | Monthly with assumed cache mix | Cold-cache comparison | Basis |
|---|---|---:|---:|---|
| openai | gpt-6-astra | $123.80 | $340.50 | Standard short-context; 5m writes where quoted |
| openai | gpt-6-sol | $24.76 | $68.10 | Standard short-context; 5m writes where quoted |
| openai | gpt-6-luna | $1.24 | $3.40 | Standard short-context; 5m writes where quoted |
| openai | gpt-5.6-sol | $49.52 | $136.20 | Standard short-context; 5m writes where quoted |
| openrouter | openai/gpt-5.6-sol | $24.76 | $68.10 | Standard short-context; 5m writes where quoted |
| anthropic | claude-opus-5.5 | $44.65 | $136.20 | Standard short-context; 5m writes where quoted |
| anthropic | claude-opus-5 | $61.90 | $170.25 | Standard short-context; 5m writes where quoted |
| anthropic | claude-sonnet-5 | $24.76 | $68.10 | Standard short-context; 5m writes where quoted |
| anthropic | claude-fable-5.1 | $105.53 | $340.50 | Standard short-context; 5m writes where quoted |
| google | gemini-3.8-flash | $9.09 | $25.54 | Promotion through 2026-12-31 |
| moonshot | kimi-k3 | $36.35 | $102.15 | Standard short-context; 5m writes where quoted |
| deepseek | deepseek-flash | $1.28 | $4.86 | Off-peak only |

Each row prices the same token counts entirely on one route. It is not a quality ranking, a recommendation to route every task to a small model, or a guarantee of subscription fit. Different tokenisers, retries, task success and cache persistence can change cost. Reasoning is already included in output. Taxes, separate cache storage, tool charges and subscriptions are excluded.

Historical workload recommendations and September 5 outputs remain unchanged; this comparison only updates the tariff input.
