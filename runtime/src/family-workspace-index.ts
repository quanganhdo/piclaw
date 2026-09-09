import fs from 'node:fs/promises';
import { constants } from 'node:fs';
import path from 'node:path';
import { getDb } from './db/connection.js';
import { workspaceIndexAccess,WorkspaceIndexAccessDenied } from './core/workspace-index-access.js';
import type { WorkspaceIndexStatus,WorkspaceSearchScope,WorkspaceSearchResult,WorkspaceSearchRow } from './core/workspace-index-types.js';
import { extractFtsFallbackTerms,isFtsOperatorQuery,prepareFtsQuery } from './utils/fts-query.js';
import { getSearchMatchMode } from './core/config.js';

const active=new Set<string>();
export function familyWorkspaceScope(scope?:string):WorkspaceSearchScope {
  if(scope===undefined||scope==='all')return 'all';
  if(scope==='notes'||scope==='skills')return scope;
  throw new WorkspaceIndexAccessDenied();
}
const rootsOf=(scope:WorkspaceSearchScope)=>scope==='notes'?['notes/family']:scope==='skills'?['.pi/skills']:['notes/family','.pi/skills'];
const prefixOf=(scope:WorkspaceSearchScope)=>scope==='notes'?'notes/family/%':scope==='skills'?'.pi/skills/%':null;
const inside=(name:string,roots:string[])=>roots.some(root=>name.startsWith(root+'/'));
const extensions=new Set(['.md','.txt','.ts','.tsx','.js','.jsx','.json','.yaml','.yml','.sh','.csv','.xml','.toml']);
function context(){
  const access=workspaceIndexAccess();if(access.mode!=='family-shared')throw new WorkspaceIndexAccessDenied();
  const db=getDb();let denied=false;return {...access,db,validate:()=>{access.validate();if(denied||getDb()!==db){denied=true;throw new WorkspaceIndexAccessDenied();}}};
}
export function familyWorkspaceIndexStatus(scope?:string):WorkspaceIndexStatus {
  const ctx=context(),selected=familyWorkspaceScope(scope),roots=rootsOf(selected);ctx.validate();
  const row=ctx.db.query('SELECT * FROM family_workspace_index_status WHERE scope=?').get(selected) as {state:'ready'|'stale';last_indexed_at:string|null;indexed_file_count:number;updated_at:string}|null;
  return {scope:selected,state:active.has(ctx.workspace)?'indexing':row?.state??'never_indexed',last_indexed_at:row?.last_indexed_at??null,last_error:null,indexed_file_count:row?.indexed_file_count??0,roots,updated_at:row?.updated_at??null};
}
export function staleFamilyWorkspaceIndex(params?:{scope?:string;paths?:string[]}):WorkspaceSearchScope[] {
  const ctx=context();const paths=params?.paths?.map(name=>path.relative(ctx.workspace,path.resolve(ctx.workspace,name)).split(path.sep).join('/'));
  const scopes=paths?.length?(['notes','skills','all'] as const).filter(scope=>paths.some(name=>inside(name,rootsOf(scope)))):[familyWorkspaceScope(params?.scope)];
  ctx.db.transaction(()=>{ctx.validate();if(scopes.length)ctx.db.query('UPDATE family_workspace_index_generation SET revision=revision+1 WHERE id=1').run();for(const scope of scopes){ctx.validate();ctx.db.query("UPDATE family_workspace_index_status SET state='stale',updated_at=? WHERE scope=?").run(new Date().toISOString(),scope);}}).immediate();return [...scopes];
}

