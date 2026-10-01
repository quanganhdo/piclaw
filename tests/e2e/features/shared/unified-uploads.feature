@shared @implemented @browser-verified @uploads
Feature: Shared upload cap with workspace storage for large chat attachments
  The single-user chat composer and workspace use the same configured file-size limit.

  # Browser mapping: runtime/test/web/unified-uploads.playwright.optional.test.ts
  # Backend mapping: runtime/test/channels/web/workspace-attachment-upload.test.ts
  # Transfer mapping: runtime/web/src/ui/upload-transfers.test.ts

  @ux-unified-uploads-001
  Scenario Outline: Submit mixed small and large attachments
    Given the <skin> chat composer is open on a single-user instance
    When I attach a small file and a file above the 32 MiB database cutoff
    Then the small file is stored as a normal media attachment
    And the large file is sent in bounded 8 MiB chunks
    And the completed large file is stored at a unique path under workspace uploads
    And the submitted message contains its Files reference and the small attachment ID
    And the timeline presents a download link for the large file
    And no large file bytes are written into the media database

    Examples:
      | skin    |
      | Classic |
      | Visual  |

  @ux-unified-uploads-003
  Scenario: One Settings limit reflects the effective server policy
    Given either shipped skin has a configured upload limit of 512 MiB
    Then General contains one upload-limit control for chat and workspace
    When I edit the limit
    Then only the canonical workspace limit is saved
    And the displayed value follows the server acknowledgement including an unchanged environment override
    And values outside 1 to 1024 MiB settle at the effective boundary
    And the saved limit is displayed after reloading Settings

  @ux-unified-uploads-002
  Scenario: Enforce the shared limit and safe completion
    Given the shared upload limit is 512 MiB
    Then a file exactly 512 MiB can finish without multipart overhead crossing the request cap
    And a file larger than that limit is rejected
    And incomplete uploads do not expose a completed file or submit a chat reference
    And existing files are not overwritten
    And unsafe filenames, symlink destinations and concurrent chunks for the same upload are rejected
    And the upload route requires authentication and valid origin checks
    And family accounts cannot use the shared workspace fallback
