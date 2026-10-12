# GPT-5.5, GPT-6.1 Sol and Sonnet 5.5 pricing — 11 October 2026

Claude Sonnet 5.5 now quotes **$0.10/M cache reads**, matching GPT-6.1 Sol. This supersedes the $0.20/M Sonnet quote in the 6 October comparison. The three models are independently verified on their native, GitHub Copilot and provider-qualified OpenRouter routes.

| Model | Input | Cache read | Cache write | Output |
|---|---:|---:|---:|---:|
| GPT-5.5 | $5 | $0.50 | Unpublished¹ | $30 |
| GPT-6.1 Sol | $2 | $0.10 | $2.50 | $10 |
| Claude Sonnet 5.5 | $2 | $0.10 | $2.50² | $10 |

USD per million tokens, Standard/global base tier. ¹ No separate GPT-5.5 write surcharge: separated write/miss tokens use ordinary input once in the estimator. The research tariff is `null`. ² Anthropic uses the 5-minute cache here; 1-hour writes cost $4/M. Copilot's write quote does not establish 1h support.

## Context and matched requests

OpenAI native/Copilot prices the whole request/session above 272K input at 2× input/cache prices and 1.5× output. Sonnet uses one schedule across 1M context. OpenRouter's raw `min_prompt_tokens: 272000` overrides remain separately recorded with their inclusive boundary; native boundaries are not silently copied to the router.

For 100K prompt + 10K output, 90% reads / 5% writes / 5% fresh: GPT-5.5 **$0.3950**, Sol and Sonnet **$0.1315**. Cold: **$0.80** versus **$0.30**. At 400K prompt + 40K output, the same cached mix costs **$2.56 / $0.852 / $0.526**, respectively. These are equal-token prices; tokenisers, retries, reasoning, cache hits and task success affect actual costs. Reasoning already included in output is not added twice.

## Data and route boundaries

- [Structured research](pricing.json) preserves native long-context tiers, OpenRouter overrides, cache-write `null` values, 1h writes, source URLs and retrieval dates. [CSV](prices.csv) keeps published and estimated write prices separate.
- Nine documented native/Copilot/OpenRouter routes are independently quoted. No Codex, Azure or generic provider price is inferred, and no runtime resolver data is changed.
- Sonnet's native name is `claude-sonnet-5-5`; the catalogue/OpenRouter spelling is `claude-sonnet-5.5`. Provider-qualified router names remain separate in the research data. Other model generations and Mistral's undiscounted October 6 rates are unchanged.
- Captured first-party Markdown and OpenRouter JSON are hash-verified under `sources/`. October 6 and September historical records remain byte-identical.
- Batch/Fast, geography, tools, storage and taxes are excluded from the examples; subscription allowances, credits and invoices are separate. These are documentation records, not runtime billing changes.

## Verify

```bash
bun docs/finops/2026-10-11/build.ts
bun docs/finops/2026-10-11/verify.ts
```

Documentation-only update. No runtime, test, configuration, deployment, default-model change, paid inference request or historical usage rewrite.

## Additional provider checks

[OpenAI, Nemotron, Mistral and DeepSeek check](provider-audit/README.md) records the new OpenAI Ultrafast tier, OpenRouter Nemotron Nano's changed price and cache-quote gap, unchanged Mistral Large 4/DeepSeek prices, and newly verified native Mistral coverage. Hosted routes, licences and trial credits remain separate.
