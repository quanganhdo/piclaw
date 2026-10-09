@shared @implemented @browser-verified @queue @storage
Feature: Ordinary idle inputs wait without stalling the web event loop
  # Browser mapping: runtime/test/web/submission-ack.playwright.optional.test.ts
  # Atomic storage: runtime/test/channels/web/messaging/idle-message-admission.test.ts
  # Routing: runtime/test/channels/web/messaging/idle-message-routing.test.ts
  # Postcommit: runtime/test/channels/web/messaging/idle-message-postcommit.test.ts
  # Disk binding: runtime/test/channels/web/messaging/idle-message-admission-disk.test.ts

  @ux-idle-admission-001
  Scenario: An ordinary message waits asynchronously for durable storage
    Given a separate writer holds the disposable WAL database
    When a single-user web input arrives while its chat is idle
    Then unrelated requests and timers remain responsive
    And the message and media are committed atomically before acknowledgement
    And cancellation or authority changes before commit leave no message

  @ux-idle-admission-002
  Scenario: Busy routing creates one deferred intent instead of duplicate message rows
    Given an input began while its chat was idle
    When the chat becomes busy before storage admission
    Then the transaction stores one negative deferred intent and no original message
    And materialisation creates one message and consumes the intent once
    And a chat becoming idle after commit is woken without starting competing runs

  @ux-idle-admission-003
  Scenario: Optional publication failure cannot reject a committed input
    Given a message has committed
    When preview or recording publication fails or the request aborts late
    Then the authoritative acknowledgement still identifies the stored row
    And execution is scheduled once
    And admission is not retried
