# Mercury 3 regular pricing — 19 October 2026

Mercury 3's **regular, undiscounted native Inception API prices** are **$0.20 input, $0.02 cached input and $0.70 output per million tokens**. The 50% launch prices ($0.10 / $0.01 / $0.35) are excluded from this price-list entry.

| Native API model | Input | Cached input | Cache write | Output |
|---|---:|---:|---:|---:|
| `mercury-3` | $0.20 | $0.02 | Unpublished | $0.70 |

Prices are USD per million tokens. The [official model documentation](https://docs.inceptionlabs.ai/get-started/models.md) states the regular prices explicitly, alongside the launch offer; the [public models page](https://www.inceptionlabs.ai/models) agrees. The [announcement](https://www.inceptionlabs.ai/blog/introducing-mercury-3) quotes regular input/output prices and a 90% cached-input discount, consistent with $0.02 cached input.

## Cache, context and route terms

- Model ID: `mercury-3`; endpoint: `v1/chat/completions`. Published context: **1M tokens**; maximum output: **131,072 tokens**. Reasoning efforts: `instant`, `low`, `medium`, `high`.
- No separate cache-write tariff, cache TTL or cache-storage charge was found in the captured pricing section. `cw` remains `null` in the research record and empty in the CSV; no free-write or extra write-surcharge claim is made.
- One price schedule is published for Mercury 3. No separate long-context uplift was found in these captures; this does not establish an unquoted tier or negotiated contract.
- This record covers the **native Inception API**. The announcement names OpenRouter, Baseten and Vercel availability, but their route prices and entitlements are not inferred from native rates.
- Mercury Voice is a separate model. Its nearby table lists a different output price and is excluded from this entry. Earlier Mercury releases and historical snapshots are unchanged.

## Record and verification

[Structured price record](mercury-3.json) and [CSV price-list entry](prices.csv) contain only the regular Mercury 3 quote. Raw first-party captures, retrieval timestamps and SHA-256 hashes are under `sources/`; promotional figures are preserved there as evidence only.

```bash
bun docs/finops/2026-10-19/verify.ts
```

The standalone documentation verifier checks capture hashes, model identity, the explicitly labelled regular-price quote, the model's own pricing-table cells, CSV values and context/output limits. No full runtime suite is needed for this documentation update.

No runtime, resolver, test, dependency or configuration changes. No deployment, restart, paid inference request or historical usage rewrite. Token prices compare equal token counts; tokenizer differences, reasoning, retries, cache hits and task success affect actual cost.
