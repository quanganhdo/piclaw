import { createHash } from "node:crypto";

const MAX_FILE_BYTES = 512 * 1024;
const MAX_CHUNK_BYTES = 16 * 1024;
const MAX_CHUNKS = 128;
const DECODER = new TextDecoder("utf-8", { fatal: true, ignoreBOM: true });

export const CHUNKER_VERSION = "nr1-md-v1";

export type NoteChunkerExclusionCode =
  | "invalid_utf8_or_nul"
  | "file_too_large"
  | "line_or_fence_too_large"
  | "too_many_chunks";

export class NoteChunkerExclusionError extends Error {
  constructor(readonly code: NoteChunkerExclusionCode) {
    super(code);
    this.name = "NoteChunkerExclusionError";
  }
}

export interface MarkdownChunk {
  chunkId: string;
  firstByte: number;
  afterLastByte: number;
  lineStart: number;
  lineEnd: number;
  headingPath: string[];
  kind: string;
  text: string;
}

export interface ChunkMarkdownResult {
  sourceRevision: string;
  chunks: MarkdownChunk[];
}

interface Line {
  readonly lineNumber: number;
  readonly firstByte: number;
  readonly afterLastByte: number;
  readonly rawText: string;
  readonly contentText: string;
}

interface BlockBase {
  readonly type: "heading" | "fence" | "text" | "blank";
  readonly firstLine: number;
  readonly lastLine: number;
  readonly firstByte: number;
  readonly afterLastByte: number;
  readonly byteLength: number;
}

interface HeadingBlock extends BlockBase {
  readonly type: "heading";
  readonly level: number;
  readonly headingText: string;
}

interface FenceBlock extends BlockBase {
  readonly type: "fence";
}

interface TextBlock extends BlockBase {
  readonly type: "text";
}

interface BlankBlock extends BlockBase {
  readonly type: "blank";
}

type Block = HeadingBlock | FenceBlock | TextBlock | BlankBlock;

interface Section {
  readonly headingPath: string[];
  readonly blocks: readonly Block[];
}

interface Unit {
  readonly rootType: Block["type"];
  readonly firstLine: number;
  readonly lastLine: number;
  readonly firstByte: number;
  readonly afterLastByte: number;
  readonly byteLength: number;
  readonly containsFence: boolean;
}

export function chunkMarkdown(bytes: Uint8Array, namespace: string, relativePath: string): ChunkMarkdownResult {
  if (bytes.byteLength > MAX_FILE_BYTES) throw new NoteChunkerExclusionError("file_too_large");
  if (bytes.includes(0)) throw new NoteChunkerExclusionError("invalid_utf8_or_nul");

  let text: string;
  try {
    text = DECODER.decode(bytes);
  } catch {
    throw new NoteChunkerExclusionError("invalid_utf8_or_nul");
  }

  const sourceRevision = sha256(bytes);
  if (!text.length) return { sourceRevision, chunks: [] };

  const lines = parseLines(text);
  const blocks = parseBlocks(lines);
  const sections = buildSections(blocks);
  const chunks: MarkdownChunk[] = [];

  const pushChunk = (kind: string, firstLine: number, lastLine: number, headingPath: string[]): void => {
    const start = lines[firstLine];
    const end = lines[lastLine];
    const firstByte = start.firstByte;
    const afterLastByte = end.afterLastByte;
    const textSlice = lines.slice(firstLine, lastLine + 1).map(line => line.rawText).join("");
    chunks.push({
      chunkId: chunkIdOf(namespace, relativePath, sourceRevision, firstByte, afterLastByte),
      firstByte,
      afterLastByte,
      lineStart: start.lineNumber,
      lineEnd: end.lineNumber,
      headingPath: [...headingPath],
      kind,
      text: textSlice,
    });
    if (chunks.length > MAX_CHUNKS) throw new NoteChunkerExclusionError("too_many_chunks");
  };

  const splitUnitIntoLineChunks = (unit: Unit, headingPath: string[]): void => {
    if (unit.containsFence) throw new NoteChunkerExclusionError("line_or_fence_too_large");
    let first = unit.firstLine;
    while (first <= unit.lastLine) {
      let last = first;
      while (
        last + 1 <= unit.lastLine
        && lines[last + 1]!.afterLastByte - lines[first]!.firstByte <= MAX_CHUNK_BYTES
      ) {
        last += 1;
      }
      pushChunk("lines", first, last, headingPath);
      first = last + 1;
    }
  };

  const emitUnits = (units: readonly Unit[], headingPath: string[]): void => {
    if (!units.length) return;
    const first = units[0]!;
    const last = units[units.length - 1]!;
    const kind = units.length === 1 && first.rootType === "fence"
      ? "fence"
      : units.every(unit => unit.rootType === "blank")
        ? "lines"
        : "paragraph";
    pushChunk(kind, first.firstLine, last.lastLine, headingPath);
  };

  for (const section of sections) {
    const first = section.blocks[0]!;
    const last = section.blocks[section.blocks.length - 1]!;
    if (last.afterLastByte - first.firstByte <= MAX_CHUNK_BYTES) {
      pushChunk("section", first.firstLine, last.lastLine, section.headingPath);
      continue;
    }

    const units = buildUnits(section.blocks);
    const pending: Unit[] = [];
    let pendingBytes = 0;

    for (const unit of units) {
      if (unit.byteLength > MAX_CHUNK_BYTES) {
        emitUnits(pending, section.headingPath);
        pending.length = 0;
        pendingBytes = 0;
        splitUnitIntoLineChunks(unit, section.headingPath);
        continue;
      }
      if (pendingBytes && pendingBytes + unit.byteLength > MAX_CHUNK_BYTES) {
        emitUnits(pending, section.headingPath);
        pending.length = 0;
        pendingBytes = 0;
      }
      pending.push(unit);
      pendingBytes += unit.byteLength;
    }
    emitUnits(pending, section.headingPath);
  }

  return { sourceRevision, chunks };
}

