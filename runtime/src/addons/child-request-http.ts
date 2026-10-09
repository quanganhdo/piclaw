import type { FetchFunction } from '@earendil-works/pi-ai';
import { ChildRequestError } from './child-request-scope.js';

/** Trusted HTTP-only, single-send transport. All redirects/retries/subrequests
 * are rejected. Resolves settled only after admission/fetch and every owned
 * response body reader/cancellation finish. No URL, header or provider error is
 * returned in failure diagnostics. Providers bypassing custom fetch are denied
 * by execution-plan qualification, not intercepted by this helper. */
export function createChildRequestHttp(input: {
  fetch: FetchFunction;
  signal: AbortSignal;
  authorise(): void;
  beforeSend(): Promise<void>;
  /** Host-captured exact request endpoint, never a child-controlled URL. */
  endpoint: string;
  maxResponseBytes: number;
}) {
  const upstream = input.fetch, signal = input.signal, authorise = input.authorise;
  const beforeSend = input.beforeSend;
  const endpoint = new URL(input.endpoint).href;
  if (!Number.isSafeInteger(input.maxResponseBytes) || input.maxResponseBytes <= 0) throw new ChildRequestError('unavailable');
  const maxBytes = input.maxResponseBytes;
  const tails = new Set<Promise<void>>();
  const bodies = new Set<() => Promise<void>>();
  let sent = false, finished = false, failed = false, settling: Promise<void> | undefined;
  const check = () => {
    signal.throwIfAborted();
    if (finished) throw new ChildRequestError('unavailable');
    authorise();
  };
  function track(task: Promise<void>) {
    tails.add(task);
    void task.then(() => tails.delete(task), () => { failed = true; tails.delete(task); });
    return task;
  }
  const fetch = (async (request: Parameters<FetchFunction>[0], options?: Parameters<FetchFunction>[1]) => {
    let response: Response;
    let resolveSend!: () => void;
    const sending = new Promise<void>(resolve => { resolveSend = resolve; });
    track(sending);
    try {
      check();
      // Request snapshots URL, headers and request options before admission
      // yields. Never send a caller-owned mutable URL/header/options object.
      const captured = new Request(request, options);
      if (captured.url !== endpoint || sent) throw new ChildRequestError('unavailable');
      const combined = AbortSignal.any([signal, captured.signal]);
      sent = true;
      await beforeSend();
      check(); combined.throwIfAborted();
      response = await upstream(captured, { redirect: 'manual', signal: combined });
      if (response.status >= 300 && response.status < 400) {
        if (response.body) await response.body.cancel();
        throw new ChildRequestError('execution_failed');
      }
      if (!response.body) return response;
      const reader = response.body.getReader();
      let bytes = 0, done = false;
      let resolveBody!: () => void;
      const bodyDone = new Promise<void>(resolve => { resolveBody = resolve; });
      track(bodyDone);
      const end = () => { if (!done) { done = true; combined.removeEventListener('abort', abort); bodies.delete(cancel); resolveBody(); } };
      let cancelTask: Promise<void> | undefined;
      const cancel = () => {
        if (!cancelTask) cancelTask = track(Promise.resolve().then(() => reader.cancel()).catch(() => { failed = true; }).finally(end));
        return cancelTask;
      };
      let controller: ReadableStreamDefaultController<Uint8Array>;
      const abort = () => {
        if (!done) controller.error(new ChildRequestError('cancelled'));
        void cancel();
      };
      bodies.add(cancel);
      const body = new ReadableStream<Uint8Array>({
        start(value) { controller = value; combined.addEventListener('abort', abort, { once: true }); if (combined.aborted) abort(); },
        async pull(value) {
          try {
            if (combined.aborted) throw new ChildRequestError('cancelled');
            const reading = reader.read();
            track(reading.then(() => {}, () => { failed = true; }));
            const result = await reading;
            if (done) return;
            if (result.done) { end(); value.close(); return; }
            if ((bytes += result.value.byteLength) > maxBytes) throw new ChildRequestError('execution_failed');
            value.enqueue(result.value);
          } catch {
            failed = true; value.error(new ChildRequestError(combined.aborted ? 'cancelled' : 'execution_failed')); await cancel();
          }
        },
        cancel,
      }, { highWaterMark: 0 });
      return new Response(body, { status: response.status, statusText: response.statusText, headers: response.headers });
    } catch {
      failed = true;
      throw new ChildRequestError(signal.aborted ? 'cancelled' : 'execution_failed');
    } finally { resolveSend(); }
  }) as FetchFunction;
  fetch.preconnect = () => { throw new ChildRequestError('unavailable'); };
  return {
    fetch,
    /** Call only after the provider's stream/result has ended. New fetches are
     * fenced immediately; raw in-flight fetch and reader tails still drain. */
    finish(): Promise<void> {
      if (settling) return settling;
      finished = true;
      settling = Promise.resolve().then(async () => {
        while (tails.size) {
          await Promise.allSettled([...bodies].map(cancel => cancel()));
          await Promise.allSettled([...tails]);
        }
        if (failed) throw new ChildRequestError('settlement_failed');
      });
      return settling;
    },
    get dispatched() { return sent; },
  };
}
