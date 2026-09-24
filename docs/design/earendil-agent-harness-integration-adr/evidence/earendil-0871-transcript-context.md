# Earendil 0.87.1 transcript context compatibility (#1377)

Piclaw's Azure Responses provider and direct remote-compaction request now resolve tools from transcript state. Earendil 0.87.1 supplies branded `TranscriptContext`, `normalizeContext()` and `getCurrentTools(messages)`; the six package pins stay at 0.85.1 in this slice.

## Provider and compaction paths

- Production and experimental Azure Responses paths use the current tool set for request counts, schemas and tool-dependent reasoning. The resolver first folds any legacy `Context.tools` into a branded transcript with the public normaliser, then replays tools with 0.87.1's public helper when installed. Under pinned 0.85.1 it starts with `Context.tools`, then applies any system-message additions and removals. Disabled tools stay disabled under `AOAI_DISABLE_TOOLS`.
- Remote compaction uses the published normaliser to create a provider transcript under 0.87.1, derives request-level tools from that transcript and omits its system message from converted input. The configured system prompt remains in the direct compact request's `instructions` field. Under 0.85.1, conversion keeps the existing `deferredTools` option; 0.87.1 deleted that option.
- Azure harness and Bedrock smoke calls use the same normaliser before calling provider streams. Neither script was run against a live provider.
- The same-turn activation test now checks resolved tool declarations and the successful extension-tool call. It does not rely on `ToolResultMessage.addedToolNames` or `Context.tools` as the evidence of availability.

## Local evidence and limits

Synthetic Azure payload tests cover initial, added and removed tools; remote-compaction tests cover request-level tools and separate system instructions. The pinned-runtime focused matrix and typechecks exercise the 0.85.1 fallback. A disposable install of published `@earendil-works/pi-coding-agent@0.87.1` typechecks the branded `TranscriptContext` assignment and executes the transcript normaliser/tool replay without changing Piclaw's pins. There were no live Azure, Bedrock, Harness or Pico3 calls.

The 0.87.0 candidate manifest remains a historical result. The coordinated upgrade and its snapshot-based rollback policy belong to #1381 and #1382.
