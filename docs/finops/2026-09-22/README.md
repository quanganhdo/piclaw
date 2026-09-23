# Model pricing refresh — 22 September 2026

The current reference adds GPT-6 Sol, GPT-6 Luna and Claude Opus 5.5, refreshes 609 provider/model routes and retains 195 processing/geography variants as separate evidence.

All token prices below are USD per million tokens. These are API tariffs or explicitly labelled API-equivalent valuations. They do not establish subscription capacity, model entitlement or actual invoice totals.

## Newly announced prices

| Native route | Input | Output | Cache read | 5m/base cache write | 1h cache write |
|---|---:|---:|---:|---:|---:|
| OpenAI GPT-6 Sol | $2 | $10 | $0.20 | $2.50 | Unpublished |
| OpenAI GPT-6 Luna | $0.10 | $0.50 | $0.01 | $0.125 | Unpublished |
| Anthropic Claude Opus 5.5 | $4 | $20 | $0.20 | $5 | $8 |
| Anthropic Claude Sonnet 5 | $2 | $10 | $0.20 | $2.50 | $4 |

OpenAI's [22 September changelog](sources/openai-changelog.md) announces Sol and Luna. Their model pages confirm a 1,050,000-token context and whole-request long-context pricing **above 272K input tokens**: input/cache rates double; output rises 1.5×. Batch/Flex cost half Standard; Fast costs twice Standard. These are service tiers, not extra model IDs. Eligible regional processing adds 10%; GPT-6 Sol/Luna EU residency is Standard-only.

Anthropic's [22 September Opus 5.5 announcement](sources/anthropic-announcement.md) confirms $4/$20 and $0.20 cache hits. The upstream API ID is **`claude-opus-5-5`**; the local catalogue/display selector uses `claude-opus-5.5`, and the resolver accepts both. Against Opus 5, input/output and cache writes fall 20%; cache reads fall 60%. Fast costs $8/$40 with $0.40 reads, $10 5m writes and $16 1h writes. Batch is 50% off and cannot combine with Fast. Claude 4.6+ uses standard rates across 1M context.

Anthropic confirms that Sonnet 5's $2/$10 launch price is now **permanent**; the previously announced September increase to $3/$15 did not happen. Fable 5.1 remains $10/$50 with $0.25 reads. Newer Anthropic tokenisation can produce about 30% more tokens for identical text; equal-token comparisons do not prove equal-task savings.

## Other refreshed providers

- **OpenRouter:** 447 priced routes from the 452-entry public API response (five automatic routers return `-1` sentinel tariffs and remain unpriced), including conditional overrides and separate non-token meters. 183 routes have changed base token meters versus the September 5 dataset. Routes missing from the current response keep only their explicitly dated fallback; disappearance does not prove retirement.
- **Copilot:** independently parsed published rates, including Opus 5.5, Sonnet 5, Gemini 3.6–3.8 Flash and Grok 4.5–4.7. GPT-6 Sol/Luna are absent from its fetched price table, so no Copilot entitlement or quote is inferred. AI credits use $0.01 per credit; included allowances and legacy annual request billing remain separate.
- **Google:** current native Gemini 3.5–3.8 Flash and 3.1 Flash-Lite standard text rates. Gemini 3.6–3.8 Flash costs $0.75/$3.75 with $0.075 reads through **31 December 2026**; the announced January rate is $1.50/$7.50 with $0.15 reads. Cache storage is a separate token-hour charge. Audio, image generation and older models are preserved in the fetched source but not flattened into these five text rows.
- **DeepSeek:** `deepseek-flash` and accepted legacy Flash IDs now resolve to V4.1 Flash. Off-peak is $0.15/$0.60 with $0.003 cache hits; peak is $0.30/$1.20 with $0.006 hits. V4 Pro 0813 is $0.66/$1.98/$0.022 off-peak and twice those rates at peak. Peak hours are weekday 01:00–04:00 and 06:00–10:00 UTC, excluding Chinese public holidays. The simple resolver quotes the labelled off-peak base; request-time billing must select the schedule.
- **Z.ai:** GLM-5.3, 5.3-Flash/FlashX and other native token tariffs. GLM-5.3-Flash's $0.15/$0.50/$0.03 is twice the old catalogue-derived $0.075/$0.25/$0.015. Free cache storage does not imply a free cache-write token tariff.
- **Fireworks:** per-model Standard, Priority, Fast and US-only rows, including Kimi K3, DeepSeek V4.1 Flash, GLM 5.3, Qwen 3.8 Max and MiniMax M3. Preserve the 1.5× US premium and the documented GLM 5.2 Fast US exception; do not borrow a native vendor's quote for this route.
- **Kimi:** native K3 costs $3/$15 with $0.30 reads, $3 5m writes and $6 1h writes. K2.7 Code/highspeed and K2.6 are also captured.
- **xAI:** Grok 4.7/4.6/4.5 and other listed text routes with native **≥200K** long-context boundaries. Native Grok 4.5 reads cost $0.30; Copilot quotes $0.50 and a **>200K** threshold. Keep both route differences.
- **Groq:** verified GPT-OSS 120B, 20B, Safeguard 20B and Qwen 3.8 27B. Llama and MiniMax entries now say Contact Sales; stale catalogue numbers are not promoted to current quotes.

