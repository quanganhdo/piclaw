import type { AgentSession, SessionContext, SessionEntry, SessionManager } from "@earendil-works/pi-coding-agent";
import type { ImageContent, TextContent, ThinkingContent, ToolCall } from "@earendil-works/pi-ai";

type CustomMessageContent = Parameters<SessionManager["appendCustomMessageEntry"]>[1];

type MaybePromise<T> = T | Promise<T>;

/** Public 0.87.1 context-edit payload; the pinned 0.85.1 manager has no append method yet. */
export type ContextEditReplacement = { content: string | (TextContent | ImageContent | ThinkingContent | ToolCall)[] } | null;

export interface SessionEntryAppendPort {
  appendMessage(message: Parameters<SessionManager["appendMessage"]>[0]): Promise<string>;
  appendThinkingLevelChange(thinkingLevel: string): Promise<string>;
  appendModelChange(provider: string, modelId: string): Promise<string>;
  appendCompaction(
    summary: string,
    firstKeptEntryId: string | null,
    tokensBefore: number,
    details?: unknown,
    fromHook?: boolean,
  ): Promise<string>;
  appendSessionInfo(name: string): Promise<string>;
  appendCustomMessageEntry(customType: string, content: CustomMessageContent, display: boolean, details?: unknown): Promise<string>;
  appendCustomEntry(customType: string, data?: unknown): Promise<string>;
  appendContextEdit?(targetId: string, replacement: ContextEditReplacement): Promise<string>;
}

export interface SessionPersistencePort extends SessionEntryAppendPort {
  getLeafId(): Promise<string | null>;
  getEntries(): Promise<SessionEntry[]>;
  getBranch(leafId?: string | null): Promise<SessionEntry[]>;
  buildContext(): Promise<SessionContext>;
  getSessionFile(): Promise<string | null>;
  getSessionName(): Promise<string | null>;
  dispose(): Promise<void>;
}

export interface SessionManagerLike {
  getLeafId(): MaybePromise<string | null>;
  getEntries(): MaybePromise<SessionEntry[]>;
  getBranch(leafId?: string | null): MaybePromise<SessionEntry[]>;
  buildSessionContext(): MaybePromise<SessionContext>;
  getSessionFile(): MaybePromise<string | undefined>;
  getSessionName(): MaybePromise<string | undefined>;
  appendMessage(message: Parameters<SessionManager["appendMessage"]>[0]): MaybePromise<string>;
  appendThinkingLevelChange(thinkingLevel: string): MaybePromise<string>;
  appendModelChange(provider: string, modelId: string): MaybePromise<string>;
  appendCompaction(summary: string, firstKeptEntryId: string | null, tokensBefore: number, details?: unknown, fromHook?: boolean): MaybePromise<string>;
  appendSessionInfo(name: string): MaybePromise<string>;
  appendCustomMessageEntry(customType: string, content: CustomMessageContent, display: boolean, details?: unknown): MaybePromise<string>;
  appendCustomEntry(customType: string, data?: unknown): MaybePromise<string>;
  appendContextEdit?: (targetId: string, replacement: ContextEditReplacement) => MaybePromise<string>;
}

export function createSessionManagerPersistencePort(
  sessionManager: SessionManagerLike,
  options: { dispose?: () => MaybePromise<void> } = {},
): SessionPersistencePort {
  let disposePromise: Promise<void> | null = null;
  return {
    getLeafId: async () => await sessionManager.getLeafId(),
    getEntries: async () => [...await sessionManager.getEntries()],
    getBranch: async (leafId) => [...await sessionManager.getBranch(leafId)],
    buildContext: async () => await sessionManager.buildSessionContext(),
    getSessionFile: async () => (await sessionManager.getSessionFile())?.trim() || null,
    getSessionName: async () => (await sessionManager.getSessionName())?.trim() || null,
    appendMessage: async (message) => await sessionManager.appendMessage(message),
    appendThinkingLevelChange: async (thinkingLevel) => await sessionManager.appendThinkingLevelChange(thinkingLevel),
    appendModelChange: async (provider, modelId) => await sessionManager.appendModelChange(provider, modelId),
    appendCompaction: async (summary, firstKeptEntryId, tokensBefore, details, fromHook) => await sessionManager.appendCompaction(summary, firstKeptEntryId, tokensBefore, details, fromHook),
    appendSessionInfo: async (name) => await sessionManager.appendSessionInfo(name),
    appendCustomMessageEntry: async (customType, content, display, details) => await sessionManager.appendCustomMessageEntry(customType, content, display, details),
    appendCustomEntry: async (customType, data) => await sessionManager.appendCustomEntry(customType, data),
    ...(typeof sessionManager.appendContextEdit === "function"
      ? { appendContextEdit: async (targetId: string, replacement: ContextEditReplacement) =>
          await sessionManager.appendContextEdit!(targetId, replacement) }
      : {}),
    dispose: async () => {
      disposePromise ??= Promise.resolve().then(async () => { await options.dispose?.(); });
      await disposePromise;
    },
  };
}

export function getSessionPersistencePort(
  session: Pick<AgentSession, "sessionManager">,
  options?: { dispose?: () => MaybePromise<void> },
): SessionPersistencePort {
  return createSessionManagerPersistencePort(session.sessionManager as unknown as SessionManagerLike, options);
}
