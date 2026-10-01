import { existsSync, lstatSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { DATA_DIR, getWebRuntimeConfig, getWorkspaceDir } from '../../../core/config.js';
import { readAccessConfig } from '../../../core/config-access.js';
import { DATABASE_ATTACHMENT_MAX_BYTES, UPLOAD_CHUNK_BYTES, UPLOAD_CHUNK_TIMEOUT_MS, isSafeUploadFilename } from '../../../core/upload-limits.js';
import { WorkspaceFileService } from '../workspace/file-service.js';
import { isRealWorkspacePath } from '../workspace/paths.js';
import { createLogger, debugSuppressedError } from '../../../utils/logger.js';
import type { MediaResponseContext } from '../handlers/media.js';

const log = createLogger('web.workspace-attachment-upload');
const files = new WorkspaceFileService();
const activeUploads = new Set<string>();
const MAX_ACTIVE_CHUNKS = 4;
const UPLOAD_ID = /^upload-[a-zA-Z0-9-]{16,90}$/;

/** Bounded body read; cancelling the reader also releases a stalled chunk slot. */
export async function readAttachmentChunk(req: Request, expected: number, timeoutMs = UPLOAD_CHUNK_TIMEOUT_MS): Promise<Uint8Array> {
  const reader = req.body?.getReader();
  if (!reader) throw new Error('Missing upload body');
  const data = new Uint8Array(expected);
  let received = 0;
  let timedOut = false;
  const timer = setTimeout(() => { timedOut = true; void reader.cancel().catch(error => debugSuppressedError(log, 'Upload body cancellation raced stream closure.', error)); }, timeoutMs);
  try {
    while (true) {
      const chunk = await reader.read();
      if (timedOut) throw new Error('Upload chunk timed out');
      if (chunk.done) break;
      if (received + chunk.value.byteLength > expected) {
        await reader.cancel();
        throw new Error('Chunk exceeds expected size');
      }
      data.set(chunk.value, received);
      received += chunk.value.byteLength;
    }
    if (received !== expected) throw new Error('Incomplete upload body');
    return data;
  } finally { clearTimeout(timer); reader.releaseLock(); }
}

/** The client cannot select a destination or overwrite a previous attachment.
 * Its opaque id creates a collision-isolated directory under workspace/uploads. */
export async function handleWorkspaceAttachmentChunk(channel: MediaResponseContext, req: Request): Promise<Response> {
  if (readAccessConfig().mode !== 'single-user') return channel.json({ error: 'Workspace attachments are unavailable in this access mode.' }, 403);
  const key = req.headers.get('X-Upload-Id') || '';
  if (!UPLOAD_ID.test(key)) return channel.json({error:'Invalid upload ID'},400);
  if (activeUploads.has(key)) return channel.json({error:'An upload chunk is already in progress'},409);
  if (activeUploads.size >= MAX_ACTIVE_CHUNKS) return channel.json({error:'Too many simultaneous upload chunks'},429);
  activeUploads.add(key);
  try { return await receiveChunk(channel, req); }
  finally { activeUploads.delete(key); }
}

async function receiveChunk(channel: MediaResponseContext, req: Request): Promise<Response> {
  const uploadId = req.headers.get('X-Upload-Id') || '';
  let filename: string;
  try { filename = decodeURIComponent(req.headers.get('X-File-Name') || ''); } catch { return channel.json({error:'Invalid filename encoding'},400); }
  const indexRaw = req.headers.get('X-Chunk-Index') || '';
  const totalRaw = req.headers.get('X-Chunk-Total') || '';
  const sizeRaw = req.headers.get('X-File-Size') || '';
  if (!isSafeUploadFilename(filename)
    || ![indexRaw,totalRaw,sizeRaw].every(v => /^\d+$/.test(v))) return channel.json({error:'Invalid upload metadata'},400);
  const index=Number(indexRaw), total=Number(totalRaw), size=Number(sizeRaw);
  const max=getWebRuntimeConfig().workspaceUploadLimitMb * 1024 * 1024;
  if (!Number.isSafeInteger(size) || size <= DATABASE_ATTACHMENT_MAX_BYTES || size > max) {
    return channel.json({error:`File size must exceed ${DATABASE_ATTACHMENT_MAX_BYTES/1024/1024} MB and not exceed ${max/1024/1024} MB`,code:'file_too_large'},413);
  }
  if (!Number.isSafeInteger(index) || index < 0 || total !== Math.ceil(size/UPLOAD_CHUNK_BYTES) || index >= total) return channel.json({error:'Invalid chunk sequence'},400);
  const expected=Math.min(UPLOAD_CHUNK_BYTES,size-index*UPLOAD_CHUNK_BYTES);
  // Bound each body before allocation; do not buffer a whole attachment.
  const declared=req.headers.get('content-length');
  if (declared !== null && Number(declared) !== expected) return channel.json({error:'Invalid chunk size'},400);
  let data: Uint8Array;
  try { data = await readAttachmentChunk(req, expected); }
  catch (error) {
    const message = error instanceof Error ? error.message : 'Incomplete upload body';
    const status = message === 'Upload chunk timed out' ? 408 : message === 'Chunk exceeds expected size' ? 413 : 400;
    return channel.json({error:message},status);
  }
  const root=getWorkspaceDir();
  const relative=`uploads/${uploadId}`;
  try {
    for(const path of [join(root,'uploads'),join(root,relative)]){
      try{mkdirSync(path);}catch(error){if((error as NodeJS.ErrnoException).code!=='EEXIST')throw error;}
      if(!lstatSync(path).isDirectory()||lstatSync(path).isSymbolicLink()||!isRealWorkspacePath(path))return channel.json({error:'Unsafe uploads directory'},400);
    }
    // The shared chunk writer uses these private staging paths. Reject symlinks
    // before its synchronous read/append/rename sequence (there are no awaits).
    for (const path of [DATA_DIR, join(DATA_DIR,'workspace-upload-chunks'), join(DATA_DIR,'workspace-upload-chunks',`attachment-${uploadId}`)]) {
      if (existsSync(path) && (lstatSync(path).isSymbolicLink() || !lstatSync(path).isDirectory())) return channel.json({error:'Unsafe upload staging directory'},400);
    }
    for (const name of ['state.json','upload.part']) {
      const path=join(DATA_DIR,'workspace-upload-chunks',`attachment-${uploadId}`,name);
      try { const stat=lstatSync(path); if(stat.isSymbolicLink() || !stat.isFile()) return channel.json({error:'Unsafe upload staging file'},400); }
      catch(error) { if((error as NodeJS.ErrnoException).code!=='ENOENT')throw error; }
    }
    const result=await files.uploadChunk({pathParam:relative,uploadId:`attachment-${uploadId}`,fileName:filename,fileSize:size,chunkIndex:index,chunkTotal:total,data,overwrite:false});
    const body=result.body as Record<string,unknown>;
    if(result.status===200&&body.complete){
      return channel.json({...body,storage:'workspace',filename,size,path:`${relative}/${filename}`},200);
    }
    return channel.json(body,result.status);
  }catch{return channel.json({error:'Could not store workspace attachment'},500);}
}
