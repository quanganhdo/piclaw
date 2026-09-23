import fs from 'node:fs/promises';
import { constants, lstatSync, realpathSync } from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
export const NOTE_LIMITS = Object.freeze({ fileBytes: 512*1024, files: 2000, sourceBytes: 32*1024*1024, entries: 20000, depth: 16, chunks: 16384, contentBytes: 32*1024*1024, elapsedMs: 30000, reconcileMs: 300000 });
export class NoteSourceExcluded extends Error { constructor(readonly code: string) { super(code); } }
export class NoteScanLimited extends Error { constructor() { super('limit_exceeded'); } }
export class NoteSourceUnstable extends Error { constructor() { super('source_unavailable'); } }
export function admittedNotePath(name: string): boolean {
  const parts = name.split('/');
  return !name.includes('\\') && !name.includes('\0') && parts[0] === 'notes' && parts.length > 1
    && !['users','family'].includes(parts[1]) && parts.every(p => p && p !== '.' && p !== '..' && !p.startsWith('.') && !['node_modules','generated'].includes(p)) && name.endsWith('.md');
}
const identity = (s: {dev:number;ino:number}) => `${s.dev}:${s.ino}`;
function ancestors(workspace: string, relative: string): string[] {
  const parts = relative.split('/').slice(0,-1); const marks: string[] = [];
  for (let i=1;i<=parts.length;i++) { const p=path.join(workspace,...parts.slice(0,i)); const stat=lstatSync(p); if(!stat.isDirectory()||stat.isSymbolicLink()||realpathSync(p)!==p)throw new NoteSourceExcluded('link_or_path'); marks.push(identity(stat)); }
  return marks;
}
export interface VerifiedNote { bytes: Buffer; revision: string; verify: () => void }
export async function readNote(workspace: string, relative: string, check: () => void): Promise<VerifiedNote> {
  check(); if(!admittedNotePath(relative))throw new NoteSourceExcluded('path');
  const full=path.join(workspace,relative), parents=ancestors(workspace,relative), named=lstatSync(full);
  if(!named.isFile()||named.isSymbolicLink()||named.nlink!==1)throw new NoteSourceExcluded('link_or_type');
  if(named.size>NOTE_LIMITS.fileBytes)throw new NoteSourceExcluded('file_too_large');
  const handle=await fs.open(full,constants.O_RDONLY|constants.O_NOFOLLOW|constants.O_NONBLOCK);check();
  try {
    const before=await handle.stat();check();
    if(!before.isFile()||before.nlink!==1||identity(before)!==identity(named))throw new NoteSourceUnstable();
    const bytes=Buffer.alloc(before.size+1);let used=0;
    while(used<bytes.length){const r=await handle.read(bytes,used,bytes.length-used,null);check();if(!r.bytesRead)break;used+=r.bytesRead;}
    const after=await handle.stat();check();
    const same=(stat:typeof before)=>identity(stat)===identity(before)&&stat.nlink===1&&stat.size===before.size&&stat.mtimeMs===before.mtimeMs&&stat.ctimeMs===before.ctimeMs;
    const verify=()=>{check();if(!same(lstatSync(full))||JSON.stringify(ancestors(workspace,relative))!==JSON.stringify(parents))throw new NoteSourceUnstable();};
    if(used!==before.size||!same(after))throw new NoteSourceUnstable();verify();
    const bounded=bytes.subarray(0,used);return {bytes:bounded,revision:createHash('sha256').update(bounded).digest('hex'),verify};
  } finally {await handle.close();}
}
/** Bounded streaming walk; failure/limits never imply that unseen paths were deleted. */
export async function walkNotes(workspace: string, check: () => void, visit: (relative: string) => Promise<void>): Promise<void> {
  let entries=0,files=0;const root=path.join(workspace,'notes');
  async function walk(directory:string,depth:number):Promise<void>{
    check();if(depth>NOTE_LIMITS.depth)throw new NoteScanLimited();
    let stat;try{stat=lstatSync(directory);}catch(error){if(directory===root&&(error as NodeJS.ErrnoException).code==='ENOENT')return;throw error;}
    if(!stat.isDirectory()||stat.isSymbolicLink()||realpathSync(directory)!==directory)throw new NoteSourceExcluded('link_or_path');
    const id=identity(stat);const dir=await fs.opendir(directory);check();
    try {for(;;){const entry=await dir.read();check();if(!entry)break;if(++entries>NOTE_LIMITS.entries)throw new NoteScanLimited();
      if(entry.name.startsWith('.')||['node_modules','generated'].includes(entry.name)||(directory===root&&['users','family'].includes(entry.name)))continue;
      const full=path.join(directory,entry.name),relative=path.relative(workspace,full).split(path.sep).join('/');
      if(entry.isSymbolicLink()){if(entry.name.endsWith('.md'))await visit(relative);continue;}
      if(entry.isDirectory())await walk(full,depth+1);
      else if(entry.name.endsWith('.md')){if(++files>NOTE_LIMITS.files)throw new NoteScanLimited();await visit(relative);}
      check();if(identity(lstatSync(directory))!==id)throw new NoteSourceUnstable();
    }}finally{await dir.close();}
  }
  await walk(root,0);
}