/** Stage a bounded snapshot, then replace just its family scope in one transaction. */
export async function refreshFamilyWorkspaceIndex(params?:{scope?:string;max_kb?:number}):Promise<WorkspaceIndexStatus> {
  const ctx=context(),scope=familyWorkspaceScope(params?.scope),roots=rootsOf(scope),started=performance.now();
  if(active.has(ctx.workspace))throw new Error('Family workspace refresh already active.');
  const generation=(ctx.db.query('SELECT revision FROM family_workspace_index_generation WHERE id=1').get() as {revision:number}|null)?.revision;
  if(!Number.isSafeInteger(generation))throw new WorkspaceIndexAccessDenied();
  const maxBytes=Math.min(2048,Math.max(16,Number.isFinite(params?.max_kb)?params!.max_kb!:512))*1024;
  const rows:Array<{name:string;content:string;mtime:number;size:number}>=[];let bytes=0,entries=0;
  const check=()=>{ctx.validate();if(performance.now()-started>30000)throw new Error('Family index refresh exceeded its time limit.');};
  async function walk(directory:string,depth:number):Promise<void>{
    check();if(depth>16)throw new Error('Family index depth limit exceeded.');
    let stat;try{stat=await fs.lstat(directory);}catch(error){check();if((error as NodeJS.ErrnoException).code==='ENOENT')return;throw error;}check();
    if(!stat.isDirectory()||stat.isSymbolicLink())return;
    const canonical=await fs.realpath(directory);check();if(canonical!==directory)return;
    const directoryHandle=await fs.opendir(directory);
    try{check();for(;;){
      const entry=await directoryHandle.read();check();if(!entry)break;
      check();if(++entries>20000)throw new Error('Family index entry limit exceeded.');
      const full=path.join(directory,entry.name);
      if(entry.isDirectory()){
        if(['node_modules','.git','.cache','generated'].includes(entry.name))continue;
        await walk(full,depth+1);check();continue;
      }
      if(!entry.isFile()||!extensions.has(path.extname(entry.name).toLowerCase()))continue;
      const real=await fs.realpath(full);check();if(real!==full)continue;
      const handle=await fs.open(full,constants.O_RDONLY|constants.O_NOFOLLOW|constants.O_NONBLOCK);
      try{
        check();const before=await handle.stat();check();if(!before.isFile()||before.nlink!==1||before.size>maxBytes)continue;
        if(rows.length>=2000||bytes+before.size>32*1024*1024)throw new Error('Family index byte/file limit exceeded.');
        const buffer=Buffer.alloc(before.size+1);let size=0;
        while(size<buffer.length){check();const chunk=await handle.read(buffer,size,buffer.length-size,null);check();if(!chunk.bytesRead)break;size+=chunk.bytesRead;}
        const after=await handle.stat();check();
        if(size!==before.size||after.size!==before.size||after.mtimeMs!==before.mtimeMs||after.ctimeMs!==before.ctimeMs||after.nlink!==1)throw new Error('Family index source changed during read.');
        const name=path.relative(ctx.workspace,full).split(path.sep).join('/');if(!inside(name,roots))throw new WorkspaceIndexAccessDenied();
        rows.push({name,content:new TextDecoder('utf-8',{fatal:true}).decode(buffer.subarray(0,size)),mtime:Math.round(after.mtimeMs),size});bytes+=size;
      }finally{await handle.close();}
    }}finally{await directoryHandle.close();}
  }
  active.add(ctx.workspace);
  try{
    for(const root of roots){await walk(path.resolve(ctx.workspace,root),0);check();}
    ctx.db.transaction(()=>{
      check();const prefix=prefixOf(scope);
      if(ctx.db.query('UPDATE family_workspace_index_generation SET revision=revision+1 WHERE id=1 AND revision=?').run(generation!).changes!==1)throw new Error('Family index refresh superseded by a source change or another refresh.');
      if(prefix){ctx.db.query('DELETE FROM family_workspace_fts WHERE path LIKE ?').run(prefix);ctx.db.query('DELETE FROM family_workspace_files WHERE path LIKE ?').run(prefix);}
      else{ctx.db.exec('DELETE FROM family_workspace_fts; DELETE FROM family_workspace_files;');}
      const now=new Date().toISOString();
      for(const row of rows){check();ctx.db.query('INSERT INTO family_workspace_fts(content,path,mtime_ms,size_bytes) VALUES (?,?,?,?)').run(row.content,row.name,row.mtime,row.size);ctx.db.query('INSERT INTO family_workspace_files VALUES (?,?,?,?)').run(row.name,row.mtime,row.size,now);}
      // A partial refresh invalidates the aggregate status; no legacy status row is consulted.
      if(scope!=='all')ctx.db.query("UPDATE family_workspace_index_status SET state='stale',updated_at=? WHERE scope='all'").run(now);
      for(const selected of scope==='all'?['notes','skills','all'] as const:[scope]){
        ctx.db.query(`INSERT INTO family_workspace_index_status VALUES (?,'ready',?,?,?) ON CONFLICT(scope) DO UPDATE SET state='ready',last_indexed_at=excluded.last_indexed_at,indexed_file_count=excluded.indexed_file_count,updated_at=excluded.updated_at`).run(selected,now,rows.filter(row=>inside(row.name,rootsOf(selected))).length,now);
      }
      check();
    }).immediate();
  }finally{active.delete(ctx.workspace);}
  return familyWorkspaceIndexStatus(scope);
}

export function searchFamilyWorkspaceIndex(query:string,scope:WorkspaceSearchScope,limit:number,offset:number):WorkspaceSearchResult {
  const ctx=context(),prefix=prefixOf(familyWorkspaceScope(scope)),filter=prefix?' AND path LIKE ?':" AND (path LIKE 'notes/family/%' OR path LIKE '.pi/skills/%')",filterArgs=prefix?[prefix]:[];
  const fts=prepareFtsQuery(query,getSearchMatchMode());if(!fts)return {rows:[],limit,offset,error:'Query is empty after sanitization.'};
  try{ctx.validate();const rows=ctx.db.query(`SELECT path,size_bytes,mtime_ms,snippet(family_workspace_fts,0,'[',']','…',12) as snippet FROM family_workspace_fts WHERE family_workspace_fts MATCH ?${filter} ORDER BY bm25(family_workspace_fts) LIMIT ? OFFSET ?`).all(fts,...filterArgs,limit,offset) as WorkspaceSearchRow[];ctx.validate();return {rows,limit,offset};}
  catch(error){ctx.validate();if(error instanceof WorkspaceIndexAccessDenied)throw error;
    // Operational/schema errors must not silently turn into a different query.
    if((error as {code?:string})?.code!=='SQLITE_ERROR'||!/fts5: syntax error|unterminated string|malformed MATCH expression|fts5: (?:unterminated|unknown special query)/i.test(String((error as Error)?.message)))return {rows:[],limit,offset,error:'Workspace search failed.'};
    const terms=extractFtsFallbackTerms(query,{dropFtsKeywords:isFtsOperatorQuery(query)}).map(term=>`%${term}%`);if(!terms.length)return {rows:[],limit,offset,error:'No searchable terms.'};
    try{ctx.validate();const rows=ctx.db.query(`SELECT path,size_bytes,mtime_ms,substr(content,1,200) as snippet FROM family_workspace_fts WHERE ${terms.map(()=>"content LIKE ? COLLATE NOCASE").join(' AND ')}${filter} ORDER BY path LIMIT ? OFFSET ?`).all(...terms,...filterArgs,limit,offset) as WorkspaceSearchRow[];ctx.validate();return {rows,limit,offset};}
    catch(error){ctx.validate();if(error instanceof WorkspaceIndexAccessDenied)throw error;return {rows:[],limit,offset,error:'Workspace search failed (invalid query?).'};}
  }
}
