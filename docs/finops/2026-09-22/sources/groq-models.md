[![Groq](/groq-logo.svg)](/home)

[Docs](/docs/overview)[Login](/home)

[Log In](/login)

## Documentation

[Docs](/docs/overview)[API Reference](/docs/api-reference)

Search

## Docs

### Getting Started

[Overview](/docs/overview)[Quickstart](/docs/quickstart)[Models](/docs/models)[OpenAI Compatibility](/docs/openai)[Responses API](/docs/responses-api)[Rate Limits](/docs/rate-limits)[Templates](/docs/examples)[API Reference](/docs/api-reference)

### Core Features

[Text Generation](/docs/text-chat)[Speech to Text](/docs/speech-to-text)[Text to Speech](/docs/text-to-speech)[Orpheus](/docs/text-to-speech/orpheus)[OCR and Image Recognition](/docs/vision)[Reasoning](/docs/reasoning)[Content Moderation](/docs/content-moderation)[Structured Outputs](/docs/structured-outputs)[Prompt Caching](/docs/prompt-caching)

### Tools & Integrations

[Tool Use](/docs/tool-use/overview)[Overview](/docs/tool-use/overview)[Groq Built-In Tools](/docs/tool-use/built-in-tools)[Code Execution](/docs/tool-use/built-in-tools/code-execution)[Browser Search (GPT OSS Models)](/docs/tool-use/built-in-tools/browser-search)[Remote Tools and MCP](/docs/tool-use/remote-mcp)[Connectors](/docs/tool-use/remote-mcp/connectors)[Local Tool Calling](/docs/tool-use/local-tool-calling)[Integrations Catalog](/docs/integrations)[Coding with Groq](/docs/coding-with-groq)[Factory Droid](/docs/coding-with-groq/factory-droid)[OpenCode](/docs/coding-with-groq/opencode)[Kilo Code](/docs/coding-with-groq/kilo-code)[Roo Code](/docs/coding-with-groq/roo-code)[Cline](/docs/coding-with-groq/cline)

### Guides

[Prompting Guide](/docs/prompting)[Basics](/docs/prompting)[Patterns](/docs/prompting/patterns)[Model Migration](/docs/prompting/model-migration)[Assistant Message Prefilling](/docs/prefilling)

### Service Tiers

[Service Tiers](/docs/service-tiers)[Performance Tier](/docs/performance-tier)[Flex Processing](/docs/flex-processing)[Batch Processing](/docs/batch)

### Advanced

[LoRA Inference](/docs/lora)

### Production Readiness

[Production Checklist](/docs/production-readiness/production-ready-checklist)[Optimizing Latency](/docs/production-readiness/optimizing-latency)[Security Onboarding](/docs/production-readiness/security-onboarding)[Prometheus Metrics](/docs/prometheus-metrics)

### Account and Console

[Spend Limits](/docs/spend-limits)[Projects](/docs/projects)[Model Permissions](/docs/model-permissions)[Billing FAQs](/docs/billing-faqs)[Your Data](/docs/your-data)

### Developer Resources

