# Agent quota and model controls

Agents can inspect provider quota with `provider_quota` and set their model and thinking effort with `set_model`. Both tools are active in the default tool baseline, including after reset. Existing `switch_model`, `switch_thinking`, `get_model_state`, `list_models` and `/quota` remain available.

## Quota

```json
{}
```

Reads the current model provider's credential-bound cached quota. To select another provider and request the shared usage warmer:

```json
{"provider":"github-copilot","refresh":true}
```

Adapters currently cover `openai-codex`, `github-copilot`, `openrouter` and `zai`. Other provider IDs return an explicit unsupported result and the supported list. A provider without a quota API does not acquire an invented balance.

Text and structured details include reported window percentages, duration/reset timestamps, plan, credits and OpenRouter key USD usage/limits, source, observation time, availability and stale state. Unknown values remain unknown; zero remains zero. No key cap does not mean unlimited account credits. OpenRouter's reset policy is distinct from a window reset timestamp. Local budget caps and quota retrieval are separate; quota inspection grants no spending permission.

The default operation does not call the quota endpoint, but credential verification can consult or refresh runtime-owned authentication. `refresh:true` requests the existing warmer; fresh cache or an in-flight request can be reused. It does not force a new network request. Cache/authentication and refresh waits are bounded to five seconds each. Cancellation or timeout stops waiting but cannot terminate the shared underlying operation. Cache data is re-verified against the current credential after warming; unverified data is not returned. Data older than 60 seconds, invalid fetch timestamps and failed refreshes are marked stale. Raw authentication exceptions and credential identities are not returned or logged.

Missing credentials or failed requests from existing adapters can yield no data without enough information to distinguish authentication from transport failure. The tool reports that uncertainty; adapters returning explicit availability preserve it.

## Model and thinking effort

```json
{"thinking_level":"high"}
```

```json
{"model":"provider/modelId","thinking_level":"medium"}
```

Omit either field to keep it; omit both to read the current state and valid thinking choices. `list_models` also reports each model's supported thinking levels in its text and structured details.

The tool resolves the selected model, respects enabled-model scoping, and validates the requested effort before changing session settings. Missing/ambiguous model IDs, unsupported thinking levels, failed catalogue refresh and missing model authentication leave thinking unchanged. Thinking-only calls do not refresh the catalogue. Native `max` and legacy `xhigh`-as-`max` aliases follow the existing metadata helpers. A model-only change can clamp the retained effort; the result reports the applied level. Model/effort changes use Pi's session APIs and do not modify provider credentials or startup defaults.

## Qualification

Use the isolated local launcher for quota, model-control, activation, capability and built-in catalogue tests. Quota tests inject mock dependencies; no live account endpoint or hardware workload is required. The complete gate and source review are required before publication. Installation and restart need separate approval.
