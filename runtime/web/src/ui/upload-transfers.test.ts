import { afterEach, beforeEach, describe, expect, test } from 'bun:test';

import {
  uploadFileBatch,
  uploadMedia,
  uploadWorkspaceFile,
  type UploadProgress,
} from './upload-transfers.js';

type RequestPlan = {
  status?: number;
  payload?: unknown;
  responseText?: string;
  progress?: { loaded: number; total: number; lengthComputable?: boolean };
  inspect?: (xhr: FakeXMLHttpRequest, body: XMLHttpRequestBodyInit) => void;
};

class FakeXMLHttpRequest {
  static plans: RequestPlan[] = [];

  method = '';
  url = '';
  status = 0;
  responseText = '';
  headers = new Map<string, string>();
  upload: { onprogress: ((event: ProgressEvent) => void) | null } = { onprogress: null };
  onload: (() => void) | null = null;
  onerror: (() => void) | null = null;
  onabort: (() => void) | null = null;
  ontimeout: (() => void) | null = null;

  open(method: string, url: string) {
    this.method = method;
    this.url = url;
  }

  setRequestHeader(key: string, value: string) {
    this.headers.set(key, value);
  }

  send(body: XMLHttpRequestBodyInit) {
    const plan = FakeXMLHttpRequest.plans.shift();
    if (!plan) throw new Error('Missing FakeXMLHttpRequest plan');
    plan.inspect?.(this, body);
    queueMicrotask(() => {
      if (plan.progress) {
        this.upload.onprogress?.({
          loaded: plan.progress.loaded,
          total: plan.progress.total,
          lengthComputable: plan.progress.lengthComputable ?? true,
        } as ProgressEvent);
      }
      this.status = plan.status ?? 200;
      this.responseText = plan.responseText ?? JSON.stringify(plan.payload ?? {});
      this.onload?.();
    });
  }
}

const originalXMLHttpRequest = globalThis.XMLHttpRequest;

beforeEach(() => {
  FakeXMLHttpRequest.plans = [];
  globalThis.XMLHttpRequest = FakeXMLHttpRequest as unknown as typeof XMLHttpRequest;
});

afterEach(() => {
  globalThis.XMLHttpRequest = originalXMLHttpRequest;
});

describe('uploadFileBatch', () => {
  test('preserves each source file/name/result tuple and aggregates byte progress', async () => {
    const first = new File(['1234'], 'first.txt', { type: 'text/plain' });
    const second = new File(['123456'], 'second.txt', { type: 'text/plain' });
    const seenProgress: number[] = [];

    const uploaded = await uploadFileBatch(
      [first, second],
      async (file, onProgress, index) => {
        onProgress({
          loaded: file.size / 2,
          total: file.size,
          percent: 50,
          lengthComputable: true,
        });
        return { id: 100 + index };
      },
      { onProgress: (progress) => seenProgress.push(progress.percent) },
    );

    expect(uploaded).toEqual([
      { file: first, name: 'first.txt', result: { id: 100 } },
      { file: second, name: 'second.txt', result: { id: 101 } },
    ]);
    expect(uploaded[0].file).toBe(first);
    expect(uploaded[1].file).toBe(second);
    expect(seenProgress).toContain(20);
    expect(seenProgress).toContain(70);
    expect(seenProgress.at(-1)).toBe(100);
  });

  test('stops the batch immediately when one upload fails', async () => {
    const files = [
      new File(['a'], 'one.txt'),
      new File(['b'], 'two.txt'),
      new File(['c'], 'three.txt'),
    ];
    const attempted: string[] = [];

    await expect(uploadFileBatch(files, async (file, _onProgress, index) => {
      attempted.push(file.name);
      if (index === 1) throw new Error('synthetic failure');
      return { id: index + 1 };
    })).rejects.toThrow('synthetic failure');

    expect(attempted).toEqual(['one.txt', 'two.txt']);
  });
});

describe('uploadMedia', () => {
  test('rejects a successful response that has no valid media ID', async () => {
    FakeXMLHttpRequest.plans.push({ status: 200, payload: { ok: true } });

    await expect(uploadMedia(new File(['data'], 'invalid.txt')))
      .rejects.toThrow('invalid media ID');
  });

  test('retains server status, code, and message on upload failure', async () => {
    FakeXMLHttpRequest.plans.push({
      status: 409,
      payload: { error: 'Already exists', code: 'file_exists' },
    });

    try {
      await uploadMedia(new File(['data'], 'duplicate.txt'));
      throw new Error('Expected uploadMedia to reject');
    } catch (error: any) {
      expect(error.message).toBe('Already exists');
      expect(error.status).toBe(409);
      expect(error.code).toBe('file_exists');
    }
  });
});

describe('uploadWorkspaceFile', () => {
  test('keeps the chunk protocol and reports cumulative byte progress', async () => {
    const file = new File(['0123456789'], 'ten.txt');
    const requests: Array<{ url: string; chunkIndex: string; bytes: number }> = [];
    const progress: UploadProgress[] = [];

    for (let index = 0; index < 3; index += 1) {
      FakeXMLHttpRequest.plans.push({
        status: 200,
        payload: index === 2 ? { path: 'target/ten.txt' } : { complete: false },
        progress: { loaded: index === 2 ? 2 : 4, total: index === 2 ? 2 : 4 },
        inspect: (xhr, body) => requests.push({
          url: xhr.url,
          chunkIndex: xhr.headers.get('X-Chunk-Index') || '',
          bytes: (body as Blob).size,
        }),
      });
    }

    const result = await uploadWorkspaceFile(file, 'target', {
      chunkSize: 4,
      onProgress: (event) => progress.push(event),
    });

    expect(requests).toEqual([
      { url: '/workspace/upload-chunk?path=target', chunkIndex: '0', bytes: 4 },
      { url: '/workspace/upload-chunk?path=target', chunkIndex: '1', bytes: 4 },
      { url: '/workspace/upload-chunk?path=target', chunkIndex: '2', bytes: 2 },
    ]);
    expect(progress.some((event) => event.percent === 40)).toBe(true);
    expect(progress.some((event) => event.percent === 80)).toBe(true);
    expect(progress.at(-1)?.percent).toBe(100);
    expect(result).toEqual({ path: 'target/ten.txt' });
  });
});
