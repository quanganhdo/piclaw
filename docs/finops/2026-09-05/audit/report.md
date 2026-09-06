# Model pricing: Fable, Astra and open weights

5 September 2026 · USD · identical seven-day workload · request-level context tiers

## What changes the decision

- Fable 5.1 costs $2,064.44 for the seven-day replay: 42.7% less than Fable 5, and 69.9% less than Astra after request-level long-context pricing. Its cache-read rate falls 75%, from $1 to $0.25/MTok; input/output remain $10/$50.
- Astra is 2.5× Sol's current direct/Copilot token tariffs in both context tiers: $6,858.21 versus $2,743.28 for the same workload. At standard short-context prices, Astra and Fable 5 have identical four-category rates.
- OpenRouter Sol is quoted at $2/$10 input/output, versus direct/Copilot $4/$20: the replay is 50% cheaper ($1,371.64). This is a provider-route difference; do not merge these tariff records, even when merging Sol family usage charts.
- DeepSeek V4 Pro 0813 via OpenRouter is $113.80, 98.3% below Astra. This is a cost opportunity to benchmark, not evidence of equal task success.
- The ledger contains 31 zero-estimate Astra records covering 14,062,471 tokens. Zero represented missing pricing here; it must not be presented as free inference.

## Workload and accounting

- Scope: Smith's canonical SQLite token_usage ledger, all chats, 2026-08-29T20:19:00.000Z through 2026-09-05T20:19:00.000Z (exclusive). 4,719 usage records; 2,174,907,456 accounted tokens. One usage record is not necessarily one user turn.
- Input 31,925,481 (1.5%); output 2,512,444 (0.1%); cache read 2,051,943,183 (94.3%); cache write 88,526,348 (4.1%).
- Cache hits are 94.5% of prompt tokens. 80.9% of records and 93.7% of token volume are in requests exceeding 272K prompt tokens. Long-context tariffs materially change the result.
- The independent input/output/cache categories sum exactly to total_tokens for this window. 829,803 reasoning tokens are retained as detail but are not added to output again. Recorded historical estimated cost is $1,745.38; it mixes models, tariffs and missing prices and is not the comparison baseline.
- Graphite was checked for fleet inventory. It exports interval sums, not request sizes; its seven-day roll-ups and historical catch-up points cannot support an equally reliable long-context replay. The figures below are Smith workload equivalents, not a claimed whole-fleet bill. A fleet-24h raw snapshot is in sources/.
- The last-24h sensitivity uses 500 records and 186,726,804 tokens from the same ledger, ending at the same cutoff.

## How to read the comparison

- Fixed-workload replay holds token counts, cache behaviour and output length constant. Model tokenisation, reasoning effort, retries, tool competence and success rate may change these quantities in practice.
- Seven-day warm cost = sum of each request’s uncached-input × input rate + output × output rate + cache-read × read rate + cache-write × write rate, divided by one million. Apply >272K OpenAI/Copilot tiers to each request; use the returned OpenRouter pricing overrides for routed models.
- Cache cold removes all hits: input + cache reads + cache writes are charged as ordinary input. It represents a no-reuse sensitivity, not necessarily the exact first migration bill. One-hour Anthropic cache writes are an additional sensitivity in comparison.json.
- Where a cache tariff is not published, the scenario uses ordinary input rather than treating the tokens as free. Rates display — for an unpublished cache meter; missing entire input/output prices remain unverified and unranked.
- All comparisons use standard processing, global/USD list rates, no batch discounts, no taxes, no tools/search charges, no regional uplift and no negotiated discounts. OpenRouter credits/funding fees and the actual selected upstream endpoint can alter cash cost.
- Copilot currently documents token-based AI credits (one credit = $0.01). Reported costs indicate consumption before plan allowances/budgets. Codex API-equivalent costs cannot be equated to a ChatGPT subscription invoice.
- The three candidates per provider are a frontier/predecessor/value shortlist for this task, not an invented benchmark leaderboard. The user’s SMART scores remain unchanged in historical artefacts; no new numerical capability score is asserted.

