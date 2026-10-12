# Consistent compose steering and starting-turn input

Ctrl/Cmd+Enter now requests steering in both skins, Enter submits or queues behind active work, and Shift+Enter inserts a newline. Draft acknowledgement protection from the earlier queue-only proposal is retained. This qualification supersedes that shortcut proposal following Rui's clarification that the lost correction was submitted during “Starting turn”.

## Starting-turn handling

The processing lane is reserved before its callback runs; an agent run also holds eviction protection before the SDK marks it streaming. Web admission now recognises both states. A nonpersistent correction arriving before a stream can accept it is admitted as a durable follow-up, without an ordinary message row that the current turn's cursor could consume. The same guarded fallback handles streaming ending during delivery and activity appearing while admission waits.

Streaming steering continues through the existing SDK path. Fallback acknowledgement says “Follow-up queued”; successful injection says “Steering queued for the current turn”. The fallback waits for the next turn and does not claim to modify a prompt already being hydrated. Media IDs, content blocks, link previews and valid screen hints are retained. Queue storage and existing identity/ownership checks remain authoritative.

## Qualification

Frozen head `8497095ff42f4de8b30005ecad164083b0f7f7e5`, tree `13647467c45cb8e0d570d7f5153c8568b7a63c9e`, runtime tree `daeafb0857dc49f49bc46ffb45eb84fafa8951e0`.

| Check | Result |
| --- | --- |
| Complete runtime suite | 6,725 passed / 74 skipped / 0 failed; 43,656 assertions; 969 files; 659.22s |
| Focused UI, queue, admission and family boundaries | 122 passed / 590 assertions; 10 files |
| Shipped Classic/Visual Chromium/WebKit | 4 passed / 128 assertions |
| Settings/pane contracts | 25 passed / 253 assertions |
| Web build | 9 passed / 26 assertions |
| Types, scoped lint and static policy checks | Passed; 94 unchanged transitive frontend diagnostics |
| Explicit 6.1 follow-up source review | Scoped CLEAR after payload and fixture corrections; no reviewer tests |

Complete gate ran 9 October 2026 22:57:06–23:08:15 UTC with clean unchanged source. Wrapper log SHA-256 `af7457c39f7f8ca9860278b57c10171353e229e1d44163282c502977fbfdbfba`. Private exact-source canonical `ci-fast` receipt `95553ca2-2be2-4a77-93a0-fd6fdf3217aa` passed; aggregate 6,759 passed / 74 skipped / 0 failed across three summaries. Raw log hash `6f3f7deb4e620955a71a2dfd733215b2d7216ba28a40e406aad2eee6ab3ffbd7`. Other receipt capabilities are not-run; browser evidence is separate.

## Regression evidence and corrections

Real AgentQueue and database fixtures cover next-tick startup, protected active-but-not-streaming work, activity beginning during admission, idle-after-commit wake, stream-ended fallback, successful live steering and attachment/structured payload preservation. Assertions require deferred inputs to remain outside ordinary message storage. AgentPool tests verify protected startup is active and returns idle after completion. Family and queued-authority tests remain passing.

Browsers assert explicit steering mode during busy and stale-idle UI state, Ctrl/Cmd shortcuts, Shift+Enter newline, handled/repeated events, delayed acknowledgement with a newer draft, malformed/empty/rejected acknowledgements, acknowledgement notices and existing response/event deduplication.

Review caught missing metadata on the stream-ended fallback and an incorrectly wired storage fixture. Both were fixed; the fixture now calls the actual channel-aware storage APIs and guarded queue admission. Initial fixture import, media signature and invalid screen-hint failures are retained under `/workspace/exports/compose-steering-*`. No deadlines or assertions were relaxed. The earlier queue-only source and receipts remain historical evidence, not qualification for this amendment.

Publication changes after the frozen gate are documentation/receipts only with runtime parity verified. No live prompt, provider, production configuration, installation or restart change. Merge requires separate approval.
