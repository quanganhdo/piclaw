/** Pure row/snapshot consistency checks. Never reads a store or grants access. */
import { createHash } from 'node:crypto';
import { admittedNotePath } from './files.js';
import { CHUNKER_VERSION } from './chunker.js';
export interface StoredNoteChunk {
  chunk_id: string; revision: string; path: string; chunker: string;
  first_byte: number; after_last_byte: number; line_start: number; line_end: number;
  heading: string; kind: string; content: string;
}
export function validateNoteChunk(row: StoredNoteChunk, namespace: string): string[] {
  if (typeof row.path !== 'string' || !admittedNotePath(row.path) || row.chunker !== CHUNKER_VERSION
    || typeof row.revision !== 'string' || !/^[a-f0-9]{64}$/.test(row.revision)
    || ![row.first_byte,row.after_last_byte,row.line_start,row.line_end].every(n=>Number.isSafeInteger(n)&&n>=0)
    || row.after_last_byte<=row.first_byte || row.after_last_byte-row.first_byte>16*1024
    || row.line_start<1 || row.line_end<row.line_start || typeof row.heading!=='string' || row.heading.length>16*1024
    || !['section','paragraph','lines','fence'].includes(row.kind) || typeof row.content!=='string'
    || row.chunk_id!==`nr1:${createHash('sha256').update(JSON.stringify([namespace,row.path,row.revision,CHUNKER_VERSION,row.first_byte,row.after_last_byte])).digest('hex')}`) throw Error('invalid_note_chunk');
  const headings:unknown=JSON.parse(row.heading);
  if(!Array.isArray(headings)||!headings.every(s=>typeof s==='string'))throw Error('invalid_note_chunk');
  return headings;
}
/** Caller must already have verified the complete snapshot digest equals row.revision. */
export function verifiedNoteSlice(row: StoredNoteChunk, bytes: Buffer): string {
  if(row.after_last_byte>bytes.length || (row.first_byte>0&&bytes[row.first_byte-1]!==10)
    || (row.after_last_byte<bytes.length&&bytes[row.after_last_byte-1]!==10))throw Error('invalid_note_bounds');
  let first=1,last=1;
  for(let i=0;i<row.after_last_byte;i++)if(bytes[i]===10){if(i<row.first_byte)first++;if(i<row.after_last_byte-1)last++;}
  if(first!==row.line_start||last!==row.line_end)throw Error('invalid_note_lines');
  const slice=bytes.subarray(row.first_byte,row.after_last_byte);
  const text=new TextDecoder('utf-8',{fatal:true,ignoreBOM:true}).decode(slice);
  if(text.includes('\0')||slice.toString('hex').toUpperCase()!==row.content)throw Error('invalid_note_content');
  return text;
}
/** Only contiguous, heading-only ancestor chunks qualify; no neighbouring prose. */
export function isParentHeading(text:string,parent:string[],child:string[]):boolean {
  if(!parent.length||parent.length>=child.length||parent.some((s,i)=>child[i]!==s))return false;
  const lines=text.replace(/^\uFEFF/,'').split(/\r?\n/);
  while(lines.length && !lines.at(-1)!.trim())lines.pop();
  if(lines.length===1){
    const atx=/^ {0,3}#{1,6}(?:[ \t]+|$)(.*)$/.exec(lines[0]!);
    return !!atx && atx[1]!.replace(/[ \t]+#+[ \t]*$/,'').trim()===parent.at(-1);
  }
  return lines.length===2 && /^ {0,3}\S/.test(lines[0]!) && /^ {0,3}(?:=+|-+)[ \t]*$/.test(lines[1]!) && lines[0]!.trim()===parent.at(-1);
}
