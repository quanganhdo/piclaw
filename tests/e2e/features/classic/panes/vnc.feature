@vnc @classic @disposable
Feature: VNC connection manager and framebuffer-only viewer
  # Acceptance specification, not Playwright step bindings.
  # Executable checks: runtime/test/web/vnc-viewer.playwright.optional.test.ts
  # Launch with runtime/scripts/test-vnc-disposable.sh, never a production desktop.

  @ux-vnc-001
  Scenario: Connect to the untouched default disposable desktop
    Given a separate X display and real x11vnc in a private network namespace
    When I open the Classic VNC connection manager
    Then the direct endpoint is localhost on port 5901
    And configured targets and successful history are separate lists
    When I connect without editing that endpoint
    Then the canvas paints the real 1024 by 768 framebuffer
    And no permanent session toolbar is visible
    And remote keyboard input reaches the disposable terminal
    And clipboard text travels to the X cut buffer and back from the X clipboard

  @ux-vnc-002
  Scenario: Reveal local controls without consuming desktop space
    Given the real desktop is connected
    When I hover at the top centre and then over the reveal chevron
    Then temporary session controls appear over the framebuffer
    When I leave the controls with no local focus or open details section
    Then the controls disappear
    When I open Clipboard details
    Then the controls remain open until I dismiss them

  @ux-vnc-003
  Scenario: Use touch and keyboard at narrow viewport widths
    Given a connected desktop at a viewport width of 820 or 390 pixels
    When I tap the top centre including any letterboxing
    Then temporary controls appear
    When I press Control Alt Shift V from the canvas
    Then local controls receive keyboard focus
    When I press Escape
    Then the framebuffer regains focus
    And the connection manager fits the viewport in Classic light theme

  @ux-vnc-004
  Scenario: Preserve the session while browsing successful history
    Given the default target has painted a framebuffer
    When I open Connections and history and then return to the desktop
    Then the same session remains connected
    When I disconnect explicitly and reconnect
    Then history has one deduplicated entry for that target
    And clearing recents preserves a pinned entry
    And no passwords or clipboard text are in browser history storage

  @ux-vnc-005
  Scenario: Respect a configured read-only target
    Given I connect to the configured read-only fixture
    Then Send to remote is disabled
    And canvas keyboard and pointer actions send no input messages
    When I dispose the pane
    Then its DOM and socket lifecycle are released

  @ux-vnc-006
  Scenario: Recover from authentication failure without recording a false success
    Given the disposable password-protected target is running on port 5902
    When I connect using a wrong password
    Then a password retry is offered
    And no successful history entry exists
    When I retry with the disposable test password
    Then the first painted frame records a success without persisting that password

  @ux-vnc-007
  Scenario: Recover from errors and tolerate unavailable history storage
    When a target is unavailable or denied by current backend policy
    Then the viewer offers retry or a return to connections
    And it does not record a successful connection
    When I dispose a pane with a session request pending
    Then a late response cannot recreate it
    When browser history storage is blocked
    Then a real connection still succeeds without persisted history
