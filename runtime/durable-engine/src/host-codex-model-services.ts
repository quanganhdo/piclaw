import { getCurrentTools, getCurrentSystemPrompt, normalizeContext, toToolDeclaration } from "@earendil-works/pi-ai";
import type { Api, Model, TranscriptContext } from '@earendil-works/pi-ai';
import type { ModelRuntime } from '../../src/durable-legacy-sdk.js';
import type { CodexOperation, NativeCodexFactories } from './host-codex-model-profile.ts';
import { auditCodexPromptCache, auditCodexTransport } from './host-prompt-cache-audit.js';

type RootProvider = Parameters<ModelRuntime['registerNativeProvider']>[0];
/** Constructor-only host authority. capture must resolve the actual invocation source,
 * never a selected/default conversation. account checks must include auth identity. */
export interface HostCodexAuthority {
  capture(signal: AbortSignal, model: Model<Api>, originalRequestSignal?: AbortSignal): Promise<CodexOperation>;
  assertAccount(operation: CodexOperation): void;
  /** Trusted logical turn and authentication owner; never a model/request option. */
  routingScope(operation: CodexOperation): { turnId: string; accountRef: string | null; provider: object | undefined; requestOnly?: boolean };
  /** Trusted host raw-output sink. Must invoke beforeEffect immediately before each artifact write
   * (including queued writes), and durably retain failed flushes. */
  observe(operation: CodexOperation, response: Response, beforeEffect: () => void): Promise<void>;
  flush(operation: CodexOperation): Promise<void>;
  /** Trusted transport seam for qualification; never accepted in request options. */
  fetch?: typeof globalThis.fetch;
  /** Native application keeps its own coding tools and instructions; transport adaptation remains active. */
  preserveHostTools?: boolean;
}
type RoutingScope = ReturnType<HostCodexAuthority["routingScope"]>;
type RoutingTurn = { model: string; token?: string };
type RoutingSession = { accountRef: string | null; provider: object | undefined; turns: Map<string, RoutingTurn> };
const TURN_STATE_HEADER = "x-codex-turn-state";

export class HostCodexModelServices {
  private readonly routingSessions = new Map<string, RoutingSession>();
  private routingClosed = false;
  constructor(private readonly authority: HostCodexAuthority, private readonly nativeAddon: NativeCodexFactories) {}

