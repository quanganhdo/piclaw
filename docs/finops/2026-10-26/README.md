# GPT-6.1 Terra pricing — 26 October 2026

OpenAI Standard prices are half GPT-6.1 Sol's corresponding rates. These are API token tariffs, not subscription entitlements or a quality comparison.

USD per million tokens:

| Token category | Up to 272K input | More than 272K input |
| --- | ---: | ---: |
| Input | 1.00 | 2.00 |
| Output | 5.00 | 7.50 |
| Cache read | 0.05 | 0.10 |
| Cache write, 30-minute retention | 1.25 | 2.50 |
| Cache write, 12-hour retention | 2.50 | 5.00 |

The long-context tier applies to the whole request when input exceeds 272,000 tokens. The model page lists a 1,050,000-token context window.

OpenRouter's exact `openai/gpt-6.1-terra` route independently matches Standard input, output, read and short-retention write rates, including the long-context override. Its captured catalogue does not establish a separate 12-hour write tariff. The captured Copilot pricing table does not list GPT-6.1 Terra; no Copilot price or entitlement is inferred.

Other processing tiers, tool charges, regional uplifts, taxes and gateway fees are outside this base comparison. No runtime resolver, model defaults, historical usage or deployment was changed.

## Evidence and checks

- [OpenAI pricing](https://developers.openai.com/api/docs/pricing.md): `openai-pricing.md`
- [OpenAI model](https://developers.openai.com/api/docs/models/gpt-6.1-terra.md): `terra-model.md`
- [OpenRouter catalogue](https://openrouter.ai/api/v1/models): `openrouter.json`
- [Copilot pricing](https://docs.github.com/en/copilot/reference/copilot-billing/models-and-pricing.md): `copilot.md`

`sources.json` records retrieval timestamps and SHA-256 hashes. `pricing.json` contains provider-specific machine-readable rates.

Verify existing captures without fetching or using a browser:

```sh
bun docs/finops/2026-10-26/capture.ts --verify-only
```

Omit `--verify-only` to refresh the dated source captures and rebuild the record.
