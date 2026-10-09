# Mistral Large 4 pricing — 6 October 2026

Mistral Large 4's **undiscounted native API prices** are **$1.36 input, $0.14 cached input and $4.18 output per million tokens**. The [model page](https://docs.mistral.ai/models/mistral-large-4-0) identifies `mistral-large-4` and `mistral-large-4-0`, quotes 1M context and labels the model Public Preview. The two-week 50% launch offer is excluded from the resolver and comparison; its $0.68/$0.07/$2.09 prices remain in the source capture.

## Cache billing

Mistral publishes no separate cache-write tariff or cache TTL in the captured documentation. The estimator charges separated cache-write tokens **once at the $1.36 ordinary input rate**, consistent with the documented uncached-input billing; this is an estimator fallback, not an additional write surcharge. The structured research record keeps the unpublished write tariff as `null`.

The [prompt-caching guide](https://docs.mistral.ai/studio/conversations/advanced/prompt-caching.md) specifies shared prefixes, optional `prompt_cache_key`, 64-token cache blocks and `usage.prompt_tokens_details.cached_tokens`. `prompt_tokens` includes cached tokens, so billable uncached input is `prompt_tokens - cached_tokens`. A cache key increases the chance of a hit without guaranteeing one. The guide says reads cost 10% of input; the model page rounds the undiscounted read quote to **$0.14**, which this record preserves rather than replacing with $0.136.

## Comparison

[Seven-model prices and request examples](comparison.md), [machine-readable comparison](comparison.json) and [CSV](comparison.csv) add one undiscounted Mistral entry to the six-model comparison captured at 06:46 UTC on 6 October. The other six model prices are preserved, not re-fetched or silently updated in the resolver.

- At 100K prompt + 10K output with 90% reads, 5% writes and 5% fresh input, Mistral costs **$0.0680**, versus GPT-6.1 Sol **$0.1315**, GPT-6 Sol / Sonnet 5.5 **$0.1405**, Terra **$0.1605**, Opus 5.5 **$0.2630** and native GPT-5.6 Sol **$0.2810**.
- With a fully cold 100K prompt + 10K output, Mistral costs **$0.1778** versus GPT-6.1 Sol / GPT-6 Sol / Sonnet 5.5 **$0.3000**.
- At 400K prompt + 40K output with the same cache mix, Mistral costs **$0.2720**. The model page publishes one schedule across 1M context; no separate uplift was found. GPT-6.1 Sol costs **$0.8520** under its whole-request >272K tier, and Sonnet 5.5 costs **$0.5620**.

These examples compare equal token counts. Tokenisers, retries, reasoning tokens and task success can change actual task cost. Native tariffs do not establish Copilot, OpenRouter, Azure or subscription entitlement. GPT-5.6 Sol's cheaper OpenRouter route remains separately recorded in the baseline. No free self-hosting or promotional entry is ranked.

## Preview and capability evidence

The [announcement](https://mistral.ai/news/mistral-large-4/) describes a multimodal mixture-of-experts model with about 1T total / 49B active parameters, trained and served on Mistral infrastructure in Europe. It promises weights by the end of October. The release licence and self-hosted operating cost are not established by that promise.

Mistral reports 61.7% DeepSWE 1.1, 28.3% Terminal-Bench 4 and 59.9% AutomationBench. Its blind coding evaluation compares against **Opus 5**, not Opus 5.5. These announcement results do not establish parity with the six compared models on this fleet's workload. The [lifecycle guide](https://docs.mistral.ai/inference/model-lifecycle.md) allows silent updates to public previews.

## Reproduce

```bash
bun docs/finops/2026-10-06/build.ts
bun docs/finops/2026-10-06/verify.ts
bun runtime/scripts/local-test-priority.ts --cwd runtime --env PICLAW_DB_IN_MEMORY=1 -- bun test test/scripts/provider-model-pricing-reference.test.ts
```

Raw first-party captures, the prior six-model snapshot and SHA-256 digests are under `sources/`. Historical dated snapshots are unchanged. This addition changes source pricing data only: no service restart, configuration/default-model change, historical usage rewrite or paid inference request.
