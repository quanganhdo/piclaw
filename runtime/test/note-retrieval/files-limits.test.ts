import {expect,test} from 'bun:test';
import {mkdirSync,writeFileSync,truncateSync} from 'node:fs';
import fs from 'node:fs/promises';
import {join} from 'node:path';
import {createTempWorkspace} from '../helpers.js';
import {readNote,walkNotes,NOTE_LIMITS,NoteSourceExcluded} from '../../src/note-retrieval/files.js';

test('same-inode growth after lstat is rejected before allocating or reading enlarged file and closes handle',async()=>{
 const ws=createTempWorkspace('note-growth-');mkdirSync(join(ws.workspace,'notes'));const file=join(ws.workspace,'notes/a.md');writeFileSync(file,'tiny');
 const open=fs.open;let reads=0,closed=false;
 fs.open=(async(...args:any[])=>{
  const handle=await (open as any)(...args);
  truncateSync(file,NOTE_LIMITS.fileBytes+1);
  const read=handle.read.bind(handle),close=handle.close.bind(handle);
  handle.read=(...values:any[])=>{reads++;return read(...values);};
  handle.close=async()=>{closed=true;return close();};
  return handle;
 }) as typeof fs.open;
 try{await expect(readNote(ws.workspace,'notes/a.md',()=>{})).rejects.toBeInstanceOf(NoteSourceExcluded);expect(reads).toBe(0);expect(closed).toBe(true);}
 finally{fs.open=open;ws.cleanup();}
});

test('post-opendir admission failure closes the directory before unwinding',async()=>{
 const ws=createTempWorkspace('note-opendir-');mkdirSync(join(ws.workspace,'notes'));
 const open=fs.opendir;let opened=false,closed=false,visits=0;
 fs.opendir=(async(...args:any[])=>{
  const dir=await (open as any)(...args);opened=true;
  const close=dir.close.bind(dir);dir.close=async()=>{closed=true;return close();};return dir;
 }) as typeof fs.opendir;
 try{await expect(walkNotes(ws.workspace,()=>{if(opened)throw Error('revoked');},async()=>{visits++;})).rejects.toThrow('revoked');expect(closed).toBe(true);expect(visits).toBe(0);}
 finally{fs.opendir=open;ws.cleanup();}
});
