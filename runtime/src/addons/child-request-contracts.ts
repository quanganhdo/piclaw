import type { AssistantMessageEvent, Context, ThinkingLevel } from '@earendil-works/pi-ai';

/** Versioned proposal for the parent-executed child-provider proxy.
 * Auth, route, work, account and budget identities never come from IPC frames.
 * Runtime registration/implementation is qualified separately. */
export interface ChildRequestOptionsV1 {
  temperature?: number;
  maxTokens?: number;
  reasoning?: ThinkingLevel;
}
export interface ChildRequestPlanV1 {
  version: 1;
  execution: 'parent-provider-proxy';
  model: { provider: string; id: string };
  mcp: 'none';
}
export interface ChildRequestStreamV1 extends AsyncIterable<AssistantMessageEvent> {
  /** Raw provider/auth tails and usage settlement have finished, not just terminal delivery. */
  settled: Promise<void>;
  cancel(): void;
}
export interface ChildRequestScopeV1 {
  readonly plan: Readonly<ChildRequestPlanV1>;
  stream(context: Context, options: ChildRequestOptionsV1, request: { requestId: string; signal?: AbortSignal }): ChildRequestStreamV1;
  /** Stop admission/output, cancel active work, await raw tails and settlement. */
  close(): Promise<void>;
}
export interface ChildRequestsApiV1 {
  version: 1;
  /** Startup owning add-on registration, never arbitrary wire owner IDs. */
  register(): {
    /** Capture current admitted invocation/work and independently validate the selected model. */
    createScope(input: { model: { provider: string; id: string }; signal: AbortSignal; deadlineAt: number; requireMcp?: boolean }): ChildRequestScopeV1;
  };
}