## Coverage and unresolved rates

The refresh has 609 standard/base route rows across 12 provider IDs: OpenAI, Anthropic, Copilot, OpenRouter, Google, DeepSeek, Z.ai, Fireworks, Moonshot, xAI, Groq and the explicitly API-equivalent Codex subset. Compared with the old audit catalogue, 191 rows change base token prices and 82 have no prior exact provider/model match; the latter includes expanded verification, not only newly launched models. The installed catalogue snapshot contains 1,354 unique routes and is diagnostic evidence, not a verified price source.

Cerebras's public pricing/redirect lacks extractable model tariffs. SambaNova's price page is client-rendered; its docs verify model availability but not tariffs. Azure's DeepSeek page exposes dollar placeholders. Together and Mistral pages did not yield a reliable model-ID/tariff mapping. These remain unverified, with fetch results in [the source manifest](sources/fetch-manifest.json) and per-route coverage in [coverage.json](coverage.json). No prices are guessed from another provider.

The OpenAI marketing pricing page returned HTTP 403; its official developer Markdown pricing and announcement pages returned HTTP 200 and supplied the rates. The Anthropic delegated research timed out after saving source captures; the rates above were independently checked directly against official Markdown and the announcement.

## Tables, data and reproduction

- [All verified prices](prices.md) and [CSV](prices.csv): base quotes with route identity.
- [Structured catalogue](pricing-catalogue.json): source citations, API IDs, 1h writes, modes, long-context tiers, promotion dates, peak schedules and OpenRouter overrides.
- [Price deltas](deltas.json): comparison against the historical September 5 snapshot.
- [Coverage](coverage.json): verified providers, unverified installed routes and research gaps.
- [Evidence digests](sources/evidence-manifest.json): SHA-256 hashes of committed source captures. HTML extractions are labelled in the fetch manifest. Committed Markdown has trailing whitespace/blank-tail normalisation; fetched originals are retained in the accompanying evidence archive. Some failed/raw HTML response filenames in the fetch manifest exist only in that archive.
- [Fixed-scenario comparison](scenario-comparison.md): same previously agreed illustrative token workload, with the new prices; no new quality ranking or production replay.

Run from the repository root:

```sh
bun docs/finops/2026-09-22/build.ts
bun docs/finops/2026-09-22/scenario.ts
bun docs/finops/2026-09-22/verify.ts
bun run test:local --cwd runtime -- bun test test/scripts/provider-model-pricing-reference.test.ts
```

The executable chart reference now prefers `pricing-2026-09-22.json`, then explicitly labelled September 5 routes, then older dated rules. Unpublished cache tariffs use a labelled ordinary-input fallback. Missing model pricing retains the existing `(unpriced)` behaviour; its numeric sentinel is not evidence of a free model. The resolver still provides **base-tier estimates only**; exact long-context, service-tier, geography, promotions and peak-time billing require request-level selection from the detailed catalogue. Retired native Anthropic rows are marked historical tariffs, not current availability.

## Validation

- Snapshot verifier: 609 routes, 195 variants, unique IDs, source digests, cache fallbacks, official aliases and route-specific conditions pass.
- Pricing/token-chart tests: **14 passed, 0 failed, 52 assertions**, run through the isolated local launcher.
- Full `bun run typecheck`: passed all four configured targets.
- Changed TypeScript files: Oxlint with `--deny-warnings` passed. `git diff --check` passed.
- Full `make lint`: **20 existing errors in 16 untouched files** (family-memory/skill provenance, recovery/orchestrator, tool-output and existing tests). Those files are byte-unchanged from base `1bf29bdd6`; no unrelated fixes are included. Full CI cleanliness is therefore not claimed.
- Independent delegated review timed out without findings; the final parser review and checks were performed directly.

Historical September 5 reports remain unchanged. This work does not alter configured providers/defaults, enable models, reprice historical ledger records, install a new runtime or restart services.
