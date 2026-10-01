/** Pure lexical ranking. No database/file access and no semantic confidence. */
export interface NoteQueryPlan { streams: string[]; terms: string[]; anchors: string[]; explicit: boolean }
const STOP = new Set('a an the is are at of for to in on what when where how which with does do should'.split(' '));
const quote = (value: string) => `"${value.replaceAll('"', '""')}"`;
const words = (text: string) => text.toLowerCase().match(/[\p{L}\p{N}_]+/gu) ?? [];

/** Preserve explicit FTS syntax; ordinary words are recall terms, quotes and IDs are constraints. */
export function planNoteQuery(query: string): NoteQueryPlan | null {
  if (!query.trim() || query.length > 512 || query.includes('\0') || (query.match(/"/g)?.length ?? 0) % 2) return null;
  const bare = query.replace(/"[^"]*"/g, '');
  const explicit = /\b(?:AND|OR|NOT|NEAR)\b|[():^*{}]/.test(bare);
  const units = [...query.matchAll(/"([^"\n]+)"|([\p{L}\p{N}_]+(?:[-./][\p{L}\p{N}_]+)*)/gu)];
  const terms = [...new Set(units.map(m => m[1] ?? m[2]!).filter(s => !STOP.has(s.toLowerCase())))];
  if (explicit) return { streams: [query], terms: terms.slice(0,32), anchors: [], explicit };
  if (!terms.length || terms.length > 32) return null;
  const anchors = [...new Set(units.filter(m => m[1] !== undefined || (/\p{N}/u.test(m[2]!) && /[-./_]/.test(m[2]!))).map(m => m[1] ?? m[2]!))];
  const all = terms.map(quote).join(' AND '), any = terms.map(quote).join(' OR ');
  const constrain = (fts: string) => anchors.length ? `(${fts}) AND (${anchors.map(quote).join(' AND ')})` : fts;
  return { streams: [...new Set([all, constrain(`(${any})`), constrain(`heading : (${any})`)])], terms, anchors, explicit };
}

/** Identifier boundaries prevent an exact VIC-12 constraint from matching VIC-12B. */
export function hasLiteralAnchor(text: string, anchor: string): boolean {
  const value = text.toLowerCase(), target = anchor.toLowerCase();
  let at = -1;
  while ((at = value.indexOf(target, at+1)) >= 0) {
    const before = [...value.slice(0,at)].at(-1) ?? '', after = value.slice(at+target.length);
    if (!/[\p{L}\p{N}\p{M}_/.-]/u.test(before) && !/^[\p{L}\p{N}\p{M}_/-]|^\.[\p{L}\p{N}\p{M}_]/u.test(after)) return true;
  }
  return false;
}

export function noteLexicalSignals(plan: NoteQueryPlan, heading: string, text: string) {
  const body = ` ${words(text).join(' ')} `, title = ` ${words(heading).join(' ')} `;
  const phrases = plan.terms.map(term => words(term).join(' ')).filter(Boolean);
  return {
    matched_terms: phrases.filter(term => body.includes(` ${term} `) || title.includes(` ${term} `)).length,
    heading_terms: phrases.filter(term => title.includes(` ${term} `)).length,
    query_terms: phrases.length,
  };
}

export interface RankableNote { path: string; first_byte: number; chunk_id: string; rank: number; heading: string; content: string }
/** Input content is indexed hex; the tool must still verify source bytes before delivery. */
export function compareNoteCandidates(plan: NoteQueryPlan, a: RankableNote, b: RankableNote): number {
  const x = noteLexicalSignals(plan, a.heading, Buffer.from(a.content,'hex').toString('utf8'));
  const y = noteLexicalSignals(plan, b.heading, Buffer.from(b.content,'hex').toString('utf8'));
  return (plan.explicit ? 0 : y.matched_terms-x.matched_terms || y.heading_terms-x.heading_terms)
    || a.rank-b.rank || Buffer.compare(Buffer.from(a.path),Buffer.from(b.path)) || a.first_byte-b.first_byte
    || Buffer.compare(Buffer.from(a.chunk_id),Buffer.from(b.chunk_id));
}
