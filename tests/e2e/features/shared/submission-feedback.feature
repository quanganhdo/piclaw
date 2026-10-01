@shared @implemented @browser-verified @submission @timeline
Feature: Prompt feedback for accepted submissions
  Durable message acknowledgements must not wait for streamed display updates.

  # Browser mapping: runtime/test/web/submission-ack.playwright.optional.test.ts
  # Unit mappings: app-realtime-timeline.test.ts, process-chat-streaming-runtime.test.ts,
  # and channels/web/sse/submission-priority.test.ts.

  @ux-submission-feedback-001
  Scenario Outline: Display an accepted message without waiting for its SSE event
    Given the <skin> timeline is open
    When a submission returns a successful response containing its stored user message
    And delivery of its new-post SSE event is delayed
    Then the acknowledged user message appears in the timeline
    When the event later arrives
    Then the timeline still contains exactly one copy
    And an event arriving before its HTTP response also leaves exactly one copy
    And a rejected submission does not appear as an accepted message

    Examples:
      | skin    |
      | Classic |
      | Visual  |

  @ux-submission-feedback-002
  Scenario: Keep lifecycle feedback independent of display throttling and metadata
    Given the server has started processing an accepted turn
    When model metadata resolution is slow
    Then the server publishes its initial working status before awaiting metadata
    And it does not request provider quota, diagnostics or the full model catalogue for that status
    And new-post and initial working events do not wait behind a pending display-update throttle
    And acknowledgements for other chats or filtered views do not enter the active timeline