[SDK Libraries](/docs/libraries)[Groq Badge](/docs/badge)[Developer Community](https://community.groq.com)[OpenBench](https://openbench.dev)[Error Codes](/docs/errors)[Changelog](/docs/changelog)

### Legal

[Policies & Notices](/docs/legal)

Search

[Docs](/docs/overview)[API Reference](/docs/api-reference)

# Supported Models

Copy page

Explore all available models on GroqCloud.

## [Featured Models](#featured-models)

[

![OpenAI GPT-OSS 120B icon](/_next/static/media/openailogo.523c87a0.svg)

### OpenAI GPT-OSS 120B

GPT-OSS 120B is OpenAI's flagship open-weight language model with 120 billion parameters, built in browser search and code execution, and reasoning capabilities.

Token Speed

~500 tps

Modalities

Capabilities









](/docs/model/openai/gpt-oss-120b)

## [Production Models](#production-models)

**Note:** Production models are intended for use in your production environments. They meet or exceed our high standards for speed, quality, and reliability. Read more [here](/docs/deprecations).

| MODEL ID | SPEED (T/SEC) | PRICE PER 1M TOKENS | RATE LIMITS (DEVELOPER PLAN) | CONTEXT WINDOW (TOKENS) | MAX COMPLETION TOKENS | MAX FILE SIZE |
| --- | --- | --- | --- | --- | --- | --- |
| Llama 3.1 8BEnterprisellama-3.1-8b-instant | 560 | ContactSales | ContactSales | 131,072 | 131,072 | - |
| Llama 3.3 70BEnterprisellama-3.3-70b-versatile | 280 | ContactSales | ContactSales | 131,072 | 32,768 | - |
| GPT OSS 120Bopenai/gpt-oss-120b | 500 | $0.15 input$0.60 output | 250K TPM1K RPM | 131,072 | 65,536 | - |
| GPT OSS 20Bopenai/gpt-oss-20b | 1000 | $0.075 input$0.30 output | 250K TPM1K RPM | 131,072 | 65,536 | - |
| Whisperwhisper-large-v3 | - | $0.111 per hour | 200K ASH300 RPM | - | - | 100 MB |
| Whisper Large V3 Turbowhisper-large-v3-turbo | - | $0.04 per hour | 400K ASH400 RPM | - | - | 100 MB |

## [Preview Models](#preview-models)

**Note:** Preview models are intended for evaluation purposes only and should not be used in production environments as they may be discontinued at short notice. Read more about deprecations [here](/docs/deprecations).

| MODEL ID | SPEED (T/SEC) | PRICE PER 1M TOKENS | RATE LIMITS (DEVELOPER PLAN) | CONTEXT WINDOW (TOKENS) | MAX COMPLETION TOKENS | MAX FILE SIZE |
| --- | --- | --- | --- | --- | --- | --- |
| Canopy Labs Orpheus Arabic Saudicanopylabs/orpheus-arabic-saudi | - | $40.00 per 1M characters | 50K TPM250 RPM | 4,000 | 50,000 | - |
| Canopy Labs Orpheus V1 Englishcanopylabs/orpheus-v1-english | - | $22.00 per 1M characters | 50K TPM250 RPM | 4,000 | 50,000 | - |
| Llama Prompt Guard 2 22Mmeta-llama/llama-prompt-guard-2-22m | - | $0.03 input$0.03 output | 30K TPM100 RPM | 512 | 512 | - |
| Prompt Guard 2 86Mmeta-llama/llama-prompt-guard-2-86m | - | $0.04 input$0.04 output | 30K TPM100 RPM | 512 | 512 | - |
| MiniMax M2.7Enterpriseminimaxai/minimax-m2.7 | 260 | ContactSales | ContactSales | 196,608 | 131,072 | - |
| Safety GPT OSS 20Bopenai/gpt-oss-safeguard-20b | 1000 | $0.075 input$0.30 output | 150K TPM1K RPM | 131,072 | 65,536 | - |
| Qwen/Qwen3.8-27Bqwen/qwen3.8-27b | 450 | $0.80 input$4.00 output | 250K TPM1K RPM | 131,042 | 16,384 | 20 MB |

## [Deprecated Models](#deprecated-models)

Deprecated models are models that are no longer supported or will no longer be supported in the future. See our deprecation guidelines and deprecated models [here](/docs/deprecations).

## [Get All Available Models](#get-all-available-models)

Hosted models are directly accessible through the GroqCloud Models API endpoint using the model IDs mentioned above. You can use the `https://api.groq.com/openai/v1/models` endpoint to return a JSON list of all active models:

Python

    curl -X GET "https://api.groq.com/openai/v1/models" \
         -H "Authorization: Bearer $GROQ_API_KEY" \
         -H "Content-Type: application/json"

    import Groq from "groq-sdk";

    const groq = new Groq({ apiKey: process.env.GROQ_API_KEY });

    const getModels = async () => {
      return await groq.models.list();
    };

    getModels().then((models) => {
      // console.log(models);
    });

    import requests
    import os

    api_key = os.environ.get("GROQ_API_KEY")
    url = "https://api.groq.com/openai/v1/models"

    headers = {
        "Authorization": f"Bearer {api_key}",
        "Content-Type": "application/json"
    }

    response = requests.get(url, headers=headers)

    print(response.json())

### Was this page helpful?

YesNoSuggest Edits

#### On this page
