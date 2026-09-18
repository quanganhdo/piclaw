# Published Earendil 0.85.1 admission evidence

The published coding-agent root imports successfully without pi-server under real Node 22.19.0 (the declared minimum), Node 26.7.0 and Bun 1.4.1. This admits the supported package surface for further migration testing. Production pins remain exact 0.84.4; neither AgentHarness nor pi-server is activated.

## Coordinates and method

- Piclaw baseline: `ad922bdaac40b3a5119aa3017a10ee63897e318b`.
- Candidate release: `0.85.1`, npm gitHead `d981de1229ef899957bbe968bc8dcda02a21f477`.
- Installed family: pi-ai, pi-agent-core, pi-coding-agent, pi-tui, pi-telemetry and chord, all `0.85.1`.
- Consumer declared only `@earendil-works/pi-coding-agent: 0.85.1`; a clean-environment `bun install --ignore-scripts` resolved its published closure. No direct dependency workaround was added.
- Direct pi-ai, pi-agent-core and pi-coding-agent tarballs for both versions were checked against registry SHA-512 integrity. Publication metadata and receipts are summarised in [earendil-0851-admission.json](earendil-0851-admission.json). Installed package manifests omit gitHead; the checker reports that absence rather than pretending to verify a revision from those manifests.
- The real Linux x64 Node binaries were downloaded from nodejs.org and checked against that release's SHA-256 list. The host's `node` alias is a Bun wrapper and was not used as Node evidence.

The checker runs `createAgentSession`, `createAgentSessionRuntime` and `ModelRuntime` export-type assertions in separate bounded child processes; its probe code does not call these factories or create an agent. Child environments contain an explicit non-secret allowlist, isolated home/cache/config/temp paths, `PI_OFFLINE=1` and `PI_TELEMETRY=0`.

The supplied runtime binaries and integrity-checked packages are trusted inputs to this probe. Runtime-reported identity catches accidental Bun-as-Node aliases; it does not authenticate a malicious executable. Offline flags are not an OS network sandbox, and the receipt reports factory-call count rather than claiming packet-level proof of no network traffic. No paid-provider request is part of the probe.

```sh
bun scripts/check-earendil-package-admission.ts \
  --consumer-root /path/to/fresh-consumer \
  --version 0.85.1 \
  --git-head d981de1229ef899957bbe968bc8dcda02a21f477 \
  --node /path/to/node-v22.19.0/bin/node \
  --node /path/to/node-v26.7.0/bin/node \
  --bun /path/to/bun
```

This command inspects an already installed consumer and performs no installation. It verifies runtime identity, coherent installed versions, root export targets, absence of pi-server throughout the dependency tree and rejection of source-only subpaths.

## Corrected package gate

0.85.0's published SDK closure was broken by the experimental server/client surface. The previous requirement that pi-server become transitive prescribed one possible fix. In 0.85.1 upstream removed the experimental surface from the published root and excluded its built client/plugin code. `./client` and `./experimental/plugin` retain source-only export conditions; they are not admitted as runtime SDK exports. Both ordinary Node and Bun imports reject those subpaths.

Upstream #9170 and #9172 closed unmerged. Their literal merger is not a release-admission requirement. The gate is a working supported published closure, verified by fresh consumers, without consumer-side workarounds. Historical 0.85.0 rejection and 0.84 Harness fingerprints/negative results remain evidence of their original versions.

`watchSession()` remains `Promise<never>`/`SliceNotImplemented` at this release. Passing root imports does not grant permission to use it, import Harness into production, add activation flags, or start pi-server. Lane-only Harness scope requires a separate approved ADR.

## Corrected catalogue comparison

The script now identifies entries by provider → API → model ID and ignores manifest metadata. Structural object comparisons ignore key order; arrays retain order. Unambiguous API moves are reported separately while remaining in the gross added/removed counts. Multiple possible route pairings are not guessed.

| Measurement | 0.84.4 → 0.85.1 |
|---|---:|
| Provider/API/model entries | 1,290 → 1,354 |
| Added / removed / changed entries | 107 / 43 / 71 |
| Unambiguous API moves | 15 |
| OpenRouter Anthropic API moves | 14 |
| GitHub Copilot API moves | 1 (`claude-fable-5`) |
| Entries changing cost | 39 |
| Entries changing maxTokens | 28 |
| Entries changing thinkingLevelMap | 20 |
| Entries changing contextWindow | 14 |

Field counts overlap. These are catalogue entries, not unique products or live availability. Eleven Astra provider/API entries appear in the candidate. No selected model is changed and no provider availability call was made.

```sh
bun scripts/audit-model-catalog-delta.ts \
  --base /path/to/0.84.4/package/dist/providers/data \
  --head /path/to/0.85.1/package/dist/providers/data \
  --json /path/to/delta.json --markdown /path/to/delta.md
```

## Remaining admission gates

PR B must migrate ExecutionEnv, six-argument tools and all corresponding fakes/fixtures atomically, run positive real-constructor Harness and Memory/JSONL conformance while enforcing non-reachability, and preserve Piclaw's runtime/cache/persistence/watchdog contracts. Full runtime, provider, MCP, add-on, packed-artifact, portable and authorised disposable canary/rollback validation are separate from this package-root probe. SQLite/Bun support must be evaluated separately. No merge, deployment, restart or production-data migration follows from this evidence.