function parseLines(text: string): Line[] {
  const lines: Line[] = [];
  let start = 0;
  let byteOffset = 0;

  for (let index = 0; index < text.length; index += 1) {
    const code = text[index]!;
    if (code !== "\n") continue;
    const rawText = text.slice(start, index + 1);
    const byteLength = Buffer.byteLength(rawText, "utf8");
    if (byteLength > MAX_CHUNK_BYTES) throw new NoteChunkerExclusionError("line_or_fence_too_large");
    lines.push({
      lineNumber: lines.length + 1,
      firstByte: byteOffset,
      afterLastByte: byteOffset + byteLength,
      rawText,
      contentText: rawText.replace(/\r?\n$/, ""),
    });
    byteOffset += byteLength;
    start = index + 1;
  }

  if (start < text.length) {
    const rawText = text.slice(start);
    const byteLength = Buffer.byteLength(rawText, "utf8");
    if (byteLength > MAX_CHUNK_BYTES) throw new NoteChunkerExclusionError("line_or_fence_too_large");
    lines.push({
      lineNumber: lines.length + 1,
      firstByte: byteOffset,
      afterLastByte: byteOffset + byteLength,
      rawText,
      contentText: rawText,
    });
  }

  return lines;
}

function parseBlocks(lines: readonly Line[]): Block[] {
  const blocks: Block[] = [];
  let index = 0;

  while (index < lines.length) {
    const line = lines[index]!;
    const fence = fenceOpen(line);
    if (fence) {
      let end = index;
      while (end + 1 < lines.length) {
        end += 1;
        if (isFenceClose(lines[end]!, fence.marker, fence.length)) break;
      }
      const block = blockOf("fence", lines, index, end);
      if (block.byteLength > MAX_CHUNK_BYTES) throw new NoteChunkerExclusionError("line_or_fence_too_large");
      blocks.push(block);
      index = end + 1;
      continue;
    }

    const atx = atxHeading(line);
    if (atx) {
      blocks.push({ ...blockOf("heading", lines, index, index), level: atx.level, headingText: atx.text });
      index += 1;
      continue;
    }

    if (isBlank(line)) {
      let end = index;
      while (end + 1 < lines.length && isBlank(lines[end + 1]!)) end += 1;
      blocks.push(blockOf("blank", lines, index, end));
      index = end + 1;
      continue;
    }

    let end = index;
    let consumedSetext = false;
    while (true) {
      if (end + 1 < lines.length && setextLevel(lines[end + 1]!)) {
        if (end > index) blocks.push(blockOf("text", lines, index, end - 1));
        const headingLine = end;
        end += 1;
        blocks.push({
          ...blockOf("heading", lines, headingLine, end),
          level: setextLevel(lines[end]!)!,
          headingText: parsingText(lines[headingLine]!).trim(),
        });
        index = end + 1;
        consumedSetext = true;
        break;
      }
      if (
        end + 1 >= lines.length
        || isBlank(lines[end + 1]!)
        || !!fenceOpen(lines[end + 1]!)
        || !!atxHeading(lines[end + 1]!)
      ) {
        blocks.push(blockOf("text", lines, index, end));
        index = end + 1;
        break;
      }
      end += 1;
    }
    if (consumedSetext) continue;
  }

  return blocks;
}

