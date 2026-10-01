# Earendil 0.99.1 current-loop core candidate (#1445)

Piclaw's isolated #1445 candidate pins `pi-agent-core`, `pi-ai` and `pi-coding-agent` to exact **0.99.1**. The lock resolves the admitted eight-package closure from #1443. `pi-mcp-adapter` remains pinned and is still the sole MCP owner; native MCP/codemode/tool-search factories are public but not wired into Piclaw sessions.

This is a source candidate only. It does not install, restart, call a provider, authenticate an account, enable Harness/Pico3 or approve any new model.

## Integration change

The exact package typecheck exposed one required public API adaptation. `RefreshModelsContext.stored.models` can now contain chat, image and classifier models. Piclaw's GitHub Copilot dynamic overlay is chat-only, so it now narrows cached entries with public `isModelType(model, "chat")` before returning `Model<Api>[]`. No cast or private model field is used.

Existing runtime seams remain intact:

- SDK resources still load through `DefaultResourceLoader` and `createAgentSessionFromServices`;
- Piclaw's built-in extension list still includes `createMcpAdapter({ initializeOnLoad:false })` and does not include upstream MCP/codemode/tool-search factories;
- tool activation/preparation, transcript normalization, session resume/fork, orphan repair, compaction and `user_bash` fail-closed behavior stay under their existing Piclaw tests;
- EF-S01/02/05/07/08 and `AgentProjectionSink` remain Piclaw-owned;
- the compatibility manifest remains a frozen 0.87.1 Harness evidence baseline, Harness latent-only, and Pico3 production import/activation false. Existing public Harness/repository behavior suites necessarily execute against the installed 0.99.1 package after this pin change and are relabelled as preliminary 0.99.1 evidence. #1452 owns the full exact-target capability catalogue, fingerprints and streaming-fork assessment.

## Provider/auth handoff

The 0.99.1 catalog contains `gpt-6.1-sol` for OpenAI, Azure OpenAI Responses and OpenAI Codex only. Each is a reasoning-capable chat model with text/image input, 272,000 context and 128,000 max output. OpenAI Codex changes its default upstream, but Piclaw does not automatically activate or approve a model from this package change.

The packed `pi-ai` artifact contains `dist/auth/oauth/openai-chatgpt.js`; `@earendil-works/pi-ai/bun-oauth` imports it and `registerBunOAuthFlows()` completes offline. This proves packaging, not provider login. AUTH-01–08 interaction, credential, refresh/logout, isolation and live-canary evidence remain #1458.

## Validation

Focused integration tests cover agent-control provider definitions, login handlers, ambient/model auth, provider bootstrap, GitHub Copilot dynamic models, model execution, adapter ownership, live tool activation, loadout preparation, context normalization, orphan-tool repair and compaction boundaries. The exact-release contract separately asserts package/lock closure, GPT-6.1 Sol provider placement, OAuth file resolution and disabled native MCP/Harness/Pico3 activation.

Final full CI and any additional compatibility fixes are recorded on the PR. No production session-format downgrade is implied: rollback after later deployment must use the coordinated pre-upgrade session/state snapshot defined by the epic/canary plan.
