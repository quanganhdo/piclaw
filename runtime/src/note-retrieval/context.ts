/** Pure, synchronous context assembly for already-admitted query candidates.
 * This module has no reader, DB access, tool registration or ranking policy.
 * Callers must enforce access, source identity and generation freshness before
 * and after assembly; a matching hash is consistency, never authorisation. */
import { createHash } from 'node:crypto';
import { CHUNKER_VERSION } from './chunker.js';
import { admittedNotePath, NOTE_LIMITS } from './files.js';

export const NOTE_CONTEXT_LIMITS = Object.freeze({ candidates: 50, files: 16, sourceBytes: 8 * 1024 * 1024,
  linesPerSource: 8192, totalLines: 32768, passageBytes: 1024, results: 5, responseBytes: 4096 });

export interface NoteContextSource { path: string; bytes: Uint8Array }
export interface NoteContextMatch {
  path: string;
  chunkId: string;
  sourceRevision: string;
  chunkerVersion: string;
  firstByte: number;
  afterLastByte: number;
  lineStart: number;
  lineEnd: number;
  /** Exact matched source lines, supplied by retrieval within this stored chunk. */
  matchLineStart: number;
  matchLineEnd: number;
}
export interface NoteContextReference {
  chunk_id: string;
  source_revision: string;
  /** Original stored chunk bounds, not a newly issued reference for the snippet. */
  first_byte: number;
  after_last_byte: number;
  line_start: number;
  line_end: number;
}
export interface NoteContextPassage {
  path: string;
  source_revision: string;
  first_byte: number;
  after_last_byte: number;
  line_start: number;
  line_end: number;
  text: string;
  references: NoteContextReference[];
}
const REASONS = ['source_missing', 'source_revision_changed', 'context_limit', 'result_limit', 'response_limit'] as const;
type Reason = typeof REASONS[number];
export interface NoteContextResult {
  /** Assembly status only; not the eventual query's authority or completeness. */
  status: 'assembled' | 'invalid_reference' | 'input_limit';
  limited: boolean;
  reasons: Reason[];
  passages: NoteContextPassage[];
}
interface Line { first: number; end: number; text: string }
interface Block { first: number; last: number; kind: 'blank' | 'heading' | 'paragraph' | 'fence' }
interface SourceState { bytes: Buffer; revision: string; lines: Line[]; blocks: Block[] }
const hash = (value: Uint8Array | string) => createHash('sha256').update(value).digest('hex');
const encodedBytes = (value: unknown) => Buffer.byteLength(JSON.stringify(value));
const empty = (status: NoteContextResult['status']): NoteContextResult => ({ status, limited: status !== 'assembled', reasons: [], passages: [] });
const decoder = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true });
const integer = (n: number) => Number.isSafeInteger(n) && n >= 0;
class UnsupportedContextFence extends Error {}

function countLines(bytes: Uint8Array): number {
  let count = bytes.length && bytes[bytes.length - 1] !== 10 ? 1 : 0;
  for (const byte of bytes) if (byte === 10) count++;
  return count;
}

function readSource(bytes: Buffer, revision: string): SourceState {
  if (bytes.includes(0)) throw Error('invalid source bytes');
  decoder.decode(bytes); // reject malformed UTF-8 rather than repair its offsets
  const lines: Line[] = [];
  let start = 0;
  for (let i = 0; i < bytes.length; i++) if (bytes[i] === 10) {
    lines.push({ first: start, end: i + 1, text: bytes.subarray(start, i + 1).toString('utf8').replace(/\r?\n$/, '') }); start = i + 1;
  }
  if (start < bytes.length) lines.push({ first: start, end: bytes.length, text: bytes.subarray(start).toString('utf8') });
  // The index chunker supports top-level fences. Do not pretend to parse full
  // CommonMark containers: ambiguous quoted/list/indented fences omit this file.
  const hasList = lines.some(line => /^[ \t]*(?:[-+*]|\d+[.)])[ \t]+/.test(line.text));
  if (lines.some(line => {
    const backtickFence = /^ {0,3}(`{3,})(.*)$/.exec(line.text);
    return /^(?:[ \t]*>.*|[ \t]{4,}|\t|[ \t]*(?:[-+*]|\d+[.)])[ \t]+)[`~]{3,}/.test(line.text)
      || /^[ \t]*>[ \t>]*[`~]{3,}/.test(line.text)
      || (hasList && /^[ \t]+[`~]{3,}/.test(line.text))
      || Boolean(backtickFence?.[2]?.includes('`'));
  })) throw new UnsupportedContextFence();
  const blocks: Block[] = [];
  const plain = (i: number) => i === 0 ? lines[i]!.text.replace(/^\uFEFF/, '') : lines[i]!.text;
  const fence = (i: number) => /^ {0,3}(`{3,}|~{3,})(.*)$/.exec(plain(i));
  const heading = (i: number) => /^ {0,3}#{1,6}(?:[ \t]|$)/.test(plain(i));
  for (let i = 0; i < lines.length;) {
    const first = i, open = fence(i);
    if (open) {
      i++;
      while (i < lines.length) {
        const close = /^ {0,3}(`+|~+)[ \t]*$/.exec(plain(i));
        i++;
        if (close && close[1]![0] === open[1]![0] && close[1]!.length >= open[1]!.length) break;
      }
      blocks.push({ first, last: i - 1, kind: 'fence' });
    } else if (!plain(i).trim()) {
      while (++i < lines.length && !plain(i).trim()) { /* include contiguous blank lines */ }
      blocks.push({ first, last: i - 1, kind: 'blank' });
    } else if (heading(i)) { blocks.push({ first, last: i++, kind: 'heading' }); }
    else if (i + 1 < lines.length && /^ {0,3}(?:=+|-+)[ \t]*$/.test(plain(i + 1))) {
      blocks.push({ first, last: i + 1, kind: 'heading' }); i += 2;
    } else {
      i++;
      while (i < lines.length && plain(i).trim() && !heading(i) && !fence(i)
        && !(i + 1 < lines.length && /^ {0,3}(?:=+|-+)[ \t]*$/.test(plain(i + 1)))) i++;
      blocks.push({ first, last: i - 1, kind: 'paragraph' });
    }
  }
  return { bytes, lines, blocks, revision };
}

