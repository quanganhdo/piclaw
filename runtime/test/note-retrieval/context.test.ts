import { expect, test } from 'bun:test';
import { createHash } from 'node:crypto';
import { chunkMarkdown, CHUNKER_VERSION } from '../../src/note-retrieval/chunker.js';
import { assembleNoteContext, NOTE_CONTEXT_LIMITS, type NoteContextMatch, type NoteContextResult } from '../../src/note-retrieval/context.js';

const namespace = 'context-test';
function fixture(text: string, path = 'notes/example.md') {
  const bytes = Buffer.from(text), parsed = chunkMarkdown(bytes, namespace, path);
  const matches = parsed.chunks.map(chunk => ({ path, chunkId: chunk.chunkId, sourceRevision: parsed.sourceRevision,
    chunkerVersion: CHUNKER_VERSION, firstByte: chunk.firstByte, afterLastByte: chunk.afterLastByte,
    lineStart: chunk.lineStart, lineEnd: chunk.lineEnd, matchLineStart: chunk.lineStart, matchLineEnd: chunk.lineEnd }));
  return { source: { path, bytes }, matches };
}
function assertExact(result: NoteContextResult, bytes: Buffer) {
  expect(Buffer.byteLength(JSON.stringify(result))).toBeLessThanOrEqual(NOTE_CONTEXT_LIMITS.responseBytes);
  for (const p of result.passages) {
    expect(Buffer.byteLength(p.text)).toBeLessThanOrEqual(NOTE_CONTEXT_LIMITS.passageBytes);
    expect(p.text).toBe(bytes.subarray(p.first_byte, p.after_last_byte).toString('utf8'));
    expect(p.text).toBe((bytes.toString('utf8').match(/[^\n]*\n|[^\n]+$/g) ?? []).slice(p.line_start - 1, p.line_end).join(''));
    expect(p.references.length).toBeGreaterThan(0);
    for (const ref of p.references) expect(ref.source_revision).toBe(p.source_revision);
  }
}
const assemble = (f: ReturnType<typeof fixture>, matches = f.matches) => assembleNoteContext({ namespace, sources: [f.source], matches });

test('expands an exact match to adjacent paragraphs without changing its reference', () => {
  const f = fixture('# Press\n\nThis card applies to press Wren.\n\nIts key is kept in drawer M.\n');
  const match = { ...f.matches[0]!, matchLineStart: 3, matchLineEnd: 3 };
  const result = assemble(f, [match]);
  expect(result.status).toBe('assembled'); expect(result.limited).toBe(false);
  expect(result.passages).toHaveLength(1); expect(result.passages[0]!.text).toContain('press Wren.\n\nIts key');
  expect(result.passages[0]!.references[0]).toMatchObject({ chunk_id: match.chunkId, source_revision: match.sourceRevision });
  assertExact(result, f.source.bytes);
});

test('deduplicates identical and overlapping context while retaining ranking order', () => {
  const f = fixture('# Topic\n\nAlpha context.\n\nBeta context.\n\nGamma context.\n');
  const match = f.matches[0]!;
  const matches = [3, 7, 5, 3].map(line => ({ ...match, matchLineStart: line, matchLineEnd: line }));
  const result = assemble(f, matches);
  expect(result.passages).toHaveLength(1); expect(result.passages[0]!.references).toHaveLength(1);
  expect(result.passages[0]!.text).toContain('Alpha context.'); expect(result.passages[0]!.text).toContain('Gamma context.');
  assertExact(result, f.source.bytes);
  expect(assemble(f, matches)).toEqual(result);
});

test('BOM, CRLF, Unicode and lone CR byte and line ranges remain exact', () => {
  const f = fixture('\uFEFFTitle\r\n=====\r\n\r\nCafé 😀\r\n\r\nThe answer is 漢字.\r\n');
  const result = assemble(f, [{ ...f.matches[0]!, matchLineStart: 4, matchLineEnd: 4 }]);
  assertExact(result, f.source.bytes); expect(result.passages[0]!.text).toContain('Café 😀\r\n');
  const cr = fixture('one\rtwo\nthree\n'); assertExact(assemble(cr), cr.source.bytes);
});

