import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { resolve, sep } from 'node:path';

export interface Reference { path: string; lineStart: number; lineEnd: number; quote: string }
export interface Query { id: string; split: 'development' | 'held-out'; category: string; question: string; query: string; relevant: Reference[]; conflictingPaths?: string[] }
export interface Corpus { version: number; provenance: string; queries: Query[] }
export function loadCorpus(root: string): Corpus {
  const frozen = JSON.parse(readFileSync(resolve(root, 'frozen-sha256.json'), 'utf8')) as { hashes: Record<string, string> };
  for (const [name, expected] of Object.entries(frozen.hashes)) {
    const file = resolve(root, name);
    if (!file.startsWith(resolve(root) + sep)) throw Error('Fixture path escapes root');
    const actual = createHash('sha256').update(readFileSync(file)).digest('hex');
    if (actual !== expected) throw Error(`Frozen corpus mismatch: ${name}`);
  }
  const corpus = JSON.parse(readFileSync(resolve(root, 'corpus.json'), 'utf8')) as Corpus;
  const ids = new Set<string>();
  for (const query of corpus.queries) {
    if (ids.has(query.id)) throw Error('Duplicate query ID'); ids.add(query.id);
    for (const reference of query.relevant) {
      if (!Object.hasOwn(frozen.hashes, reference.path) || reference.lineStart < 1 || reference.lineEnd < reference.lineStart) throw Error('Invalid reference');
      const text = readFileSync(resolve(root, reference.path), 'utf8').split(/\r?\n/).slice(reference.lineStart - 1, reference.lineEnd).join('\n');
      if (text !== reference.quote) throw Error(`Independent source label mismatch: ${query.id}`);
    }
  }
  return corpus;
}

/** File hits get full relevant-file credit and optimistic section-coverage credit.
 * This deliberately does not score a snippet as a precise section citation. */
export function scoreFileHits(query: Query, rankedPaths: string[], k: number) {
  const paths = [...new Set(rankedPaths.slice(0, k))];
  const relevantFiles = [...new Set(query.relevant.map(reference => reference.path))];
  const first = paths.findIndex(path => relevantFiles.includes(path));
  return {
    fileRecall: relevantFiles.length ? paths.filter(path => relevantFiles.includes(path)).length / relevantFiles.length : null,
    sectionCoverageUpperBound: query.relevant.length ? query.relevant.filter(reference => paths.includes(reference.path)).length / query.relevant.length : null,
    reciprocalRank: relevantFiles.length ? first < 0 ? 0 : 1 / (first + 1) : null,
    filePrecision: paths.length ? paths.filter(path => relevantFiles.includes(path)).length / paths.length : null,
    unanswerableReturnedHits: !relevantFiles.length && paths.length > 0,
    abstained: paths.length === 0,
    conflictingHits: paths.filter(path => query.conflictingPaths?.includes(path)).length,
  };
}
export function summariseScores(queries: Query[], results: { id: string; paths: string[]; bytes: number }[], k: number) {
  const scored = queries.map(query => {
    const result = results.find(item => item.id === query.id);
    if (!result) throw Error(`Missing query result: ${query.id}`);
    return { query, result, score: scoreFileHits(query, result.paths, k) };
  });
  const answerable = scored.filter(item => item.query.relevant.length);
  const empty = scored.filter(item => !item.query.relevant.length);
  const mean = (values: number[]) => values.length ? values.reduce((a,b) => a+b,0)/values.length : null;
  return {
    queries: queries.length, answerable: answerable.length, unanswerable: empty.length,
    fileRecall: mean(answerable.map(x => x.score.fileRecall!)),
    sectionCoverageUpperBound: mean(answerable.map(x => x.score.sectionCoverageUpperBound!)),
    mrr: mean(answerable.map(x => x.score.reciprocalRank!)),
    filePrecision: mean(answerable.map(x => x.score.filePrecision ?? 0)),
    unanswerableFalsePositiveRate: mean(empty.map(x => Number(x.score.unanswerableReturnedHits))),
    meanResponseBytes: mean(scored.map(x => x.result.bytes)),
    maxResponseBytes: Math.max(0, ...scored.map(x => x.result.bytes)),
    citationCorrectness: null, citationSupport: 'unsupported: baseline has no chunk revision or line citation',
  };
}
export function percentile(values: number[], p: number): number {
  const sorted = [...values].sort((a,b) => a-b);
  return sorted.length ? sorted[Math.min(sorted.length - 1, Math.ceil(p * sorted.length) - 1)] : 0;
}
