import { createHash } from "node:crypto";
import { expect, test } from "bun:test";
import {
  CHUNKER_VERSION,
  NoteChunkerExclusionError,
  chunkMarkdown,
} from "../../src/note-retrieval/chunker.js";

const encoder = new TextEncoder();

function bytes(text: string): Uint8Array {
  return encoder.encode(text);
}

function sha256(input: Uint8Array): string {
  return createHash("sha256").update(input).digest("hex");
}

function expectedChunkId(
  namespace: string,
  relativePath: string,
  sourceRevision: string,
  firstByte: number,
  afterLastByte: number,
): string {
  return `nr1:${createHash("sha256")
    .update(
      JSON.stringify([namespace, relativePath, sourceRevision, CHUNKER_VERSION, firstByte, afterLastByte]),
      "utf8",
    )
    .digest("hex")}`;
}

function assertExactSlices(source: Uint8Array, result: ReturnType<typeof chunkMarkdown>): void {
  let offset = 0;
  for (const chunk of result.chunks) {
    expect(chunk.firstByte).toBe(offset);
    const exact = source.subarray(chunk.firstByte, chunk.afterLastByte);
    expect(Buffer.from(exact)).toEqual(Buffer.from(bytes(chunk.text)));
    offset = chunk.afterLastByte;
  }
  expect(offset).toBe(source.byteLength);
}

function expectExclusion(run: () => unknown, code: string): void {
  try {
    run();
    throw new Error("expected exclusion");
  } catch (error) {
    expect(error).toBeInstanceOf(NoteChunkerExclusionError);
    expect((error as NoteChunkerExclusionError).code).toBe(code);
  }
}

test("empty file yields zero chunks with raw-byte revision", () => {
  const source = new Uint8Array();
  const result = chunkMarkdown(source, "ns", "notes/empty.md");
  expect(result).toEqual({
    sourceRevision: sha256(source),
    chunks: [],
  });
});

test("a lone CR is source content while LF and CRLF delimit lines", () => {
  const source = bytes("one\rtwo\nthree\r\nfour");
  const result = chunkMarkdown(source, "ns-cr", "notes/cr.md");
  expect(result.chunks).toHaveLength(1);
  expect(result.chunks[0]).toMatchObject({ lineStart: 1, lineEnd: 3, text: "one\rtwo\nthree\r\nfour" });
  assertExactSlices(source, result);
});

test("setext underline applies only to its immediately preceding source line", () => {
  const result = chunkMarkdown(bytes("ordinary prose\nActual heading\n---\nbody"), "ns-setext", "notes/setext.md");
  expect(result.chunks).toHaveLength(2);
  expect(result.chunks[0]).toMatchObject({ headingPath: [], text: "ordinary prose\n" });
  expect(result.chunks[1]).toMatchObject({ headingPath: ["Actual heading"], text: "Actual heading\n---\nbody" });
});

