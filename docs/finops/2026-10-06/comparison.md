# Seven-model native API price comparison

USD per million tokens; Mistral launch discount excluded.

| Model | Input | Output | Cache read | Write estimator | Cached 100K + 10K | Cold 100K + 10K |
|---|---:|---:|---:|---:|---:|---:|
| GPT-6.1 Sol | $2 | $10 | $0.1 | $2.5 | $0.1315 | $0.3000 |
| GPT-6 Sol | $2 | $10 | $0.2 | $2.5 | $0.1405 | $0.3000 |
| GPT-5.6 Sol | $4 | $20 | $0.4 | $5 | $0.2810 | $0.6000 |
| GPT-5.6 Terra | $2 | $12 | $0.2 | $2.5 | $0.1605 | $0.3200 |
| Opus 5.5 | $4 | $20 | $0.2 | $5 | $0.2630 | $0.6000 |
| Sonnet 5.5 | $2 | $10 | $0.2 | $2.5 | $0.1405 | $0.3000 |
| Mistral Large 4 | $1.36 | $4.18 | $0.14 | $1.36† | $0.0680 | $0.1778 |

Cached example: 90% reads, 5% writes, 5% fresh input. † Mistral publishes no separate write tariff; writes use ordinary input once. Other provider writes use their published rates. Anthropic writes use 5m TTL. These are equal-token price scenarios, not measured task costs or quality rankings. GPT-5.6 Sol via OpenRouter remains a separate $2/$10/$0.20/$2.50 route, not the native $4/$20/$0.40/$5 row above.
