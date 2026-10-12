# Ctrl/Cmd+Enter and unconfirmed drafts

**Historical queue-only qualification, superseded by the steering amendment.** Rui clarified on9October2026 at22:32UTC that Ctrl/Cmd+Enter should steer consistently and that the lost input occurred during a starting turn. The new source uses Ctrl/Cmd+Enter steering, Shift+Enter newline, and durable follow-up fallback before a stream exists. The gate below qualifies the earlier queue-only source; a fresh complete gate is required for the amendment. Draft acknowledgement protection is retained.

Ctrl/Cmd+Enter now explicitly requests queue-mode submission in both skins. Visual decodes and validates the acknowledgement before clearing the draft; Classic validates before its response callback and uses existing draft restoration on failure. Malformed or empty acknowledgements and rejected requests leave text available and show an error.

The backend queue/admission rules are unchanged: busy targets defer a follow-up, while an idle target may start the accepted input. This fix does not create an idle-only holding queue or change steering persistence.

## Qualification

Frozen head `7ccbf88fe9b0553d90a478a9977515cfddb268eb`, tree `663ed7fcf8b831989f29a912b0d4f98660eeb8e7`, runtime tree `c054a0c69da7b9e775f49a0baa45e0a4a65e512b`.

| Check | Result |
| --- | --- |
| Complete runtime suite | 6,716 passed / 74 skipped / 0 failed; 43,597 assertions; 968 files; 679.70s |
| Focused compose and queue/routing tests | 55 passed / 209 assertions; 5 files |
| Shipped-entrypoint browser matrix | 4 passed / 120 assertions; Classic/Visual Chromium/WebKit |
| Settings/pane contracts | 25 passed / 253 assertions |
| Web build tests | 9 passed / 26 assertions |
| Types, scoped lint and static policies | Passed; 94 unchanged transitive frontend diagnostics |
| Explicit 6.1 follow-up review | Scoped CLEAR; no reviewer tests |

Full gate ran 9 October 2026 22:12:32–22:24:01 UTC. Head/tree and clean worktree remained unchanged. Wrapper log SHA-256 `ceec4f51a8ea6efef091bf07855db33039c8cf10011970f085dc191dadcfd7c5`. Private exact-source canonical `ci-fast` receipt `7d4ee787-e4a6-4b42-ba5a-c7c1e53fc1a4` passed; aggregate 6,750 passed / 74 skipped / 0 failed across three subprocess summaries. Raw log hash `7268057f01bab2a18594df87004dc393ac2c043d49f6d7620c9cf0f8d7db9c87`. Other receipt capabilities are not-run; browser evidence is separate.

## Regression coverage

Browsers verify Ctrl+Enter during busy and idle status, Cmd+Enter, repeated/previously handled events, a held acknowledgement followed by a newer draft, malformed JSON, empty success payloads, explicit HTTP rejection, queue mode and existing event/ACK deduplication. Focused tests cover modifier/IME guards, positive and rejected acknowledgement shapes, committed relay-source precedence and unchanged atomic queue/routing behaviour.

Two implementation mistakes were caught before qualification: a nonexistent compose-value helper, and calling `preventDefault()` before checking the shortcut's handled-event guard. Failed browser traces are retained under `/workspace/exports/compose-ctrl-enter-*`. Both were corrected and the final rebuilt matrix passed. No deadlines or assertions were weakened. A committed relay-source receipt remains authoritative even when forwarding fails, avoiding an automatic duplicate-source retry.

Publication updates after the frozen gate are docs/receipts only with runtime parity verified. No live prompts, provider requests, production configuration, installation or restart changes. Merge and deployment require separate approval.
