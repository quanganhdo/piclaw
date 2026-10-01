# Earendil 0.99.1 MCP feature parity decision (#1449)

Full native MCP replacement remains **no-go**. Piclaw retains `pi-mcp-adapter@41f10ee5f54e66adb569182de7bb81f0801105d6` as the sole client because exact Earendil 0.99.1 does not preserve prompts, MCP Apps, per-server resource policy or host output bounds through its public extension surface.

## Retained capability owner

The adapter owns:

- prompt discovery, argument schemas, slash invocation and `prompts/get` results;
- paginated resources/templates/read and text/image/binary conversion;
- MCP App/UI resources, sandbox session identity, message/stream handoff and UI-result summaries;
- `structuredContent`, `isError`, resource links and native image blocks;
- configurable byte/line/details output bounds with mode-0600 protected spills;
- per-server tool/resource metadata filtering from #1447.

Adapter PRs #6–#8 add deterministic spill cleanup to runtime shutdown/replacement and enforce hard output ceilings. Whole guard operations are leased to an owner generation, generated directories remain tracked until removal succeeds, and a replacement owner cannot lose its artifacts to a retiring owner. Truncation notices, raw details and non-JSON inputs remain inside configured bounds. The exact merged candidate passed 1,408 Vitest tests, its public build and two plain-Node export tests under Node 26.7.0.

## Default-deny server requests

The Piclaw bridge forces adapter `sampling:false`, `samplingAutoApprove:false` and `elicitation:false` regardless of raw config. A server cannot trigger provider expenditure or user interaction from config alone. Future support requires an explicit Piclaw policy/budget handler with scoped roots; no provider call is made by this evidence.

## Native exact-target blockers

The public `@earendil-works/pi-mcp` client has no typed prompt list/get methods, and the native extension owns inaccessible clients, so raw `request()` from a second client is prohibited. Native resources deliberately filter `ui://`/`profile=mcp-app`, provide no host renderer, and aggregate resource tools at server exposure rather than Piclaw URI policy. Direct text truncation and codemode full-result behavior do not match Piclaw's independent output/detail/spill contract.

Therefore prompts/Apps are not silently deleted, resource policy is not broadened, and native MCP/codemode remain unwired. A later exact upstream public seam or explicit scope decision is required before adapter removal.

## Validation

Synthetic contract tests verify the native declaration/runtime absences, retained adapter prompt/resource/UI/result surfaces, default-deny client capabilities, oversized text/detail bounding, image preservation, mode-0600 spill creation and generation-safe cleanup. Tests use local stdio fixtures only: no external server, credential, provider call, deployment or restart is used.
