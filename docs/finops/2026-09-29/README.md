# GPT-6.1 Sol price record — 29 September 2026

OpenAI lists `gpt-6.1-sol` at **$2 input, $0.10 cached input, $2.50 cache writes and $10 output per million tokens** in the Standard short-context tier. The cached-input rate is half the $0.20 rate for `gpt-6-sol`; the other listed short-context token rates are equal.

| Processing | Context | Input | Cache read | Cache write | Output |
|---|---|---:|---:|---:|---:|
| Standard | ≤272K input | $2 | $0.10 | $2.50 | $10 |
| Standard | >272K input | $4 | $0.20 | $5 | $15 |
| Batch / Flex | ≤272K input | $1 | $0.05 | $1.25 | $5 |
| Batch / Flex | >272K input | $2 | $0.10 | $2.50 | $7.50 |
| Fast | ≤272K input | $4 | $0.20 | $5 | $20 |
| Fast | >272K input | $8 | $0.40 | $10 | $30 |

All prices are **USD per million tokens**. For prompts over 272K input tokens, OpenAI charges the higher tier for the **whole request**. The model page states a 1,050,000-token context window, 922,000 maximum input and 128,000 maximum output. Eligible regional processing adds 10%. Fast mode is unavailable with EU data residency. Chat Completions supports this model without tool calling; tool calling requires the Responses API.

The requested [OpenAI announcement](https://openai.com/index/introducing-gpt-6-1-sol/) returned HTTP 403 from this workspace. [OpenAI's developer model page](https://developers.openai.com/api/docs/models/gpt-6.1-sol.md) and [developer price table](https://developers.openai.com/api/docs/pricing.md) both returned HTTP 200 and agree on the rates above. Their captured Markdown is under `sources/`, with retrieval metadata and SHA-256 digests in `sources/evidence-manifest.json`.

This is the **native OpenAI API route**. The OpenRouter `/api/v1/models` response and GitHub Copilot's published pricing table checked on 29 September did not list GPT-6.1 Sol; no rate or entitlement is inferred for those routes. API-equivalent values are separate from subscriptions, credits and invoices. The historical [22 September snapshot](../2026-09-22/README.md) remains unchanged.

[Structured rates](gpt-6.1-sol.json) preserve the distinct provider route, context boundary, mode, source, and source-access limitations. The companion resolver change adds **only the native OpenAI API route** to estimated chart costs, with alias and no-cross-provider tests. The chart still uses short-context Standard rates; exact long-context, Batch/Flex, Fast and regional billing needs request-level selection. Configured models, historical ledger rows, subscriptions and the live service are unchanged.
