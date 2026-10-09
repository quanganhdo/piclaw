import { randomUUID } from 'node:crypto';
import type { AssistantMessageEvent, AssistantMessageEventStream, Context, Model, Api, SimpleStreamOptions } from '@earendil-works/pi-ai';
import { createAssistantMessageEventStream } from '@earendil-works/pi-ai/utils/event-stream';
import { getBudgetWorkContext } from './context.js';
import { getBudgetWork } from '../db/budget-limits.js';
import { getDb } from '../db/connection.js';
import { boundHostRequestCost } from './request-cost-bound.js';
import { modelRequestAccounting } from './model-request-accounting.js';
import { createChildRequestScope, type PreparedChildExecution } from '../addons/child-request-scope.js';
import type { BudgetProviderEvidence, BudgetWorkContext } from './types.js';

/** Trusted policy captured for each real model invocation, including tool-loop
 * turns and retries. No default plan: unsupported auth/provider/task settlement
 * must deny before a send. Capture must not perform credential/network work. */
export interface SharedModelRequestPlan {
  model: Model<Api>;
  accountRef: string;
  maxTokens: number;
  documentedFree: boolean;
  deadlineAt: number;
  providerEvidence?: BudgetProviderEvidence[];
  authorise(): void;
  prepare(context: Context, signal: AbortSignal): Promise<PreparedChildExecution>;
}
export interface SharedModelRequestHost {
  capture(model: Model<Api>, context: Context, options: SimpleStreamOptions | undefined,
    work: Readonly<BudgetWorkContext>): SharedModelRequestPlan;
}
/** Inactive public StreamFn adapter usable by main/side/compaction callers once
 * their actual provider host is qualified. Captures current work at invocation,
 * reserves every call separately and tags terminal usage with its host ID before
 * any existing session recorder sees it. It never installs itself on a session. */
export function sharedModelRequestBoundary(host: SharedModelRequestHost):
  (model: Model<Api>, context: Context, options?: SimpleStreamOptions) => AssistantMessageEventStream {
  return (requestedModel, context, options) => {
    const output = createAssistantMessageEventStream();
    const workContext = getBudgetWorkContext();
    const originalSignal = options?.signal ?? new AbortController().signal;
    const originalOptions = options ? { ...options, signal: originalSignal } : undefined;
    const id = randomUUID();
    let model = requestedModel;
    const failure = () => {
      const message = { role: 'assistant' as const, content: [], api: model.api, provider: model.provider, model: model.id,
        stopReason: originalSignal.aborted ? 'aborted' as const : 'error' as const,
        timestamp: Date.now(), errorMessage: 'Model request could not complete safely.',
        usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 0,
          cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } } };
      output.push({ type: 'error', reason: message.stopReason, error: message }); output.end(message);
    };
    const run = async () => {
      if (!workContext) throw Error('Model request work is unavailable.');
      const database = getDb();
      const requested = structuredClone(requestedModel), capturedContext = structuredClone(context);
      const work = Object.freeze({ ...workContext });
      const plan = host.capture(structuredClone(requested), structuredClone(capturedContext), originalOptions, work);
      model = structuredClone(plan.model);
      if (model.provider !== requested.provider || model.id !== requested.id) throw Error('Model request substitution denied.');
      const maxTokens = plan.maxTokens, documentedFree = plan.documentedFree, deadlineAt = plan.deadlineAt;
      const capturedWork = getBudgetWork(work.workId, database);
      if (!capturedWork || capturedWork.chat_jid !== work.chatJid || capturedWork.execution_kind !== work.kind) throw Error('Model request work changed.');
      const signal = originalSignal;
      const cost = boundHostRequestCost(model, maxTokens, documentedFree);
      if (cost.reason === 'invalid_limits') throw Error('Model request limits unavailable.');
      const binding = { id, workId: work.workId, chatJid: work.chatJid, providerId: model.provider, modelId: model.id,
        accountRef: plan.accountRef, amountMicros: cost.amountMicros };
      const authorise = plan.authorise;
      const prepare = plan.prepare;
      const accounting = modelRequestAccounting({ authorise, documentedFree, providerEvidence: plan.providerEvidence }, database);
      const scope = createChildRequestScope({
        plan: { version: 1, execution: 'parent-provider-proxy', model: { provider: model.provider, id: model.id }, mcp: 'none' },
        signal, deadlineAt, authorise,
        validate(value) { return { context: value, options: { maxTokens } }; },
        binding() { return binding; }, reserve: accounting.reserve, dispatch: accounting.dispatch,
        async abandon(request) { await accounting.abandon(request); },
        async settle(request, terminal) {
          const row = await accounting.settle(request, terminal.type === 'done' ? terminal.message : terminal.error);
          if (row.state !== 'settled') throw Error('Model request charge is unresolved.');
        },
        prepare: (capturedContext, _request, requestSignal) => prepare(capturedContext, requestSignal),
      });
      try {
        const request = scope.stream(capturedContext, {}, { requestId: id, signal });
        // Do not expose a terminal before durable settlement: otherwise the
        // existing usage recorder could charge first and conflict with the hold.
        let terminal: Extract<AssistantMessageEvent, { type: 'done' | 'error' }> | undefined;
        for await (const event of request) {
          if (event.type === 'done' || event.type === 'error') terminal = event;
          else output.push(event);
        }
        await request.settled;
        if (!terminal) throw Error('Model request terminal unavailable.');
        const message = terminal.type === 'done' ? terminal.message : terminal.error;
        Object.assign(message.usage, { invocationId: id });
        await scope.close();
        originalSignal.throwIfAborted(); authorise(); originalSignal.throwIfAborted();
        output.push(terminal); output.end(message);
      } finally { await scope.close(); }
    };
    void run().catch(failure);
    return output;
  };
}
