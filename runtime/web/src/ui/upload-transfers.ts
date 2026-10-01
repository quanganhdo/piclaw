import { DATABASE_ATTACHMENT_MAX_BYTES, UPLOAD_CHUNK_BYTES, MAX_UPLOAD_BYTES, UPLOAD_CHUNK_TIMEOUT_MS, isSafeUploadFilename } from "../../../src/core/upload-limits.js";

export interface UploadProgress {
  loaded: number;
  total: number;
  percent: number;
  lengthComputable: boolean;
}

export interface UploadBatchProgress {
  current: number;
  total: number;
  name: string;
  itemPercent: number;
  loaded: number;
  totalBytes: number;
  percent: number;
}

export interface UploadedFile<TResult> {
  file: File;
  name: string;
  result: TResult;
}

export interface UploadError extends Error {
  status?: number;
  code?: string;
  payload?: unknown;
}

export interface UploadRequestOptions {
  timeoutMs?: number;
  headers?: Record<string, string | number | null | undefined>;
  onProgress?: (progress: UploadProgress) => void;
}

interface UploadBatchOptions {
  onProgress?: (progress: UploadBatchProgress) => void;
}

interface WorkspaceUploadOptions {
  overwrite?: boolean;
  chunkSize?: number;
  onProgress?: (progress: UploadProgress & { chunkIndex: number; chunkTotal: number }) => void;
}

const MAX_WORKSPACE_UPLOAD_SIZE = 1024 * 1024 * 1024;
const WORKSPACE_UPLOAD_CHUNK_SIZE = 8 * 1024 * 1024;

function parseJson(text: string): unknown {
  if (!text) return {};
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

function createUploadError(message: string, status?: number, payload?: unknown): UploadError {
  const error = new Error(message) as UploadError;
  if (status !== undefined) error.status = status;
  if (payload && typeof payload === "object") {
    const code = (payload as { code?: unknown }).code;
    if (typeof code === "string") error.code = code;
    error.payload = payload;
  }
  return error;
}

function uploadJson(url: string, body: XMLHttpRequestBodyInit, options: UploadRequestOptions = {}): Promise<unknown> {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open("POST", url);
    if (options.timeoutMs) xhr.timeout = options.timeoutMs;
    for (const [key, value] of Object.entries(options.headers || {})) {
      if (value !== undefined && value !== null) xhr.setRequestHeader(key, String(value));
    }
    xhr.upload.onprogress = (event) => {
      if (!options.onProgress) return;
      const total = event.lengthComputable ? event.total : 0;
      const loaded = event.lengthComputable ? Math.min(event.loaded, total) : event.loaded;
      options.onProgress({
        loaded,
        total,
        percent: total > 0 ? Math.round((loaded / total) * 100) : 0,
        lengthComputable: event.lengthComputable,
      });
    };
    xhr.onload = () => {
      const payload = parseJson(xhr.responseText);
      if (xhr.status >= 200 && xhr.status < 300) {
        if (payload === null) {
          reject(createUploadError("Upload returned an invalid response.", xhr.status));
          return;
        }
        resolve(payload);
        return;
      }
      const message = payload && typeof payload === "object" && typeof (payload as { error?: unknown }).error === "string"
        ? String((payload as { error: string }).error)
        : `HTTP ${xhr.status}`;
      reject(createUploadError(message, xhr.status, payload));
    };
    xhr.onerror = () => reject(createUploadError("Upload failed (network error)"));
    xhr.onabort = () => reject(createUploadError("Upload cancelled"));
    xhr.ontimeout = () => reject(createUploadError("Upload timed out"));
    xhr.send(body);
  });
}

function clampPercent(value: unknown): number {
  const percent = Number(value);
  if (!Number.isFinite(percent)) return 0;
  return Math.max(0, Math.min(100, Math.round(percent)));
}

function fileSize(file: File): number {
  const size = Number(file?.size || 0);
  return Number.isFinite(size) && size > 0 ? size : 0;
}

/**
 * Upload files sequentially while preserving each source File/name/result tuple.
 * The aggregate progress contract is shared by compose and workspace surfaces.
 */