test('repeated headings and adjacent different chunks never redirect or cross citation bounds', () => {
  const f = fixture('# One\nfirst answer\n# One\nsecond answer\n');
  const result = assemble(f, [f.matches[1]!, f.matches[0]!]);
  expect(result.passages.map(p => p.text)).toEqual(['# One\nsecond answer\n', '# One\nfirst answer\n']);
  expect(result.passages.map(p => p.references[0]!.chunk_id)).toEqual([f.matches[1]!.chunkId, f.matches[0]!.chunkId]);
  assertExact(result, f.source.bytes);
});

test('never returns stale bytes, including a same-size edit and a different namespace', () => {
  const f = fixture('# Note\nalpha\n'); f.source.bytes = Buffer.from('# Note\nbravo\n');
  expect(assemble(f)).toMatchObject({ status: 'assembled', limited: true, reasons: ['source_revision_changed'], passages: [] });
  expect(assembleNoteContext({ namespace: 'other', sources: [f.source], matches: f.matches })).toEqual({ status: 'invalid_reference', limited: true, reasons: [], passages: [] });
  expect(assembleNoteContext({ namespace, sources: [], matches: f.matches })).toMatchObject({ limited: true, reasons: ['source_missing'], passages: [] });
});

test('malformed ranges, ids, paths and versions fail closed even after a valid candidate', () => {
  const f = fixture('# Header\ncontent\n');
  const changes: Array<Partial<NoteContextMatch>> = [
    { firstByte: 1 }, { afterLastByte: 999 }, { lineStart: 0 }, { lineEnd: 999 },
    { matchLineStart: 0 }, { matchLineEnd: 999 }, { matchLineEnd: NaN }, { chunkId: 'nr1:broken' },
    { chunkerVersion: 'old' }, { path: 'notes/../secret.md' }, { path: 'notes/users/secret.md' }, { path: 'notes/family/shared.md' },
  ];
  for (const change of changes) expect(assemble(f, [f.matches[0]!, { ...f.matches[0]!, ...change }])).toMatchObject({ status: 'invalid_reference', passages: [] });
  expect(assembleNoteContext({ namespace, sources: [f.source, f.source], matches: f.matches }).status).toBe('invalid_reference');
});

test('fenced code is returned complete or explicitly omitted, never clipped', () => {
  const f = fixture('# Code\n\n```ts\n# not a heading\nconst answer = 42;\n```\n\nAfter code.\n');
  const result = assemble(f, [{ ...f.matches[0]!, matchLineStart: 5, matchLineEnd: 5 }]);
  expect(result.passages[0]!.text).toContain('```ts\n# not a heading\nconst answer = 42;\n```\n'); assertExact(result, f.source.bytes);
  const large = fixture('# Code\n\n```\n' + 'x'.repeat(1500) + '\n```\n');
  expect(assemble(large, [{ ...large.matches[0]!, matchLineStart: 4, matchLineEnd: 4 }])).toMatchObject({ limited: true, reasons: ['context_limit'], passages: [] });
  const unterminated = fixture('# Code\n\n~~~\none\ntwo\n');
  const open = assemble(unterminated, [{ ...unterminated.matches[0]!, matchLineStart: 4, matchLineEnd: 4 }]);
  expect(open.passages[0]!.text).toContain('~~~\none\ntwo\n'); assertExact(open, unterminated.source.bytes);
});

test('long prose can return complete matching lines but oversized matching lines are explicit limits', () => {
  const f = fixture('# Long\n' + 'a'.repeat(800) + '\n' + 'b'.repeat(800) + '\n');
  const result = assemble(f, [{ ...f.matches[0]!, matchLineStart: 2, matchLineEnd: 2 }]);
  expect(result.passages[0]!.text).toContain('a'.repeat(800)); expect(result.passages[0]!.text).not.toContain('b'.repeat(800)); assertExact(result, f.source.bytes);
  const over = fixture('# Long\n' + 'x'.repeat(1025) + '\n');
  expect(assemble(over, [{ ...over.matches[0]!, matchLineStart: 2, matchLineEnd: 2 }])).toMatchObject({ limited: true, reasons: ['context_limit'], passages: [] });
});