## GitHub Copilot

Astra and Sol are visible locally. Fable 5.1 is GA in GitHub’s public price table, but is absent from this session’s current local picker. Catalogue refresh/entitlement checks are needed before routing to it. Fable 5 ($3,603.40/replay) is its immediate predecessor; see deltas below.

| Model | Input / output per M | Cache read / write per M | 7d warm | vs Astra | 24h warm | 7d cold |
| --- | --- | --- | ---: | ---: | ---: | ---: |
| gpt-6-astra (gpt-6-astra) | $10 / $50 | $1 / $12.5 | $6,858.21 | 0.0% | $643.98 | $42,256.78 |
| Claude Fable 5.1 (claude-fable-5.1) | $10 / $50 | $0.25 / $12.5 | $2,064.44 | -69.9% | $234.52 | $21,849.57 |
| gpt-5.6-sol (gpt-5.6-sol) | $4 / $20 | $0.4 / $5 | $2,743.28 | -60.0% | $257.59 | $16,902.71 |

## OpenAI Codex

All three candidates appear in the local model picker. Fable is not offered on this route. The costs are public API-equivalents, not a quota or message-count conversion.

| Model | Input / output per M | Cache read / write per M | 7d warm | vs Astra | 24h warm | 7d cold |
| --- | --- | --- | ---: | ---: | ---: | ---: |
| gpt-6-astra (gpt-6-astra) | $10 / $50 | $1 / $12.5 | $6,858.21 | 0.0% | $643.98 | $42,256.78 |
| gpt-5.6-sol (gpt-5.6-sol) | $4 / $20 | $0.4 / $5 | $2,743.28 | -60.0% | $257.59 | $16,902.71 |
| gpt-5.6-terra (gpt-5.6-terra) | $2 / $12 | $0.2 / $2.5 | $1,378.70 | -79.9% | $129.55 | $8,458.42 |

## Anthropic public API

Fable 5.1 → Fable 5 → Opus 5 is the premium lineage used here. Direct Anthropic credentials are not assumed configured; these models can also be accessed through OpenRouter. Restricted Mythos is excluded.

| Model | Input / output per M | Cache read / write per M | 7d warm | vs Astra | 24h warm | 7d cold |
| --- | --- | --- | ---: | ---: | ---: | ---: |
| Claude Fable 5.1 (claude-fable-5.1) | $10 / $50 | $0.25 / $12.5 | $2,064.44 | -69.9% | $234.52 | $21,849.57 |
| Claude Fable 5 (claude-fable-5) | $10 / $50 | $1 / $12.5 | $3,603.40 | -47.5% | $362.09 | $21,849.57 |
| Claude Opus 5 (claude-opus-5) | $5 / $25 | $0.5 / $6.25 | $1,801.70 | -73.7% | $181.04 | $10,924.79 |

## OpenRouter premium/value shortlist

All routes are in the live public API. Fable 5.1 appears in the local picker; Astra is publicly listed but may require catalogue refresh. DeepSeek Pro is the selected open-weight alternative; compare Kimi and MiniMax in the separate open-weight group.

| Model | Input / output per M | Cache read / write per M | 7d warm | vs Astra | 24h warm | 7d cold |
| --- | --- | --- | ---: | ---: | ---: | ---: |
| Anthropic: Claude Fable 5.1 (anthropic/claude-fable-5.1) | $10 / $50 | $0.25 / $12.5 | $2,064.44 | -69.9% | $234.52 | $21,849.57 |
| OpenAI: GPT-6 Astra (openai/gpt-6-astra) | $10 / $50 | $1 / $12.5 | $6,858.21 | 0.0% | $643.98 | $42,256.78 |
| DeepSeek: DeepSeek V4 Pro 0813 (deepseek/deepseek-v4-pro-0813) | $0.579 / $1.738 | $0.019 / — | $113.80 | -98.3% | $13.25 | $1,263.23 |