export async function uploadFileBatch<TResult>(
  files: Iterable<File> | ArrayLike<File>,
  uploadOne: (file: File, onProgress: (progress: UploadProgress) => void, index: number) => Promise<TResult>,
  options: UploadBatchOptions = {},
): Promise<Array<UploadedFile<TResult>>> {
  const list = Array.from(files as ArrayLike<File>);
  if (list.length === 0) return [];

  const sizes = list.map(fileSize);
  const totalBytes = sizes.reduce((sum, size) => sum + size, 0);
  const uploaded: Array<UploadedFile<TResult>> = [];
  let completedBytes = 0;

  const emit = (index: number, itemPercent: number, currentLoaded: number) => {
    if (!options.onProgress) return;
    const loaded = totalBytes > 0
      ? Math.min(totalBytes, completedBytes + Math.min(sizes[index], Math.max(0, currentLoaded)))
      : 0;
    const percent = totalBytes > 0
      ? Math.round((loaded / totalBytes) * 100)
      : Math.round(((index + (itemPercent / 100)) / list.length) * 100);
    options.onProgress({
      current: index + 1,
      total: list.length,
      name: list[index]?.name || `file ${index + 1}`,
      itemPercent: clampPercent(itemPercent),
      loaded,
      totalBytes,
      percent: clampPercent(percent),
    });
  };

  for (let index = 0; index < list.length; index += 1) {
    const file = list[index];
    emit(index, 0, 0);
    const result = await uploadOne(file, (progress) => {
      const itemRatio = progress.total > 0
        ? progress.loaded / progress.total
        : Number(progress.percent || 0) / 100;
      const boundedRatio = Math.max(0, Math.min(1, Number.isFinite(itemRatio) ? itemRatio : 0));
      const currentLoaded = sizes[index] * boundedRatio;
      emit(index, boundedRatio * 100, currentLoaded);
    }, index);
    completedBytes += sizes[index];
    emit(index, 100, sizes[index]);
    uploaded.push({ file, name: file?.name || `file ${index + 1}`, result });
  }

  return uploaded;
}

/** Upload one compose/media attachment with byte progress. */
export async function uploadMedia(file: File, options: UploadRequestOptions = {}): Promise<{ id: number; [key: string]: unknown }> {
  const formData = new FormData();
  formData.append("file", file);
  const payload = await uploadJson("/media/upload", formData, options);
  const id = payload && typeof payload === "object" ? Number((payload as { id?: unknown }).id) : NaN;
  if (!Number.isInteger(id) || id <= 0) {
    throw createUploadError("Upload returned an invalid media ID.", undefined, payload);
  }
  return { ...(payload as Record<string, unknown>), id };
}

function buildWorkspaceUploadUrl(pathname: string, targetPath = "", options: WorkspaceUploadOptions = {}): string {
  const params = new URLSearchParams();
  if (targetPath) params.set("path", targetPath);
  if (options.overwrite) params.set("overwrite", "1");
  const query = params.toString();
  return query ? `${pathname}?${query}` : pathname;
}

