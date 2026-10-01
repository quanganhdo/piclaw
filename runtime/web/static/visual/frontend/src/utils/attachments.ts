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
  workspaceFiles: string[];
}

/**
 * Parse a user message content string into clean text and structured attachment metadata.
 * Attachment lines have the form: `attachment:<id> (<filename>)` (optionally prefixed with `-` or `*`).
 */
export function parseUserContent(content: string): ParsedUserContent {
  const workspaceFiles: string[] = [];
  const withoutFiles = content.replace(/(?:^|\n)Files:[ \t]*\n((?:[ \t]*- [^\n]+\n?)+)/g, (block, entries: string) => {
    const paths = entries.split('\n').filter(line => line.trim()).map(line => line.replace(/^[ \t]*- /, '').trim());
    if (paths.some(path => !path || path.startsWith('/') || path.includes('\\') || path.split('/').some(part => part === '..') || /^[a-z][a-z0-9+.-]*:/i.test(path))) return block;
    workspaceFiles.push(...paths);
    return '\n';
  });
  const lines = withoutFiles.split(/\r?\n/);
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

  return { cleanedContent, attachments, workspaceFiles };
}
