@shared @implemented @browser-verified @images
Feature: Thumbnail previews remain visible in narrow windows
  # Browser mapping: runtime/test/web/image-lightbox.playwright.optional.test.ts
  # Shipped entrypoints: runtime/test/web/image-lightbox-shell.playwright.optional.test.ts

  @ux-image-lightbox-001
  Scenario: A clipped message pane cannot constrain the image preview
    Given a thumbnail or image attachment button inside a narrow clipped message pane
    When I open its image preview
    Then the preview backdrop covers the viewport outside the message pane
    And the image and close control stay inside the window after resizing
    And Escape and backdrop dismissal close the preview and release scroll locking

  @ux-image-lightbox-002
  Scenario: Shipped narrow-window thumbnail clicks show the preview
    Given either UI is open in a narrow window
    When I click a timeline image thumbnail
    Then a visible image preview fills the viewport
    And it remains usable after the window becomes narrower