## Cerebras

All three IDs are visible locally. GPT-OSS $0.35/$0.75 is publicly verified; Gemma $0.99/$1.49 is catalogue-only. GLM has zero placeholders locally and no verified price. The listed 131K capacities for the priced models are below the prompt size of 91.5% of this workload’s records: compaction/chunking is required, so costs are illustrative, not drop-in capacity claims.

| Model | Input / output per M | Cache read / write per M | 7d warm | vs Astra | 24h warm | 7d cold |
| --- | --- | --- | ---: | ---: | ---: | ---: |
| Gemma 4 31B IT (gemma-4-31b) | $0.99 / $1.49 | — / — | $2,154.41 | -68.6% | $185.00 | $2,154.41 |
| GPT OSS 120B (gpt-oss-120b) | $0.35 / $0.75 | — / — | $762.22 | -88.9% | $65.47 | $762.22 |
| GLM 4.7 (zai-glm-4.7) | — / — | — / — | Unverified | — | Unverified | Unverified |

## Azure OpenAI (native reference only)

These three models are configured locally. Values below are native OpenAI references, not verified regional Azure prices; no Azure savings recommendation follows from them. Astra is not in our Azure deployment list. Check actual region, deployment SKU and contract before routing.

| Model | Input / output per M | Cache read / write per M | 7d warm | vs Astra | 24h warm | 7d cold |
| --- | --- | --- | ---: | ---: | ---: | ---: |
| gpt-5.4-pro (gpt-5.4-pro) | $30 / $180 | — / — | $126,876.25 | 1750.0% | $10,162.42 | $126,876.25 |
| gpt-5.4 (gpt-5.4) | $2.5 / $15 | $0.25 / — | $1,617.05 | -76.4% | $154.82 | $10,573.02 |
| GPT-5.3 Codex (gpt-5.3-codex) | $1.75 / $14 | $0.175 / — | $605.05 | -91.2% | $62.27 | $3,836.87 |

## Azure Foundry (verification incomplete)

All three IDs are configured. Flash/Mistral figures are historical local references, not refreshed public Azure quotations. Pro is unpriced. The dynamic Azure page did not establish numeric rates; no OpenRouter tariff was substituted.

| Model | Input / output per M | Cache read / write per M | 7d warm | vs Astra | 24h warm | 7d cold |
| --- | --- | --- | ---: | ---: | ---: | ---: |
| DeepSeek V4 Pro (deepseek-v4-pro) | — / — | — / — | Unverified | — | Unverified | Unverified |
| DeepSeek V4 Flash (deepseek-v4-flash) | $0.19 / $0.51 | — / — | $414.04 | -94.0% | $35.57 | $414.04 |
| Mistral Large 3 (mistral-large-3) | $0.5 / $1.5 | — / — | $1,089.97 | -84.1% | $93.64 | $1,089.97 |

## Open-weight capability candidates via OpenRouter

The public API exposes model-weight links: DeepSeek (MIT), Kimi K3 and MiniMax M3 (custom licences). All three have a listed 1,048,576 context window, above every observed prompt. Public presence is not a live inference/entitlement test; validate coding and tool-use performance on representative tasks.

| Model | Input / output per M | Cache read / write per M | 7d warm | vs Astra | 24h warm | 7d cold |
| --- | --- | --- | ---: | ---: | ---: | ---: |
| DeepSeek: DeepSeek V4 Pro 0813 (deepseek/deepseek-v4-pro-0813) | $0.579 / $1.738 | $0.019 / — | $113.80 | -98.3% | $13.25 | $1,263.23 |
| MoonshotAI: Kimi K3 (moonshotai/kimi-k3) | $3 / $15 | $0.3 / — | $1,014.63 | -85.2% | $104.25 | $6,554.87 |
| MiniMax: MiniMax M3 (minimax/minimax-m3) | $0.3 / $1.2 | $0.06 / — | $162.27 | -97.6% | $15.45 | $654.73 |

