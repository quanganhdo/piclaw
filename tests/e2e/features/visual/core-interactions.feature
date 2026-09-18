@canonical @source-reviewed @visual
Feature: Visual additional core interaction surfaces
  These flows are scoped to the Visual client.
  Capability boundaries remain explicit; no cross-port parity is implied.

  Rule: Visual sidebar search
    @ux-extra-006 @visual @search
    Scenario: Search messages with the Visual search panel
      Given the Visual Search panel is open
      When I change the query or current, root or all scope
      Then search is scheduled with the panel's debounce
      And an earlier in-flight search is aborted
      And requests include the scope and supported image or attachment filters
      And the panel displays loading, error or empty-result feedback as applicable

    @ux-extra-007 @visual @search
    Scenario: Activate a Visual search result
      Given a Visual search result has a message identifier
      When I click it or activate it with Enter or Space
      Then the panel dispatches a scroll-to-message event for that identifier
      And it asks the sidebar to close

  Rule: Visual scheduled-task panel
    @ux-extra-008 @visual @scheduled-tasks
    Scenario: Control an existing scheduled task
      Given the Visual Tasks panel has loaded tasks
      When I activate a supported pause, resume or delete action
      Then the action targets that task identifier
      And that task's action controls are disabled while it is busy
      And a completed action request refreshes task state even when the server rejects the mutation
      And a rejected mutation or network exception is logged as a warning
      And a network exception during the mutation does not reach the subsequent refresh call
      And a failure to fetch the task list shows the panel error with Retry

  Rule: Visual scratchpad
    @ux-extra-009 @visual @scratchpad
    Scenario: Submit a scratchpad note without prematurely marking it sent
      Given a scratchpad note contains sendable text
      When I send it to the chat
      Then the panel uses the configured message endpoint
      And it marks the note sent only after a successful response
      And failure leaves it unsent and emits an error status flash

    @ux-extra-010 @visual @scratchpad
    Scenario: Persist scratchpad split sizing
      Given the Visual scratchpad split panes are visible
      When I drag the split divider
      Then the split is constrained to the panel's supported twenty-to-eighty percent range
      And its position is stored in the scratchpad split preference