function validShape(match: NoteContextMatch, namespace: string): boolean {
  return admittedNotePath(match.path) && match.chunkerVersion === CHUNKER_VERSION
    && /^[a-f0-9]{64}$/.test(match.sourceRevision) && /^nr1:[a-f0-9]{64}$/.test(match.chunkId)
    && [match.firstByte, match.afterLastByte, match.lineStart, match.lineEnd, match.matchLineStart, match.matchLineEnd].every(integer)
    && match.firstByte < match.afterLastByte && match.afterLastByte - match.firstByte <= 16 * 1024
    && match.lineStart >= 1 && match.lineStart <= match.matchLineStart && match.matchLineStart <= match.matchLineEnd && match.matchLineEnd <= match.lineEnd
    && match.chunkId === `nr1:${hash(JSON.stringify([namespace, match.path, match.sourceRevision, CHUNKER_VERSION, match.firstByte, match.afterLastByte]))}`;
}

function selectContext(source: SourceState, match: NoteContextMatch): { first: number; last: number } | null {
  const { lines, blocks } = source;
  const low = match.lineStart - 1, high = match.lineEnd - 1;
  let first = match.matchLineStart - 1, last = match.matchLineEnd - 1;
  const fitting = (a: number, b: number) => a >= low && b <= high && lines[b]!.end - lines[a]!.first <= NOTE_CONTEXT_LIMITS.passageBytes;
  const startIndex = blocks.findIndex(b => b.first <= first && b.last >= first);
  const endIndex = blocks.findIndex(b => b.first <= last && b.last >= last);
  const startBlock = blocks[startIndex]!, endBlock = blocks[endIndex]!;
  // Matched code is always the whole fenced block, or no context at all.
  if (startBlock.kind === 'fence') first = startBlock.first;
  if (endBlock.kind === 'fence') last = endBlock.last;
  if (!fitting(first, last)) return null;
  const paragraphFirst = Math.max(low, startBlock.first), paragraphLast = Math.min(high, endBlock.last);
  if (fitting(paragraphFirst, paragraphLast)) { first = paragraphFirst; last = paragraphLast; }
  let previous = startIndex - 1;
  while (previous >= 0 && blocks[previous]!.kind === 'blank') previous--;
  const before = blocks[previous];
  if (before && before.last >= low && fitting(Math.max(low, before.first), last)) first = Math.max(low, before.first);
  let next = endIndex + 1;
  while (next < blocks.length && blocks[next]!.kind === 'blank') next++;
  const after = blocks[next];
  // Never cross a new heading to extend a result from the preceding section.
  if (after && after.kind !== 'heading' && after.first <= high && fitting(first, Math.min(high, after.last))) last = Math.min(high, after.last);
  return { first, last };
}

/** Pure transformation of source snapshots in already-ranked order. No query
 * fields confer trust. The eventual tool must fetch current rows/bytes through
 * #387's admitted closure and recheck generations before returning this output. */
