@shared @implemented @browser-verified @settings @settings-placement
Feature: Focused core Settings placement
  Authentication and Sessions retain their existing names and section identifiers.
  Complex sections remain separate in a flat navigation list.

  # Unit mapping: runtime/test/web/settings-placement.test.ts
  # Browser mapping: runtime/test/web/settings-placement-shell.playwright.optional.test.ts
  # Uses shipped Classic and Visual bundles with disposable intercepted APIs.

  @ux-settings-placement-001
  Scenario Outline: Find authentication and API access together and recovery in Sessions
    Given the <skin> Settings surface is open
    When I open General
    Then identity and upload controls remain available
    And General has no TOTP, widget-token or recovery controls
    When I open Authentication
    Then the instance TOTP status and configured setup details appear alongside passkeys
    And TOTP changes use the existing enrolment confirmation flow
    And the same Authentication page contains the API access subsection
    And no separate API access navigation entry appears
    And old API access links and saved selections resolve to Authentication
    Then I can reveal, copy and regenerate the widget token
    And cancelling regeneration sends no request
    And a rejected request shows an error without reporting success
    When I open Sessions
    Then recovery enablement, maximum attempts and time budget are available
    And changes use the existing general settings endpoint and field names
    And returning to the section shows the saved values

    Examples:
      | skin    |
      | Classic |
      | Visual  |

  @ux-settings-placement-002
  Scenario: Preserve security and narrow-screen usability
    Given Settings is open at desktop or phone width
    Then the moved forms fit their available content width
    And Appearance immediately follows General in the navigation
    And Tools immediately follows Models in the navigation
    And Keychain immediately follows Environment in the navigation
    And Classic Quick Actions immediately follows Keyboard in the navigation
    And passkey management retains its reauthentication and last-factor protections
    And Keychain and provider authentication remain separate from Authentication
