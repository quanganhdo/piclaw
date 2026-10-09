@shared @implemented @browser-verified @settings @mcp
Feature: Instance-wide MCP codemode settings
  # Browser mapping: runtime/test/web/mcp-settings.playwright.optional.test.ts
  # Backend mapping: runtime/test/channels/web/mcp-settings.test.ts
  # Lifecycle mapping: runtime/test/agent-pool/mcp-codemode-runtime.test.ts
  # Actual Pi pipeline: runtime/test/agent-pool/mcp-codemode-settings.test.ts

  @ux-mcp-codemode-001
  Scenario: Owner applies adapter codemode with explicit interruption acknowledgement
    Given the owner opens MCP Settings in Classic or Visual
    When the owner previews adapter codemode On and acknowledges turn interruption
    And applies codemode
    Then the policy is saved and applied to current and new sessions
    And chats and history are retained without replacing the MCP owner

  @ux-mcp-codemode-002
  Scenario: Unsupported native selection is rejected without fallback
    Given native MCP lifecycle and capability contracts are not qualified
    When the owner previews native MCP
    Then the pane lists fixed compatibility blockers
    And Apply remains unavailable
    And the backend rejects native Apply without changing the adapter policy

  @ux-mcp-codemode-003
  Scenario: Failed or conflicting application is never reported as successful
    Given an owner preview with an opaque revision
    When authority is revoked or configuration changes or activation fails
    Then no successful application is reported
    And a failed fenced transition blocks new operations without claiming rollback
