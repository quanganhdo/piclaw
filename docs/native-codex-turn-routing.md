# Native Codex turn routing

The native Codex HTTP transport preserves the first successful response's
`x-codex-turn-state` header for later requests in the same logical turn.
This is a server routing hint. It grants no authority to execute or recover work.

## Conversation and turn identity

The SDK's persisted provider session/cache key remains unchanged. Routing state
uses the actual native conversation and the host's admitted operation ID, not
an individual generation task or model invocation ID. Those IDs change between
tool rounds. Foreground Delegate conversations have independent state even when
they share the parent's host operation.

Authentication account and registered provider ownership are captured by the
trusted host. Changing either clears previous state for that conversation.
Changing the physical model, API or endpoint retires that turn's hint. Switching
to a non-Codex profile also retires its turn without changing another concurrent
maintenance turn.

The host removes any caller-supplied routing hint before dispatch. The first
non-empty hint from a successful response wins; subsequent responses cannot
replace it. Source, account and physical-model guards remain in force before
and after transport.

## Retirement and output handling

An active request abort clears its hint. A completed request detaches its abort
listener so a later abort cannot erase a continuing turn's state. Late responses
from closed requests or retired scopes cannot seed routing state.

Terminal host settlement clears the operation's parent and Delegate hints.
Compaction has its own maintenance work ID and one summarizer request; its hint
is cleared when that request finishes, including failed output or settlement.
Hint retirement does not release an uncertain accounting hold.

Application stop/close clears all routing hints. They live only in memory: no
SDK document, database record, recovery receipt or model message stores them.
The output observer still streams concurrently; request completion joins owned
capture and flush work. Routing disposal does not bypass those output guards.

## Verification scope

Regression tests cover first-token forwarding, new turns, Delegate isolation,
authentication/provider/model/endpoint changes, maintenance, cancellation, late
responses, caller-header stripping and diagnostic redaction. A native default-
factory test performs a real tool round, verifies the next model request sends
the first server hint, then admits another user turn and verifies a fresh hint.
It also checks routing tokens are absent from stored entries and documents.

The previous transport fails the continuation regression. Tests use synthetic
responses and isolated workspaces; they do not establish a production cache-hit
improvement. Live before/after validation needs a separately approved install
and restart. Request bodies, Plan context and cache-key behaviour are unchanged.
