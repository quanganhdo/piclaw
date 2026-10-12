# OpenAI, Nemotron, Mistral and DeepSeek pricing check — 11 October 2026

OpenAI added a 6× Standard **Ultrafast** tier; OpenRouter increased Nemotron Nano 30B input/output prices by 20%. Mistral Large 4's undiscounted prices and DeepSeek's native prices are unchanged.

## OpenAI

- No changed Standard text tariff among the comparable rows from the September 22 snapshot, with GPT-6.1 Sol already documented separately. Sol remains $2 input / $0.10 cached input / $2.50 writes / $10 output per million tokens.
- The October 8 changelog adds `service_tier: "ultrafast"` for GPT-6.1 Sol and GPT-6 Astra. Sol Ultrafast costs **$12 input / $0.60 reads / $15 writes / $60 output**, exactly 6× Standard. Above 272K input: **$24 / $1.20 / $30 / $90**. Astra Ultrafast costs $60 / $6 / $75 / $300 in short context. These are separate service tiers, not new base model prices.
- The Ultrafast guide describes broad API access, separate request/token limits and global plus US/EU data-residency endpoints. Applicable regional modifiers and request-level tier selection remain separate.
- The pricing page also lists restricted Rosalind research/discovery at $5 input / $0.50 reads / $25 output. Its billing note names October 5; it is restricted-access coverage, not an ordinary interchangeable API option or newly changed Standard-row price.

Sources: [pricing](https://developers.openai.com/api/docs/pricing.md), [changelog](https://developers.openai.com/api/docs/changelog.md), [Ultrafast guide](https://developers.openai.com/api/docs/guides/ultrafast-mode.md).

## Nemotron hosted prices

All rates below are **OpenRouter's exact routes**, USD per million tokens. They are not native NVIDIA tariffs.

| Paid route | Input | Output | Cache read | Change from 22 September |
|---|---:|---:|---:|---|
| `nvidia/nemotron-3-nano-30b-a3b` | $0.06 | $0.24 | Unquoted | Input/output +20%; prior read quote $0.03 is absent |
| `nvidia/nemotron-3.5-lightning` | $0.07 | $0.20 | $0.04 | Unchanged |
| `nvidia/nemotron-3.5-content-safety` | $0.20 | $0.20 | Unquoted | Unchanged |
| `nvidia/nemotron-3-super-120b-a12b` | $0.08 | $0.45 | Unquoted | Unchanged |
| `nvidia/nemotron-3-ultra-550b-a55b` | $0.60 | $2.40 | $0.12 | Unchanged |

`Unquoted` stays `null` in the data; it never means free caching. Paid and `:free` variants retain distinct IDs and context/availability limits. Trial/free access does not establish unlimited production throughput.

NVIDIA's API trial terms describe trial credits and limited evaluation access. No public native NVIDIA pay-per-million production tariff was verified. NIM software licensing, NVIDIA AI Enterprise subscriptions and hardware costs are different units. The current official enterprise page did not establish a numerical licence price in this capture; old per-GPU prices are not reused.

The exact Lightning BF16 weight licence captured from NVIDIA's Hugging Face repository is **OpenMDW-1.1**, granting permission without a licence fee subject to its terms. This is separate from NIM container terms and hosted inference bills; it is not asserted for every Nemotron release.

Sources: [OpenRouter models API](https://openrouter.ai/api/v1/models), [NVIDIA trial terms](https://assets.ngc.nvidia.com/products/api-catalog/legal/NVIDIA%20API%20Trial%20Terms%20of%20Service.pdf), exact source links and retrieval metadata in [manifest](sources/manifest.json).

## Mistral

Mistral Large 4 remains **$1.36 input / $0.14 cached input / $4.18 output** undiscounted. The 50% launch offer ($0.68 / $0.07 / $2.09) is captured but **excluded from comparison rates**. No separate write tariff is published. The public preview has received model updates; no capability or price stability is inferred from its name.

The official pricing table now permits these native cached-input quotes to be recorded; the old native snapshot lacked reliable coverage, so these are newly verified entries, not claimed price cuts:

| Model | Input | Cache read | Output |
|---|---:|---:|---:|
| Large 3 (`mistral-large-2512`) | $0.50 | $0.05 | $1.50 |
| Medium 3.5 (`mistral-medium-3-5`) | $1.50 | $0.15 | $7.50 |
| Small 4 (`mistral-small-2603`) | $0.15 | $0.015 | $0.60 |

Model identities and input/output tariffs were cross-checked against their model pages; cached-input prices come from the official pricing table. No native tariff is copied to a hosted provider. The capture also retains Ministral and specialist-unit prices; pages/characters/audio minutes are not flattened into text-token rows.

Sources: [pricing](https://docs.mistral.ai/inference/pricing), [Large 4](https://docs.mistral.ai/models/mistral-large-4-0).

## DeepSeek

Native rates and aliases are unchanged from the September 22 capture:

| Model | Off-peak input | Off-peak cache read | Off-peak output | Peak prices |
|---|---:|---:|---:|---|
| `deepseek-flash` → V4.1 Flash | $0.15 | $0.003 | $0.60 | $0.30 / $0.006 / $1.20 |
| `deepseek-v4-pro` → V4 Pro 0813 | $0.66 | $0.022 | $1.98 | $1.32 / $0.044 / $3.96 |

Peak hours are Monday–Friday **01:00–04:00 and 06:00–10:00 UTC**, excluding Chinese public holidays. All other times, weekends and those holidays are off-peak. Legacy Flash IDs still route to V4.1 Flash and use Flash billing. No separate write tariff is quoted.

Source: [DeepSeek native pricing](https://api-docs.deepseek.com/quick_start/pricing).

## Verify and scope

```bash
bun docs/finops/2026-10-11/provider-audit/build.ts
```

The standalone documentation builder verifies source hashes, previous-rate comparisons, exact model-page/route quotes and mode separation. [Structured audit](audit.json) and [CSV](rates.csv) retain changes, unquoted cache fields and source URLs. Earlier dated snapshots are untouched. No runtime, resolver, tests, configuration, installation or paid inference request is changed.
