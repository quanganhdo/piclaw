@shared @implemented @browser-verified @editor @theme
Feature: Editor colours follow the active theme in every mode
  The editor uses the host palette without a competing vendor colour scheme.
  Plain-text selection remains legible in Markdown live preview.

  # Browser mapping: runtime/test/web/editor-theme.playwright.optional.test.ts
  # Unit mapping: runtime/test/web/editor-theme.test.ts
  # Source and built editor entrypoints; Classic/Visual; Chromium/WebKit.

  @ux-editor-theme-001
  Scenario: One selection layer follows all bundled palettes
    Given an editor is showing live preview, raw Markdown, text, code, Vim, a large document or a saved diff
    When I change the active theme without reopening the editor
    Then the drawn selection uses the shared selection background
    And native editor selection does not paint another background
    And selected prose keeps its foreground with at least 4.5 to 1 contrast
    And authored syntax token colours remain intact
    And raw code uses the code surface while live-preview prose uses the reading surface
    And both sides of a saved diff follow the same theme

  # Browser mappings: runtime/test/web/shared-themes.playwright.optional.test.ts
  # and runtime/test/web/markdown-syntax-theme-shell.playwright.optional.test.ts
  @ux-markdown-syntax-theme-001
  Scenario: Timeline and Markdown preview fences follow live theme changes
    Given highlighted code fences in either skin's timeline and Markdown previews
    When the system colour scheme changes in automatic mode
    Then existing code foregrounds, backgrounds and token colours follow the active palette
    When I select a named theme or import VS Code colours
    Then timeline, workspace preview and editor preview use the same syntax roles
    And Visual highlights fences without a deferred global or a duplicate parser bundle

  @ux-editor-theme-002
  Scenario: Editing states and widgets use semantic theme roles
    Given a themed editor is open
    Then search and reveal matches, active lines, Vim cursors and editor panels use theme roles
    And fenced and inline code, table highlights, callouts and feedback use theme roles
    And editable table cells retain native text selection
    And forced-colour mode uses system highlight colours
    When a theme is imported with separate focus and selection colours
    Then its selection colour does not replace the interface accent
    And the document, selection and dirty state survive the theme change
    When the editor moves to a different host document
    Then it uses that document's theme and retains its content
