# Helper consolidation and retirement (#1669)

The cleanup removes 452 production/policy source lines net. It does not claim a bundle-size saving for unreachable code.

| Source | Change | Retained behaviour |
|---|---|---|
| Classic and Visual `scroll-anchor.ts` | One implementation in `runtime/web/shared/scroll-anchor.ts`; old paths re-export it | Original algorithm body, public names/types, native anchoring gate, reverse-column corrections, user-scroll cancellation and observer/listener disposal |
| `agent-memory/refresh.ts` | Remove uncalled `_curateMemoryCandidates` chain and `_readOptionalText` | Live tokenizer, stop words, transcript search, typed-memory refresh and daily-note handling |
| `agent-pool/branch-seeding.ts` | Remove uncalled `clearDeferredBranchSeed` wrapper | Deferred/claimed seed recovery, restoration and finalisation; pruning still preserves the seed |
| `extensions/chat-tool-runtime.ts` | Remove unused `__chatToolRuntimeInternals` export object | Internally used diagnostic/relay helpers and direct-chat relay |
| `panes/examples/markdown-preview-pane.ts` | Delete unregistered example | Active workspace Markdown preview registrations and rendering |
| Visual `utils/formatBytes.ts` | Redirect its three consumers to `utils/format.ts`, then delete the shim | Same formatter and output |
| Unused-export policy | Delete only the two corresponding exemptions | Existing unrelated exemptions and checks |

The tracked Core consumer audit includes packaged extensions, the private engine, scripts, tests and ignored tracked files. Supported add-ons were checked at `8150ca59edb44d30d6a07557433f30612f71adc0`; none imports the retired symbols or UI paths. Arbitrary imports of private source files are outside the supported add-on contract.

Regression coverage checks both facade identities, shared listeners, exact expand/collapse cycles, width changes, genuine user-scroll cancellation and disposal. Disposable Chromium and WebKit fixtures exercise the JavaScript anchoring path through both UI imports. Memory, seed replay, relay, formatter and active workspace-preview fixtures preserve the retained behaviour. Both production frontend entrypoints build from source.

No recovery/migration lifecycle, active pane, database, credential or persisted state is removed. Source cleanup does not authorise installation or restart. Delayed idle auto-compaction scheduling remains a separate follow-up and is unchanged.
