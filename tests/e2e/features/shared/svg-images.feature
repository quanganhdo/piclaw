@shared @implemented @browser-verified @svg @security @accessibility @issue-1325
Feature: Render bounded model-generated SVG as an image within a message
  This shared contract is implemented by #1325 and exercised in Chromium and WebKit.
  The same fixtures run against the actual Classic and Visual renderers and copy handlers.
  A data-URL image displays SVG without inserting model-controlled SVG into the page DOM.

  Background:
    Given the acceptance fixture runs every case in both Classic and Visual
    And it observes script execution, navigation, external requests and focus changes
    And the host DOM contains a fixture-only sentinel with a known initial value
    And SVG is limited to 262144 UTF-8 bytes, 2048 XML nodes and 32 element levels

  @ux-original-029
  Scenario: Render a safe SVG fence as an inert image
    Given an assistant message contains a complete top-level fenced "svg" block with safe vector geometry below all limits
    When the timeline renders the message
    Then a sanitised SVG data-URL image displays the geometry within the message width
    And no model-controlled SVG elements are inserted into the page DOM
    And the original SVG source remains available through the code-copy action
    And the image has a nonempty accessible name
    And the message causes no script execution, navigation or external resource request

  @ux-svg-001
  Scenario Outline: Do not expand the SVG feature into other content paths
    Given a message contains SVG as <input>
    When the timeline processes the message
    Then this feature does not convert that input into a diagram
    And raw unfenced SVG and HTML remain escaped
    And uploaded attachments stay on the existing attachment path, outside the fenced-SVG renderer

    Examples:
      | input                     |
      | raw unfenced markup       |
      | a code fence labelled xml |
      | an uploaded attachment    |

  @ux-svg-002
  Scenario Outline: Remove or reject active and externally referencing content
    Given an SVG fence contains <hazard> on its root or descendants where applicable
    When the renderer processes the fence
    Then it removes that content before image creation or rejects the complete document
    And rejected input remains visible as inert original source
    And no model content executes code, changes location or triggers external resource loads
    And the host-DOM sentinel is unchanged and no sentinel value reaches the SVG payload or external requests
    And no partially sanitised markup is inserted into the page

    Examples:
      | hazard                                      |
      | script elements                             |
      | event-handler attributes                    |
      | foreignObject or embedded HTML              |
      | external image or use references             |
      | unsafe or obfuscated href and xlink:href     |
      | style elements or style attributes           |
      | presentation attributes with external URLs   |
      | entity declarations or external identifiers |
      | animation that changes a URI attribute      |

  @ux-svg-003
  Scenario Outline: Enforce a finite resource boundary before publishing an image
    Given otherwise safe SVG fixtures just below, exactly at and above the documented <limit>
    When the renderer processes each fixture
    Then fixtures within all limits remain eligible for sanitised image rendering
    And the over-limit fixture is rejected before image publication and remains inert original source
    And it publishes no partial image or trusted markup
    # Parser/sanitizer unit tests must enforce byte rejection before parsing and
    # stop structural validation at the first over-limit node; see shared/README.md.

    Examples:
      | limit         |
      | byte limit    |
      | node limit    |
      | nesting limit |

  @ux-svg-004
  Scenario Outline: Preserve source when a diagram cannot be rendered
    Given an SVG fence is <condition>
    When the renderer processes it
    Then the original source remains readable in an inert code block
    And its code-copy action copies the original source
    And an error placeholder never replaces the only readable copy of the source
    And no image or model-controlled SVG DOM is published

    Examples:
      | condition                |
      | malformed XML            |
      | an incomplete fence      |
      | rejected for a disallowed element in the documented SVG subset |
      | rejected by sanitisation |

  @ux-svg-005
  Scenario: Keep diagram labels and layout accessible
    Given safe SVG examples with and without a useful title or description
    When each image renders at desktop and narrow mobile message widths
    Then its accessible name uses sanitised title or description text when nonempty
    And otherwise its accessible name is "Model-generated SVG"
    And the label never contains executable markup
    And the image stays within the message width without distorting its aspect ratio
    And rendering does not move keyboard focus or trap navigation

  @ux-svg-006
  Scenario: Copy original source after successful sanitisation
    Given a fence contains safe geometry and removable unsafe attributes
    And sanitisation permits a resulting image
    When I activate its source-copy action using the keyboard
    Then the clipboard receives the original fence body rather than sanitised or highlighted output
    And copy success or failure is reported through the existing copy control
    And the original source is never executed while copying

  @ux-svg-007
  Scenario: Reconcile streamed and reloaded SVG without duplicates
    Given an assistant SVG fence arrives in several streaming updates
    When an update leaves the fence incomplete
    Then it remains inert source and no partial diagram is published
    When the complete safe fence arrives and the message is later reloaded
    Then the completed fence has one image and one source-copy action
    And repeated rendering does not duplicate images, listeners or controls