  /** Terminal host settlement also retires any foreground Delegate scopes of this operation. */
  releaseTurn(turnId: string): void {
    for (const sessionId of this.routingSessions.keys()) this.releaseRoutingTurn(sessionId, turnId);
  }
  private releaseRoutingTurn(sessionId: string, turnId: string): void {
    const session = this.routingSessions.get(sessionId);
    const turn = session?.turns.get(turnId);
    if (turn) { turn.token = undefined; session!.turns.delete(turnId); }
    if (session && !session.turns.size) this.routingSessions.delete(sessionId);
  }
  /** Routing tokens are process-local hints, never durable recovery authority. */
  dispose(): void {
    this.routingClosed = true;
    for (const session of this.routingSessions.values()) {
      for (const turn of session.turns.values()) turn.token = undefined;
      session.turns.clear();
    }
    this.routingSessions.clear();
  }
  private bindRouting(operation: CodexOperation, model: Model<Api>, scope: RoutingScope) {
    let session = this.routingSessions.get(operation.sessionId);
    if (!session || session.accountRef !== scope.accountRef || session.provider !== scope.provider) {
      if (session) {
        for (const turn of session.turns.values()) turn.token = undefined;
        session.turns.clear();
      }
      session = { accountRef: scope.accountRef, provider: scope.provider, turns: new Map() };
      this.routingSessions.set(operation.sessionId, session);
    }
    const modelKey = JSON.stringify([model.provider, model.id, model.api, model.baseUrl]);
    let turn = session.turns.get(scope.turnId);
    if (!turn || turn.model !== modelKey) {
      if (turn) turn.token = undefined;
      turn = { model: modelKey };
      session.turns.set(scope.turnId, turn);
    }
    const current = () => !this.routingClosed && this.routingSessions.get(operation.sessionId) === session && session.turns.get(scope.turnId) === turn;
    const assertCurrent = () => { if (!current()) throw Error("Codex routing scope changed"); };
    return {
      requestOnly: scope.requestOnly === true,
      headers(input: string | URL | Request, init?: RequestInit): Headers {
        assertCurrent();
        const headers = new Headers(init?.headers ?? (input instanceof Request ? input.headers : undefined));
        // A stale/caller-supplied hint must not cross a turn, conversation or account boundary.
        headers.delete(TURN_STATE_HEADER);
        if (turn.token) headers.set(TURN_STATE_HEADER, turn.token);
        return headers;
      },
      capture(response: Response) {
        assertCurrent();
        const token = response.ok && response.headers.get(TURN_STATE_HEADER);
        if (token && turn.token === undefined) turn.token = token;
      },
      clear: () => {
        if (!current()) return;
        turn.token = undefined;
        session.turns.delete(scope.turnId);
        if (!session.turns.size) this.routingSessions.delete(operation.sessionId);
      },
    };
  }
  /** Call before physical model selection, on the SAME runtime used by dispatch. */
  register(runtime: ModelRuntime, provider: RootProvider): void {
    if (provider.id !== 'openai-codex') throw Error('Wrong Codex provider');
    runtime.registerNativeProvider(provider);
    if (runtime.getRegisteredNativeProvider(provider.id) !== provider) throw Error('Codex registration lost');
  }
  async bind(model: Model<Api>, signal: AbortSignal, originalRequestSignal?: AbortSignal) {
    if (this.routingClosed) throw Error("Codex model services closed");
    // Physical catalog records are mutable; detach source identity before capture awaits.
    const snapshot = structuredClone(model);
    Object.freeze(snapshot.input); Object.freeze(snapshot);
    const operation = await this.authority.capture(signal, snapshot, originalRequestSignal);
    if (this.routingClosed) throw Error("Codex model services closed");
    const check = () => {
      signal.throwIfAborted(); operation.signal.throwIfAborted(); operation.assertCurrent();
      this.authority.assertAccount(operation);
      if (operation.model.provider !== snapshot.provider || operation.model.id !== snapshot.id || operation.model.api !== snapshot.api)
        throw Error('Codex request owner changed');
    };
    check();
    const hooks = this.nativeAddon.createNativeCodexHooks(operation.model) as ReturnType<NativeCodexFactories["createNativeCodexHooks"]> & { tools?(names: string[]): string[] };
    const observesOutput = snapshot.provider === "openai-codex" && snapshot.api === "openai-codex-responses";
    const authority = this.authority;
    const scope = { ...this.authority.routingScope(operation) };
    if (!observesOutput) this.releaseRoutingTurn(operation.sessionId, scope.turnId);
    const routing = observesOutput ? this.bindRouting(operation, snapshot, scope) : undefined;
    const abortRouting = () => routing?.clear();
    const requestSignals = new Set(routing ? [signal, operation.signal] : []);
    for (const requestSignal of requestSignals) {
      requestSignal.addEventListener("abort", abortRouting, { once: true });
      if (requestSignal.aborted) abortRouting();
    }
    let tail = Promise.resolve();
    let closed = false;
    check();
    return {
      options: {
        // Output observation is HTTP-only. Never silently bypass it via websocket/auto.
        ...(observesOutput ? { transport: 'sse' as const } : {}),
        onPayload(payload: unknown, actual: Model<Api>) {
          check();
          if (actual.provider !== snapshot.provider || actual.id !== snapshot.id || actual.api !== snapshot.api) throw Error('Codex payload owner changed');
          let request = hooks.request(payload);
          // Codex auto summaries may contain only encrypted reasoning, leaving
          // no public text for Thoughts. Request the provider's public summary;
          // never decode or display encrypted_content or invent thought text.
          if (observesOutput && request && typeof request === "object" && !Array.isArray(request)) {
            const body = request as Record<string, any>;
            if (body.reasoning?.effort && !["none", "off"].includes(body.reasoning.effort)) {
              request = { ...body, reasoning: { ...body.reasoning, summary: "detailed" } };
            }
          }
          // Fingerprint the final adapted body, not the stored SDK transcript.
          if (observesOutput) auditCodexPromptCache(operation.sessionId, request);
          return request;
        },
        ...(observesOutput ? { fetch: (async (input, init) => {
          check();
          if (closed) throw Error("Codex output closed");
          const request = { ...init, headers: routing!.headers(input, init) };
          auditCodexTransport(operation.sessionId, input, request);
          const response = await (authority.fetch ?? globalThis.fetch)(input, request);
          check();
          auditCodexTransport(operation.sessionId, input, request, response);
          if (closed) throw Error("Codex output closed");
          routing!.capture(response);
          const clone = response.clone();
          tail = tail.then(() => { check(); return authority.observe(operation, clone, check); });
          // Observe concurrently; finish joins before terminal publication.
          void tail.catch(() => {});
          check();
          return response;
        }) as typeof globalThis.fetch } : {}),
      },
      headers(headers: Record<string, string | null>) {
        check();
        const transformed = hooks.headers(Object.fromEntries(Object.entries(headers).map(([k,v]) => [k, v ?? undefined])));
        return { ...headers, ...transformed } as Record<string, string | null>;
      },
      context(context: TranscriptContext): TranscriptContext {
        check();
        // Replay native deltas before profiling: removed tools/sections must not revive.
        const tools = getCurrentTools(context.messages);
        const allowed = !authority.preserveHostTools && hooks.tools && new Set(hooks.tools(tools.map(tool => tool.name)));
        const declarations = tools.filter(tool => authority.preserveHostTools
          ? !["exec_command", "write_stdin", "apply_patch"].includes(tool.name)
          : !allowed || allowed.has(tool.name)).map(toToolDeclaration);
        return normalizeContext({
          systemPrompt: authority.preserveHostTools || operation.profilePrompt === false
            ? getCurrentSystemPrompt(context.messages)
            : hooks.systemPrompt(getCurrentSystemPrompt(context.messages)),
          tools: hooks.toolDeclarations ? hooks.toolDeclarations(declarations) : declarations,
          // Keep actual conversational history, including results for now-removed tools.
          messages: hooks.context(context.messages.filter(message => message.role !== 'system')),
        });
      },
      async finish() {
        closed = true;
        try { await tail; check(); if (observesOutput) await authority.flush(operation); }
        finally {
          for (const requestSignal of requestSignals) requestSignal.removeEventListener("abort", abortRouting);
          if (routing?.requestOnly) routing.clear();
        }
      },
    };
  }
}