function buildSections(blocks: readonly Block[]): Section[] {
  if (!blocks.length) return [];
  const sections: Section[] = [];
  let stack: Array<{ level: number; text: string }> = [];
  let start = 0;

  for (let index = 0; index < blocks.length; index += 1) {
    const block = blocks[index]!;
    if (block.type !== "heading") continue;
    if (index > start) sections.push({ headingPath: stack.map(h => h.text), blocks: blocks.slice(start, index) });
    stack = [...stack.filter(h => h.level < block.level), { level: block.level, text: block.headingText }];
    start = index;
  }

  if (start < blocks.length) sections.push({ headingPath: stack.map(h => h.text), blocks: blocks.slice(start) });
  return sections;
}

function buildUnits(blocks: readonly Block[]): Unit[] {
  const units: Unit[] = [];
  for (let index = 0; index < blocks.length; index += 1) {
    const first = blocks[index]!;
    let last = first;
    if (first.type !== "blank" && index + 1 < blocks.length && blocks[index + 1]!.type === "blank" && blocks[index + 1]!.afterLastByte - first.firstByte <= MAX_CHUNK_BYTES) {
      last = blocks[index + 1]!;
      index += 1;
    }
    units.push({
      rootType: first.type,
      firstLine: first.firstLine,
      lastLine: last.lastLine,
      firstByte: first.firstByte,
      afterLastByte: last.afterLastByte,
      byteLength: last.afterLastByte - first.firstByte,
      containsFence: first.type === "fence" || last.type === "fence",
    });
  }
  return units;
}

function blockOf<T extends Block["type"]>(type: T, lines: readonly Line[], firstLine: number, lastLine: number): Extract<Block, { type: T }> {
  const first = lines[firstLine]!;
  const last = lines[lastLine]!;
  return {
    type,
    firstLine,
    lastLine,
    firstByte: first.firstByte,
    afterLastByte: last.afterLastByte,
    byteLength: last.afterLastByte - first.firstByte,
  } as Extract<Block, { type: T }>;
}

function parsingText(line: Line): string {
  return line.lineNumber === 1 && line.contentText.startsWith("\uFEFF")
    ? line.contentText.slice(1)
    : line.contentText;
}

function isBlank(line: Line): boolean {
  return /^[ \t]*$/.test(parsingText(line));
}

function atxHeading(line: Line): { level: number; text: string } | null {
  const match = /^(?: {0,3})(#{1,6})(?:[ \t]+|$)(.*)$/.exec(parsingText(line));
  if (!match) return null;
  let text = match[2] ?? "";
  text = text.replace(/[ \t]+#+[ \t]*$/, "").trim();
  return { level: match[1]!.length, text };
}

function setextLevel(line: Line): number | null {
  const match = /^(?: {0,3})(=+|-+)[ \t]*$/.exec(parsingText(line));
  if (!match) return null;
  return match[1]![0] === "=" ? 1 : 2;
}

function fenceOpen(line: Line): { marker: "`" | "~"; length: number } | null {
  const match = /^(?: {0,3})(`{3,}|~{3,})(.*)$/.exec(parsingText(line));
  if (!match) return null;
  const marker = match[1]![0] as "`" | "~";
  return { marker, length: match[1]!.length };
}

function isFenceClose(line: Line, marker: "`" | "~", length: number): boolean {
  const match = /^(?: {0,3})(`+|~+)[ \t]*$/.exec(parsingText(line));
  return !!match && match[1]![0] === marker && match[1]!.length >= length;
}

function chunkIdOf(
  namespace: string,
  relativePath: string,
  sourceRevision: string,
  firstByte: number,
  afterLastByte: number,
): string {
  const payload = JSON.stringify([
    namespace,
    relativePath,
    sourceRevision,
    CHUNKER_VERSION,
    firstByte,
    afterLastByte,
  ]);
  return `nr1:${createHash("sha256").update(payload, "utf8").digest("hex")}`;
}

function sha256(value: Uint8Array): string {
  return createHash("sha256").update(value).digest("hex");
}