test('serialised output and result count caps include metadata and escaping', () => {
  const fixtures = Array.from({ length: 10 }, (_, i) => fixture(`# N${i}\n${'"\\漢字'.repeat(120)}\n`, `notes/${i}.md`));
  const result = assembleNoteContext({ namespace, sources: fixtures.map(f => f.source), matches: fixtures.flatMap(f => f.matches) });
  expect(result.limited).toBe(true); expect(result.reasons).toContain('response_limit');
  expect(result.passages.length).toBeGreaterThan(0); expect(Buffer.byteLength(JSON.stringify(result))).toBeLessThanOrEqual(NOTE_CONTEXT_LIMITS.responseBytes);
  const tiny = Array.from({ length: 6 }, (_, i) => fixture('x', `notes/${i}.md`));
  const capped = assembleNoteContext({ namespace, sources: tiny.map(f => f.source), matches: tiny.flatMap(f => f.matches) });
  expect(capped.passages).toHaveLength(5); expect(capped.reasons).toContain('result_limit');
});

test('input ceilings do not silently truncate or widen access and no bytes alias caller buffers', () => {
  const f = fixture('# Header\ncontent\n');
  expect(assemble(f, Array.from({ length: 51 }, () => f.matches[0]!)).status).toBe('input_limit');
  expect(assembleNoteContext({ namespace, sources: Array.from({ length: 17 }, (_, i) => ({ path: `notes/${i}.md`, bytes: Buffer.from('x') })), matches: [] }).status).toBe('input_limit');
  expect(assembleNoteContext({ namespace, sources: [{ path: 'notes/x.md', bytes: Buffer.alloc(512 * 1024 + 1) }], matches: [] }).status).toBe('input_limit');
  const result = assemble(f), before = JSON.stringify(result); f.source.bytes.fill(0); expect(JSON.stringify(result)).toBe(before);
  expect(assembleNoteContext({ namespace, sources: [], matches: [] })).toEqual({ status: 'assembled', limited: false, reasons: [], passages: [] });
});

test('matching forged hash with invalid source bytes or wrong stored line bounds still fails closed', () => {
  const f = fixture('# Header\ncontent\n');
  const bad = { ...f.matches[0]!, lineEnd: 100 };
  expect(assemble(f, [bad])).toMatchObject({ status: 'invalid_reference', passages: [] });
  const bytes = Buffer.from([255]), revision = createHash('sha256').update(bytes).digest('hex');
  const match = { ...f.matches[0]!, firstByte: 0, afterLastByte: 1, lineStart: 1, lineEnd: 1, matchLineStart: 1, matchLineEnd: 1, sourceRevision: revision,
    chunkId: 'nr1:' + createHash('sha256').update(JSON.stringify([namespace, f.source.path, revision, CHUNKER_VERSION, 0, 1])).digest('hex') };
  expect(assembleNoteContext({ namespace, sources: [{ path: f.source.path, bytes }], matches: [match] })).toMatchObject({ status: 'invalid_reference', passages: [] });
});

test('many tiny lines are bounded before allocating per-line parser objects', () => {
  const bytes = Buffer.from('\n'.repeat(NOTE_CONTEXT_LIMITS.linesPerSource + 1));
  expect(assembleNoteContext({ namespace, sources: [{ path: 'notes/many.md', bytes }], matches: [] }).status).toBe('input_limit');
  const sources = Array.from({ length: 5 }, (_, i) => ({ path: `notes/${i}.md`, bytes: Buffer.from('\n'.repeat(NOTE_CONTEXT_LIMITS.linesPerSource)) }));
  expect(assembleNoteContext({ namespace, sources, matches: [] }).status).toBe('input_limit');
});

test('unparsed quoted, list and indented fences are omitted conservatively', () => {
  for (const body of ['> ```ts\n> code\n> ```\n', '- ```ts\n  code\n  ```\n', '    ```ts\n    code\n    ```\n']) {
    const f = fixture('# Container\n\n' + body);
    expect(assemble(f)).toMatchObject({ status: 'assembled', limited: true, reasons: ['context_limit'], passages: [] });
  }
});

test('list-continuation and ambiguous backtick info fences are withheld', () => {
  for (const body of ['- entry\n\n  ```ts\n  code\n  ```\n', '```js`bad\ncode\n```\n', '``` js`bad\ncode\n```\n']) {
    const f = fixture('# Container\n\n' + body);
    expect(assemble(f)).toMatchObject({ status: 'assembled', limited: true, reasons: ['context_limit'], passages: [] });
  }
});

test('source revision mismatch takes precedence over unsupported source syntax', () => {
  const f = fixture('# Original\ntext\n');
  f.source.bytes = Buffer.from('# Changed\n> ```\n> different\n> ```\n');
  expect(assemble(f)).toMatchObject({ status: 'assembled', limited: true, reasons: ['source_revision_changed'], passages: [] });
});