test("preserves BOM, CRLF, Unicode, setext ancestry, repeated headings, and fenced blocks", () => {
  const namespace = "ns-a";
  const relativePath = "notes/sample.md";
  const text = "\uFEFFIntro\r\n=====\r\nalpha 😀\r\n\r\n## Repeat\r\ntext\r\n```ts\r\n# not a heading\r\n```\r\n## Repeat\r\nomega";
  const source = bytes(text);
  const result = chunkMarkdown(source, namespace, relativePath);

  expect(result.sourceRevision).toBe(sha256(source));
  expect(result.chunks).toHaveLength(3);
  assertExactSlices(source, result);

  const first = "\uFEFFIntro\r\n=====\r\nalpha 😀\r\n\r\n";
  const second = "## Repeat\r\ntext\r\n```ts\r\n# not a heading\r\n```\r\n";
  const third = "## Repeat\r\nomega";

  expect(result.chunks[0]).toEqual({
    chunkId: expectedChunkId(namespace, relativePath, result.sourceRevision, 0, bytes(first).byteLength),
    firstByte: 0,
    afterLastByte: bytes(first).byteLength,
    lineStart: 1,
    lineEnd: 4,
    headingPath: ["Intro"],
    kind: "section",
    text: first,
  });
  expect(result.chunks[1]).toEqual({
    chunkId: expectedChunkId(
      namespace,
      relativePath,
      result.sourceRevision,
      bytes(first).byteLength,
      bytes(first).byteLength + bytes(second).byteLength,
    ),
    firstByte: bytes(first).byteLength,
    afterLastByte: bytes(first).byteLength + bytes(second).byteLength,
    lineStart: 5,
    lineEnd: 9,
    headingPath: ["Intro", "Repeat"],
    kind: "section",
    text: second,
  });
  expect(result.chunks[2]).toEqual({
    chunkId: expectedChunkId(
      namespace,
      relativePath,
      result.sourceRevision,
      bytes(first).byteLength + bytes(second).byteLength,
      source.byteLength,
    ),
    firstByte: bytes(first).byteLength + bytes(second).byteLength,
    afterLastByte: source.byteLength,
    lineStart: 10,
    lineEnd: 11,
    headingPath: ["Intro", "Repeat"],
    kind: "section",
    text: third,
  });
});

test("prefers paragraph boundaries and falls back to line chunks without splitting lines", () => {
  const heading = "# Large\n";
  const paragraphOne = `${"a".repeat(7000)}\n\n`;
  const paragraphTwo = `${"b".repeat(7000)}\n\n`;
  const lineOne = `${"c".repeat(7000)}\n`;
  const lineTwo = `${"d".repeat(7000)}\n`;
  const lineThree = `${"e".repeat(4000)}`;
  const source = bytes(`${heading}${paragraphOne}${paragraphTwo}${lineOne}${lineTwo}${lineThree}`);

  const result = chunkMarkdown(source, "ns-b", "notes/large.md");
  assertExactSlices(source, result);

  expect(result.chunks.map(chunk => chunk.kind)).toEqual(["paragraph", "lines", "lines"]);
  expect(result.chunks[0]?.text).toBe(`${heading}${paragraphOne}${paragraphTwo}`);
  expect(result.chunks[1]?.text).toBe(`${lineOne}${lineTwo}`);
  expect(result.chunks[2]?.text).toBe(lineThree);
  for (const chunk of result.chunks) expect(chunk.headingPath).toEqual(["Large"]);
  for (const chunk of result.chunks) expect(chunk.afterLastByte - chunk.firstByte).toBeLessThanOrEqual(16 * 1024);
});

test("rejects invalid UTF-8, NUL, oversized file, oversized line, oversized fence, and too many chunks", () => {
  expectExclusion(() => chunkMarkdown(Uint8Array.from([0xc3, 0x28]), "ns", "notes/bad.md"), "invalid_utf8_or_nul");
  expectExclusion(() => chunkMarkdown(Uint8Array.from([0x61, 0x00, 0x62]), "ns", "notes/nul.md"), "invalid_utf8_or_nul");
  expectExclusion(() => chunkMarkdown(new Uint8Array(512 * 1024 + 1), "ns", "notes/big.md"), "file_too_large");
  expectExclusion(() => chunkMarkdown(bytes(`${"x".repeat(16 * 1024 + 1)}`), "ns", "notes/line.md"), "line_or_fence_too_large");

  const oversizedFence = bytes("```\n" + "x".repeat(16 * 1024 - 8) + "\n```\n");
  expectExclusion(() => chunkMarkdown(oversizedFence, "ns", "notes/fence.md"), "line_or_fence_too_large");

  const tooMany = bytes(Array.from({ length: 129 }, (_, index) => `# H${index + 1}\n`).join(""));
  expectExclusion(() => chunkMarkdown(tooMany, "ns", "notes/chunks.md"), "too_many_chunks");
});
