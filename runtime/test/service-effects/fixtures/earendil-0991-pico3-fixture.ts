import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { BACKGROUND_CONTEXT } from "@earendil-works/chord/context";
import { fauxAssistantMessage, fauxProvider, type AssistantMessageEvent } from "@earendil-works/pi-ai";
import { Harness, JsonlStorage, MemoryStorage, type HarnessOptions, type Models } from "@earendil-works/pi-agent-core/experimental/pico3";

export const picoContext = BACKGROUND_CONTEXT;

export function controlledPicoModels(blocked = false) {
  const model = fauxProvider().getModel();
  let release!: () => void;
  const gate = new Promise<void>(resolve => { release = resolve; });
  let started!: () => void;
  const arrival = new Promise<void>(resolve => { started = resolve; });
  let calls = 0;
  let aborts = 0;
  let settled = 0;
  const models: Models = {
    resolve: ref => ref.provider === model.provider && ref.modelId === model.id ? model : undefined,
    async *stream(_model, _request, context): AsyncIterable<AssistantMessageEvent> {
      calls++;
      started();
      try {
      const message = fauxAssistantMessage("pico fixture answer", { api: model.api, provider: model.provider, model: model.id });
      yield { type: "start", partial: message };
      if (blocked) await new Promise<void>((resolve, reject) => {
        const abort = () => { aborts++; reject(context.abortSignal?.reason ?? new Error("aborted")); };
        if (context.abortSignal?.aborted) return abort();
        context.abortSignal?.addEventListener("abort", abort, { once: true });
        void gate.then(() => { context.abortSignal?.removeEventListener("abort", abort); resolve(); });
      });
      context.abortSignal?.throwIfAborted();
      yield { type: "done", reason: "stop", message };
      } finally { settled++; }
    },
    async fetchDeferred() { throw new Error("Fixture has no deferred provider"); },
    async cancelDeferred() { throw new Error("Fixture has no deferred provider"); },
  };
  return { models, modelRef: { provider: model.provider, modelId: model.id }, arrival, release: () => release(), calls: () => calls, aborts: () => aborts, settled: () => settled };
}

export async function openPicoFixture(backend: "Memory" | "JSONL", provider = controlledPicoModels()) {
  const root = await mkdtemp(join(tmpdir(), "piclaw-0991-pico3-"));
  const reports: unknown[] = [];
  const options: HarnessOptions = {
    models: provider.models,
    root: { rewindable: { model: provider.modelRef } },
    now: () => 1_700_000_000_000,
    onReport: error => reports.push(error),
  };
  let harness: Harness | undefined;
  const open = async () => {
    const storage = backend === "Memory" ? new MemoryStorage() : await JsonlStorage.open(root, { fsync: false });
    try {
      harness = await boundedPicoWait(Harness.open(storage, options, picoContext));
      return { harness, conversation: await boundedPicoWait(harness.root(picoContext)) };
    } catch (error) {
      provider.release();
      try { await boundedPicoWait(harness?.close(picoContext) ?? Promise.resolve()); }
      finally { await boundedPicoWait(storage.close(picoContext)); }
      throw error;
    }
  };
  try {
    const opened = await open();
    return {
      ...opened, provider, reports,
      async reopen() {
        if (backend !== "JSONL") throw new Error("Reopen requires JSONL");
        await boundedPicoWait(harness?.close(picoContext) ?? Promise.resolve());
        return open();
      },
      async cleanup() {
        provider.release();
        try { await boundedPicoWait(harness?.close(picoContext) ?? Promise.resolve()); }
        finally { await rm(root, { recursive: true, force: true }); }
      },
    };
  } catch (error) {
    await rm(root, { recursive: true, force: true });
    throw error;
  }
}

export async function boundedPicoWait<T>(promise: Promise<T>): Promise<T> {
  let timeout!: ReturnType<typeof setTimeout>;
  try {
    return await Promise.race([promise, new Promise<never>((_, reject) => {
      timeout = setTimeout(() => reject(new Error("Pico fixture timed out")), 2_000);
    })]);
  } finally { clearTimeout(timeout); }
}