## Premium and precursor deltas

| New choice vs baseline | 7d dollar delta | Percent delta |
| --- | ---: | ---: |
| Fable 5.1 vs Fable 5 | -$1,538.96 | -42.7% |
| Fable 5 vs Opus 5 | $1,801.70 | 100.0% |
| Fable 5.1 vs Opus 5 | $262.74 | 14.6% |
| Astra vs Sol (direct equivalent) | $4,114.92 | 150.0% |
| Sol vs GPT-5.5 | -$490.81 | -15.2% |
| Fable 5.1 vs Astra | -$4,793.76 | -69.9% |
| DeepSeek Pro vs Fable 5.1 | -$1,950.64 | -94.5% |

## Recommended trial order

- Premium: benchmark Fable 5.1 against Astra on real coding/ops tasks. Fable’s new cache discount is highly relevant to our warm, long-context workload; choose Astra when its measured task outcomes justify the premium.
- Precursor: retain Sol as a comparison baseline. The public OpenRouter Sol rate is half direct/Copilot, but model identity, upstream routing, privacy requirements and cache hit behaviour must be checked before switching.
- Open weights: trial DeepSeek V4 Pro 0813 first for capability/cost balance, alongside Kimi K3 and MiniMax M3. Add DeepSeek V4 Flash 0731 for cheap triage/extraction: its fixed-workload estimate is $41.11 per week. These are trial candidates, not asserted quality substitutes.
- Infrastructure: do not route this long-context workload directly to the smaller-context Cerebras models without a compaction plan. Open weights hosted locally have non-zero hardware, electricity and operations costs, which are outside API pricing.
- Next validation: run a fixed task set and record success rate, retries, actual output tokens, cache hits and wall time. Compare dollars per successful task before changing defaults.

## Data changes and remaining gaps

- The refreshed catalogue contains 1430 provider/model/API entries with provenance; 499 verified route rows are prepared for the token-chart pricing resolver (see PR/patch). Installed catalogue fields were copied through a non-secret whitelist.
- The runtime pricing reference snapshot adds Fable 5/5.1 and Astra, refreshes public OpenRouter rates, preserves provider-specific Sol prices, and stops assuming unpublished cache reads are free in refreshed rows.
- Old $/M figures in the ternary SVGs were measured blended costs for a specific historical mix, not official input/output tariffs. Historical SVGs/ledger rows are preserved; this dated catalogue/report supersedes them for new price comparisons.
- No provider credentials, deployments, runtime model choices or historical token_usage rows were changed; no reload was performed. The source refresh is isolated for review, not installed into the running process.
- Public first-party and OpenRouter prices override stale installed rates in this report. Catalogue-only, historical-unverified and native-reference-only entries are explicitly labelled, including the incomplete Azure and GLM prices.

## Sources

- [OpenAI pricing](https://developers.openai.com/api/docs/pricing.md)
- [Anthropic pricing](https://platform.claude.com/docs/en/about-claude/pricing.md)
- [Copilot pricing and credit accounting](https://docs.github.com/en/copilot/reference/copilot-billing/models-and-pricing.md)
- [OpenRouter live model catalogue](https://openrouter.ai/api/v1/models)
- [Codex subscription pricing](https://developers.openai.com/codex/pricing)
- [Cerebras GPT-OSS 120B](https://inference-docs.cerebras.ai/models/openai-oss.md)
- [Astra context window](https://developers.openai.com/api/docs/models/gpt-6-astra.md)
- [Fable 5.1 announcement](https://www.anthropic.com/claude-fable-and-mythos-5-1)
- [DeepSeek weights (MIT)](https://huggingface.co/deepseek-ai/DeepSeek-V4-Pro-0813)
- [Kimi K3 weights (custom licence)](https://huggingface.co/moonshotai/Kimi-K3)
- [MiniMax M3 weights (custom licence)](https://huggingface.co/MiniMaxAI/Minimax-M3)