function createWorkspaceUploadId(): string {
  if (globalThis.crypto?.randomUUID) return globalThis.crypto.randomUUID();
  return `upload-${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

/** Upload one workspace file using the existing chunked protocol. */
export async function uploadWorkspaceFile(file: File, targetPath = "", options: WorkspaceUploadOptions = {}): Promise<any> {
  if (file?.size > MAX_WORKSPACE_UPLOAD_SIZE) {
    const sizeMB = (file.size / (1024 * 1024)).toFixed(0);
    const limitMB = (MAX_WORKSPACE_UPLOAD_SIZE / (1024 * 1024)).toFixed(0);
    const error = createUploadError(`File too large (${sizeMB} MB). Maximum upload size is ${limitMB} MB.`);
    error.code = "file_too_large";
    throw error;
  }

  const uploadId = createWorkspaceUploadId();
  const url = buildWorkspaceUploadUrl("/workspace/upload-chunk", targetPath, options);
  const chunkSize = Math.max(1, Math.min(MAX_WORKSPACE_UPLOAD_SIZE, Number(options.chunkSize) || WORKSPACE_UPLOAD_CHUNK_SIZE));
  const totalSize = Math.max(0, Number(file?.size) || 0);
  const chunkTotal = Math.max(1, Math.ceil(totalSize / chunkSize));
  let completedBytes = 0;
  let lastResult: unknown = null;

  for (let chunkIndex = 0; chunkIndex < chunkTotal; chunkIndex += 1) {
    const start = chunkIndex * chunkSize;
    const end = Math.min(totalSize, start + chunkSize);
    const blob = file.slice(start, end);
    const chunkBytes = blob.size;
    lastResult = await uploadJson(url, blob, {
      headers: {
        "X-Upload-Id": uploadId,
        "X-Chunk-Index": chunkIndex,
        "X-Chunk-Total": chunkTotal,
        "X-File-Name": file?.name || "upload.bin",
        "X-File-Size": totalSize,
      },
      onProgress: (progress) => {
        if (!options.onProgress) return;
        const loaded = Math.min(totalSize, completedBytes + (progress.loaded || 0));
        const total = totalSize || 1;
        options.onProgress({
          loaded,
          total,
          percent: Math.round((loaded / total) * 100),
          lengthComputable: progress.lengthComputable,
          chunkIndex,
          chunkTotal,
        });
      },
    });
    completedBytes += chunkBytes;
    if (options.onProgress) {
      const total = totalSize || 1;
      const loaded = totalSize ? completedBytes : total;
      options.onProgress({
        loaded,
        total,
        percent: Math.round((loaded / total) * 100),
        lengthComputable: true,
        chunkIndex: chunkIndex + 1,
        chunkTotal,
      });
    }
  }

  return lastResult;
}

export type ChatUploadResult = { id: number; storage?: 'database'; path?: never } | { storage: 'workspace'; path: string; filename: string; size: number; id?: never };

/** Large chat files use bounded requests and return a workspace reference, not a DB blob. */
export async function uploadChatAttachment(file: File, options: UploadRequestOptions = {}): Promise<ChatUploadResult> {
  if (file.size <= DATABASE_ATTACHMENT_MAX_BYTES) return uploadMedia(file, options);
  if (file.size > MAX_UPLOAD_BYTES) throw createUploadError('File exceeds the maximum upload size (1024 MB).', 413);
  if (!isSafeUploadFilename(file.name)) throw createUploadError('Rename the file: its name is not safe for a workspace upload.');
  const uploadId = 'upload-' + createWorkspaceUploadId().replace(/^upload-/, '');
  const total = Math.ceil(file.size / UPLOAD_CHUNK_BYTES);
  for(let index=0; index<total; index++) {
    const start=index*UPLOAD_CHUNK_BYTES;
    const result=await uploadJson('/media/upload-chunk',file.slice(start,Math.min(file.size,start+UPLOAD_CHUNK_BYTES)),{
      timeoutMs: UPLOAD_CHUNK_TIMEOUT_MS + 10_000,
      headers:{...options.headers,'X-Upload-Id':uploadId,'X-Chunk-Index':index,'X-Chunk-Total':total,'X-File-Name':encodeURIComponent(file.name),'X-File-Size':file.size},
      onProgress:progress=>options.onProgress?.({loaded:start+progress.loaded,total:file.size,percent:Math.round((start+progress.loaded)/file.size*100),lengthComputable:progress.lengthComputable}),
    }) as { complete?:boolean;storage?:string;path?:string;size?:number };
    if(index===total-1) {
      const expectedPath=`uploads/${uploadId}/${file.name}`;
      if(!result?.complete || result.storage!=='workspace' || result.path!==expectedPath || result.size!==file.size) throw createUploadError('Upload did not complete with a valid file reference.');
      options.onProgress?.({loaded:file.size,total:file.size,percent:100,lengthComputable:true});
      return {storage:'workspace',path:expectedPath,filename:file.name,size:file.size};
    }
    if(result?.complete !== false) throw createUploadError('Invalid upload chunk acknowledgement.');
    const loaded=Math.min(file.size,(index+1)*UPLOAD_CHUNK_BYTES);
    options.onProgress?.({loaded,total:file.size,percent:Math.round(loaded/file.size*100),lengthComputable:true});
  }
  throw createUploadError('Incomplete upload.');
}
