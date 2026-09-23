> ## Documentation Index
> Fetch the complete documentation index at: https://inference-docs.cerebras.ai/llms.txt
> Use this file to discover all available pages before exploring further.

# Model Catalog

> Browse all models available on Cerebras public endpoints.

Models on Cerebras public endpoints are available on the free trial and pay-as-you-go tiers, subject to [rate limits](/support/rate-limits) and [pricing](/support/pricing). For additional model families, reserved capacity, higher throughput, and production SLAs, see [Dedicated Endpoints](/dedicated/overview).

<Tip>
  New here? Follow the [Quickstart](/quickstart) to make your first API call. To pick a model by use case, see the [model selection guide](/models/choose-a-model). Select any model name below for full specs, capabilities, and per-tier limits.
</Tip>

## Available Models

| Model Name                           | Model ID       | Parameters  | Context (free / paid) | Speed (tokens/s) |
| :----------------------------------- | :------------- | :---------- | :-------------------- | :--------------- |
| [OpenAI GPT OSS](/models/openai-oss) | `gpt-oss-120b` | 120 billion | 65k / 131k            | \~3000           |
| [Qwen 3.8 27B](/models/qwen-3.8-27b) | `qwen-3.8-27b` | 27 billion  | 64k / 128k            | \~1850           |

<Tip>
  Looking for more models? Many additional model families are available through [Dedicated Endpoints](/dedicated/overview#supported-models).
</Tip>

## Model Compression

This section provides transparency about the compression state of each model available on our platform.

We host a variety of open-source models from the community. We do not currently host pruned models on our public endpoints. All models served through our public endpoints are the original, unpruned versions.

While we conduct research on pruning techniques like REAP (Router-weighted Expert Activation Pruning), these pruned models are shared with the research community on Hugging Face but are not available through our shared API. You can read more about REAP in our [research blog](https://www.cerebras.ai/blog/reap). **All of our public models are unpruned.**

Cerebras uses selective weight-only quantization only during storage to preserve maximal quality. This means that the weights are stored in partial 16-bit / 8-bit / 4-bit, in-line with industry standards. For quality, sensitive layers are stored at full precision with dequantization on the fly, so operations are done in high precision. The activations, attention, and kv cache remain in full precision and unquantized.

### Frequently Asked Questions

<Accordion title="Will you change a model's architecture without notice?">
  No. We are committed to serving the original models for all existing endpoints, without modification. We do not alter model architectures via pruning on our hosted portfolio. If we explore additional compression techniques (like pruning) in the future, these would be offered as separate endpoints with pruning-specific names, ensuring complete transparency and allowing you to choose which version best fits your needs.
</Accordion>

<Accordion title="Where can I find your REAP pruned models?">
  Our REAP pruned models are available on Hugging Face for research and experimentation purposes: [Cerebras REAP Collection](https://huggingface.co/collections/cerebras/cerebras-reap). These models demonstrate our pruning research but are not served through our production API.
</Accordion>

<Accordion title="What are compression, quantization, and pruning?">
  **Compression** is an umbrella term for techniques that reduce model size or computational requirements. Common compression techniques include:

  * **Quantization**: Reducing the precision of numbers used to represent model weights (e.g., converting from FP16 to FP8). This reduces memory usage without changing the model's architecture.
  * **Pruning**: Permanently removing parts of a model, like layers or experts, to reduce model size. This changes the model's architecture and creates a different model.
</Accordion>
