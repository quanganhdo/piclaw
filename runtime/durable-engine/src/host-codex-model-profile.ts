/** Structural host contract. Supply factories from the source-qualified addon catalog.
 * Core never resolves addon packages or worktree source. */
export interface CodexModel {
  provider: string; id: string; api: string; input?: readonly string[];
}
export interface CodexOperation {
  readonly id: string; readonly sessionId: string; readonly cwd: string;
  readonly model: CodexModel; readonly signal: AbortSignal;
  /** Maintenance requests retain their own system policy, not the coding-agent prompt. */
  readonly profilePrompt?: boolean;
  assertCurrent(): void;
}
export interface NativeCodexHooks {
  request(payload: unknown): unknown;
  toolDeclarations?<T extends { name: string }>(tools: readonly T[]): T[];
  headers(headers: Record<string, string | undefined>): Record<string, string | undefined>;
  context<T extends { role: string; customType?: string }>(messages: readonly T[]): T[];
  systemPrompt(prompt: string, shell?: string): string;
}
export interface NativeCodexFactories {
  createNativeCodexHooks(model: CodexModel): NativeCodexHooks;
}
