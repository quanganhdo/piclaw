@shared @implemented @browser-verified @pins @queue
Feature: Pins and accepted queue input remain responsive under contention
  # Browser mapping: runtime/test/web/picker-pin-sync.playwright.optional.test.ts
  # Queue UI: runtime/test/web/queue-visibility.playwright.optional.test.ts
  # Admission: runtime/test/db/sqlite-async-admission.test.ts
  # Binding: runtime/test/channels/web/queued-admission-binding.test.ts

  @ux-pin-input-001
  Scenario: Contended pin writes do not synchronously stall unrelated input
    Given a separate writer owns the disposable WAL database
    When a pin update arrives
    Then pin storage returns an explicit retryable response without waiting synchronously
    And retries retain the same desired state and one bounded deadline
    And denied or ambiguous writes are not automatically retried

  @ux-pin-input-002
  Scenario: Queued admission waits asynchronously for durable commit
    Given the agent is busy and queue storage is contended
    When a user submits a queued follow-up
    Then queued state is committed atomically before HTTP acknowledgement or SSE delivery
    And cancellation or changed authority prevents commit
    And the event loop remains responsive while retrying
    And a turn that becomes idle during admission is woken after commit

  @ux-pin-input-003
  Scenario: Visual queue reconciles acknowledgement without SSE
    Given a Visual session has temporarily lost queue SSE delivery
    When the server acknowledges a queued submission
    Then the queue is refreshed from authoritative server state
    And a held older response cannot restore a consumed or removed row
    And queue actions stay bound to the captured session