export function assembleNoteContext(input: { namespace: string; sources: readonly NoteContextSource[]; matches: readonly NoteContextMatch[] }): NoteContextResult {
  const { namespace, sources, matches } = input;
  if (!namespace || typeof namespace !== 'string' || namespace.length > 256) return empty('invalid_reference');
  if (sources.length > NOTE_CONTEXT_LIMITS.files || matches.length > NOTE_CONTEXT_LIMITS.candidates
    || sources.some(s => s.bytes.byteLength > NOTE_LIMITS.fileBytes)
    || sources.reduce((sum, s) => sum + s.bytes.byteLength, 0) > NOTE_CONTEXT_LIMITS.sourceBytes) return empty('input_limit');
  if (sources.some(s => !admittedNotePath(s.path)) || new Set(sources.map(s => s.path)).size !== sources.length
    || matches.some(m => !validShape(m, namespace))) return empty('invalid_reference');
  const lineCounts = sources.map(s => countLines(s.bytes));
  if (lineCounts.some(n => n > NOTE_CONTEXT_LIMITS.linesPerSource)
    || lineCounts.reduce((sum, n) => sum + n, 0) > NOTE_CONTEXT_LIMITS.totalLines) return empty('input_limit');
  const result = empty('assembled'), reasons = new Set<Reason>(), cache = new Map<string, SourceState>();
  const excludedSources = new Set<string>();
  const snapshots = new Map<string, { bytes: Buffer; revision: string }>();
  const fitsResponse = (passages: NoteContextPassage[]) => encodedBytes({ status: 'assembled', limited: true, reasons: REASONS, passages }) <= NOTE_CONTEXT_LIMITS.responseBytes;
  for (const match of matches) {
    const supplied = sources.find(s => s.path === match.path);
    if (!supplied) { reasons.add('source_missing'); continue; }
    let snapshot = snapshots.get(match.path);
    if (!snapshot) {
      // Pin and digest before parser exclusions so stale references cannot be
      // misclassified as context limits. Never return a caller-owned byte view.
      const bytes = Buffer.from(supplied.bytes);
      snapshot = { bytes, revision: hash(bytes) }; snapshots.set(match.path, snapshot);
    }
    if (snapshot.revision !== match.sourceRevision) { reasons.add('source_revision_changed'); continue; }
    if (excludedSources.has(match.path)) { reasons.add('context_limit'); continue; }
    let source = cache.get(match.path);
    if (!source) {
      try { source = readSource(snapshot.bytes, snapshot.revision); } catch (error) {
        if (error instanceof UnsupportedContextFence) { excludedSources.add(match.path); reasons.add('context_limit'); continue; }
        return empty('invalid_reference');
      }
      cache.set(match.path, source);
    }
    const low = match.lineStart - 1, high = match.lineEnd - 1;
    if (source.lines[low]?.first !== match.firstByte || source.lines[high]?.end !== match.afterLastByte
      || source.blocks.some(b => b.kind === 'fence' && ((b.first < low && b.last >= low) || (b.first <= high && b.last > high)))) return empty('invalid_reference');
    const selected = selectContext(source, match);
    if (!selected) { reasons.add('context_limit'); continue; }
    let first = selected.first, last = selected.last;
    const reference: NoteContextReference = { chunk_id: match.chunkId, source_revision: match.sourceRevision,
      first_byte: match.firstByte, after_last_byte: match.afterLastByte, line_start: match.lineStart, line_end: match.lineEnd };
    const overlaps = result.passages.filter(p => p.path === match.path && p.source_revision === match.sourceRevision && p.line_start <= last + 1 && p.line_end >= first + 1);
    for (const p of overlaps) { first = Math.min(first, p.line_start - 1); last = Math.max(last, p.line_end - 1); }
    const refs = [...overlaps.flatMap(p => p.references), reference];
    const references = refs.filter((r, i) => refs.findIndex(other => other.chunk_id === r.chunk_id) === i);
    const passage: NoteContextPassage = { path: match.path, source_revision: match.sourceRevision,
      first_byte: source.lines[first]!.first, after_last_byte: source.lines[last]!.end,
      line_start: first + 1, line_end: last + 1,
      text: source.bytes.subarray(source.lines[first]!.first, source.lines[last]!.end).toString('utf8'), references };
    if (Buffer.byteLength(passage.text) > NOTE_CONTEXT_LIMITS.passageBytes) { reasons.add('context_limit'); continue; }
    const next = overlaps.length ? result.passages.flatMap(p => p === overlaps[0] ? [passage] : overlaps.includes(p) ? [] : [p]) : [...result.passages, passage];
    if (next.length > NOTE_CONTEXT_LIMITS.results) { reasons.add('result_limit'); continue; }
    if (!fitsResponse(next)) { reasons.add('response_limit'); continue; }
    result.passages = next;
  }
  result.reasons = REASONS.filter(reason => reasons.has(reason));
  result.limited = result.reasons.length > 0;
  return result;
}
