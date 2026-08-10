/**
 * Utility helpers for parsing user message content into structured attachment data.
 */

export interface ParsedAttachment {
  mediaId: number;
  filename: string;
}

export interface ParsedUserContent {
  cleanedContent: string;
  attachments: ParsedAttachment[];
}

export interface PendingMediaAttachment {
  id?: number;
  name: string;
  file?: File;
  isFileRef?: boolean;
}

export interface ResolvedMediaAttachment {
  id: number;
  name: string;
}

/**
 * Resolve compose attachments into stable media ID/name pairs.
 * Upload failures are propagated so callers never silently send without a file.
 */
export async function resolveMediaAttachments(
  attachments: readonly PendingMediaAttachment[],
  upload: (file: File) => Promise<{ id?: number }>,
): Promise<ResolvedMediaAttachment[]> {
  const resolved: ResolvedMediaAttachment[] = [];

  for (const attachment of attachments) {
    if (attachment.isFileRef) continue;

    if (Number.isInteger(attachment.id) && Number(attachment.id) > 0) {
      resolved.push({ id: Number(attachment.id), name: attachment.name });
      continue;
    }

    if (!attachment.file) {
      throw new Error(`Attachment “${attachment.name}” is unavailable. Reattach it and try again.`);
    }

    const result = await upload(attachment.file);
    if (!Number.isInteger(result?.id) || Number(result.id) <= 0) {
      throw new Error(`Upload failed for “${attachment.name}”. Try again.`);
    }
    resolved.push({ id: Number(result.id), name: attachment.name });
  }

  return resolved;
}

/**
 * Parse a user message content string into clean text and structured attachment metadata.
 * Attachment lines have the form: `attachment:<id> (<filename>)` (optionally prefixed with `-` or `*`).
 */
export function parseUserContent(content: string): ParsedUserContent {
  const lines = content.split(/\r?\n/);
  const textLines: string[] = [];
  const attachments: ParsedAttachment[] = [];

  for (const line of lines) {
    const trimmed = line.trim();

    if (/^attachments:\s*$/i.test(trimmed)) {
      continue;
    }

    const normalized = trimmed.replace(/^[-*]\s*/, "");
    const match = normalized.match(/^attachment:(\d+)\s*\(([^)]+)\)\s*$/i);
    if (match) {
      attachments.push({
        mediaId: Number.parseInt(match[1], 10),
        filename: match[2].trim(),
      });
      continue;
    }

    textLines.push(line);
  }

  const cleanedContent = textLines
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();

  return { cleanedContent, attachments };
}
