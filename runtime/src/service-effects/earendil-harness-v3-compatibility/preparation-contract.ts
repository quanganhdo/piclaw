import type { PiclawExecutionAuthority } from "../contracts/execution-context-resolver.js";

/**
 * Inert structural record of the public Harness v3 boundary first published in
 * pi-agent-core 0.85.0. Production remains on 0.84.4. Replace these shapes with
 * direct public imports when a corrected 0.85.1 or later family is selected.
 */

export interface EarendilV3ContextKeyShape<T> {
  readonly token: symbol;
  readonly valueType?: (value: T) => T;
}

export interface EarendilV3ContextShape {
  readonly abortSignal: AbortSignal | undefined;
  value<T>(key: EarendilV3ContextKeyShape<T>): T | undefined;
  toString(): string;
}

export type EarendilV3ResultShape<TValue, TError> =
  | { readonly ok: true; readonly value: TValue }
  | { readonly ok: false; readonly error: TError };

export type EarendilV3JsonValueShape =
  | null
  | boolean
  | number
  | string
  | EarendilV3JsonValueShape[]
  | { readonly [key: string]: EarendilV3JsonValueShape };

export interface EarendilV3ToolInvocationShape {
  readonly invocationId: string;
  readonly operationId: string;
  readonly turnId: string;
  getMemo(name: string): Promise<EarendilV3JsonValueShape | undefined>;
  setMemo(name: string, value: EarendilV3JsonValueShape | undefined): Promise<void>;
}

export interface EarendilV3ToolResultShape<TDetails = unknown> {
  readonly content: readonly unknown[];
  readonly details: TDetails;
  readonly usage?: EarendilV3UsageShape;
  readonly addedToolNames?: readonly string[];
  readonly terminate?: boolean;
}

export type EarendilV3ToolUpdateShape<TDetails = unknown> = (
  partialResult: EarendilV3ToolResultShape<TDetails>,
  options?: Readonly<{ checkpoint?: true }>,
) => void;

export type EarendilV3ToolExecuteShape<TParameters, TDetails = unknown> = (
  toolCallId: string,
  params: TParameters,
  onUpdate: EarendilV3ToolUpdateShape<TDetails>,
  toolContext: EarendilV3PiclawToolContextShape,
  invocation: EarendilV3ToolInvocationShape,
  context: EarendilV3ContextShape,
) => Promise<EarendilV3ToolResultShape<TDetails>>;

export type EarendilV3ShellOutputRetentionShape = "head" | "tail";

export interface EarendilV3ShellOutputLimitsShape {
  readonly maxBytes: number;
  readonly maxLines: number;
  readonly retain?: EarendilV3ShellOutputRetentionShape;
}

export interface EarendilV3ShellOutputMetadataShape {
  readonly truncation: Readonly<{
    readonly truncated: boolean;
    readonly truncatedBy: "bytes" | "lines" | null;
    readonly totalBytes: number;
    readonly totalLines: number;
    readonly outputBytes: number;
    readonly outputLines: number;
    readonly lastLinePartial: boolean;
    readonly firstLineExceedsLimit: boolean;
    readonly maxBytes: number;
    readonly maxLines: number;
  }>;
  readonly spillPath?: string;
  readonly lastLineBytes?: number;
}

export interface EarendilV3ShellOutputViewShape extends EarendilV3ShellOutputMetadataShape {
  readonly text: string;
}

export type EarendilV3ShellOutputUpdateShape =
  | { readonly kind: "replace"; readonly output: EarendilV3ShellOutputViewShape }
  | { readonly kind: "append"; readonly text: string; readonly metadata: EarendilV3ShellOutputMetadataShape }
  | { readonly kind: "slide"; readonly drop: number; readonly text: string; readonly metadata: EarendilV3ShellOutputMetadataShape }
  | { readonly kind: "metadata"; readonly metadata: EarendilV3ShellOutputMetadataShape };

export interface EarendilV3ShellExecOptionsShape {
  readonly cwd?: string;
  readonly env?: Readonly<Record<string, string>>;
  readonly inheritEnv?: boolean;
  readonly timeout?: number;
  readonly capture?: Readonly<{
    readonly limits: EarendilV3ShellOutputLimitsShape;
    readonly spill?: boolean;
  }>;
  readonly onUpdate?: (update: EarendilV3ShellOutputUpdateShape, context: EarendilV3ContextShape) => void;
}

export interface EarendilV3FileInfoShape {
  readonly name: string;
  readonly path: string;
  readonly kind: "file" | "directory" | "symlink";
  readonly size: number;
  readonly mtimeMs: number;
}

export interface EarendilV3FileErrorShape extends Error {
  readonly code: "aborted" | "not_found" | "permission_denied" | "not_directory" | "is_directory" | "invalid" | "not_supported" | "unknown";
  readonly path?: string;
}

export interface EarendilV3ExecutionErrorShape extends Error {
  readonly code: "aborted" | "timeout" | "shell_unavailable" | "spawn_error" | "callback_error" | "unknown";
}

export interface EarendilV3FileSystemShape {
  readonly cwd: string;
  absolutePath(path: string, context: EarendilV3ContextShape): Promise<EarendilV3ResultShape<string, EarendilV3FileErrorShape>>;
  joinPath(parts: string[], context: EarendilV3ContextShape): Promise<EarendilV3ResultShape<string, EarendilV3FileErrorShape>>;
  readTextFile(path: string, context: EarendilV3ContextShape): Promise<EarendilV3ResultShape<string, EarendilV3FileErrorShape>>;
  readTextLines(path: string, options: { readonly maxLines?: number } | undefined, context: EarendilV3ContextShape): Promise<EarendilV3ResultShape<string[], EarendilV3FileErrorShape>>;
  readBinaryFile(path: string, context: EarendilV3ContextShape): Promise<EarendilV3ResultShape<Uint8Array, EarendilV3FileErrorShape>>;
  writeFile(path: string, content: string | Uint8Array, context: EarendilV3ContextShape): Promise<EarendilV3ResultShape<void, EarendilV3FileErrorShape>>;
  appendFile(path: string, content: string | Uint8Array, context: EarendilV3ContextShape): Promise<EarendilV3ResultShape<void, EarendilV3FileErrorShape>>;
  renameFile(sourcePath: string, destinationPath: string, context: EarendilV3ContextShape): Promise<EarendilV3ResultShape<void, EarendilV3FileErrorShape>>;
  fileInfo(path: string, context: EarendilV3ContextShape): Promise<EarendilV3ResultShape<EarendilV3FileInfoShape, EarendilV3FileErrorShape>>;
  listDir(path: string, context: EarendilV3ContextShape): Promise<EarendilV3ResultShape<EarendilV3FileInfoShape[], EarendilV3FileErrorShape>>;
  canonicalPath(path: string, context: EarendilV3ContextShape): Promise<EarendilV3ResultShape<string, EarendilV3FileErrorShape>>;
  exists(path: string, context: EarendilV3ContextShape): Promise<EarendilV3ResultShape<boolean, EarendilV3FileErrorShape>>;
  createDir(path: string, options: { readonly recursive?: boolean } | undefined, context: EarendilV3ContextShape): Promise<EarendilV3ResultShape<void, EarendilV3FileErrorShape>>;
  remove(path: string, options: { readonly recursive?: boolean; readonly force?: boolean } | undefined, context: EarendilV3ContextShape): Promise<EarendilV3ResultShape<void, EarendilV3FileErrorShape>>;
  createTempDir(prefix: string | undefined, context: EarendilV3ContextShape): Promise<EarendilV3ResultShape<string, EarendilV3FileErrorShape>>;
  createTempFile(options: { readonly prefix?: string; readonly suffix?: string } | undefined, context: EarendilV3ContextShape): Promise<EarendilV3ResultShape<string, EarendilV3FileErrorShape>>;
  cleanup(context: EarendilV3ContextShape): Promise<void>;
}

export interface EarendilV3ExecutionEnvShape extends EarendilV3FileSystemShape {
  exec(command: string, options: EarendilV3ShellExecOptionsShape | undefined, context: EarendilV3ContextShape): Promise<EarendilV3ResultShape<EarendilV3ShellExecResultShape, EarendilV3ExecutionErrorShape>>;
}

export interface EarendilV3PiclawToolContextShape extends PiclawExecutionAuthority {
  readonly env: EarendilV3ExecutionEnvShape;
  readonly localEnv: EarendilV3ExecutionEnvShape;
}

export interface EarendilV3ShellExecResultShape extends EarendilV3ShellOutputMetadataShape {
  readonly exitCode: number;
}

export interface EarendilV3UsageShape {
  readonly input: number;
  readonly output: number;
  readonly cacheRead: number;
  readonly cacheWrite: number;
  readonly cacheWrite1h?: number;
  readonly reasoning?: number;
  readonly totalTokens: number;
  readonly cost: Readonly<{
    readonly input: number;
    readonly output: number;
    readonly cacheRead: number;
    readonly cacheWrite: number;
    readonly total: number;
  }>;
}

export interface EarendilV3UsageRowShape {
  readonly id: string;
  readonly seq: number;
  readonly usage: EarendilV3UsageShape;
  readonly entryId?: string;
  readonly adjustment: boolean;
  readonly details?: EarendilV3JsonValueShape;
}

export type EarendilV3UsageEventShape = Readonly<{
  type: "usage";
  lane: string;
  row: EarendilV3UsageRowShape;
  totals: EarendilV3UsageShape;
}>;

export type EarendilV3ProjectionInputShape =
  | EarendilV3UsageEventShape
  | Readonly<{ type: "message_update"; runId: string; message: unknown; frame?: unknown }>
  | Readonly<{ type: "tool_start"; runId: string; turnId: string; toolCallId: string; toolName: string; args: unknown }>
  | Readonly<{ type: "tool_update"; runId: string; turnId: string; toolCallId: string; toolName: string; partialResult: EarendilV3ToolResultShape }>
  | Readonly<{ type: "tool_end"; runId: string; turnId: string; toolCallId: string; toolName: string; result: EarendilV3ToolResultShape; isError: boolean; terminate: boolean }>
  | Readonly<{ type: "operation_abort"; operationId: string }>;

export interface PiclawV3ProjectionEnvelopeShape extends PiclawExecutionAuthority {
  readonly harnessOperationId: string;
  readonly watchGeneration: number;
  readonly receiptSeq: number;
  readonly event: EarendilV3ProjectionInputShape;
}

export interface EarendilV3MemorySessionRepoOptionsShape {
  readonly now?: () => number;
}

export interface EarendilV3JsonlSessionRepoOptionsShape {
  readonly fileSystem: EarendilV3FileSystemShape;
  readonly sessionsRoot: string;
  readonly now?: () => number;
}

export interface EarendilV3SessionRepoShape<TMetadata, TCreateOptions, TListOptions, TForkOptions, TSession> {
  create(options: TCreateOptions, context: EarendilV3ContextShape): Promise<TSession>;
  open(metadata: TMetadata, context: EarendilV3ContextShape): Promise<TSession>;
  list(options: TListOptions | undefined, context: EarendilV3ContextShape): Promise<TMetadata[]>;
  delete(metadata: TMetadata, context: EarendilV3ContextShape): Promise<void>;
  fork(metadata: TMetadata, options: TForkOptions, context: EarendilV3ContextShape): Promise<TSession>;
}

export interface EarendilV3HarnessActivationBlockShape {
  watchSession(context: EarendilV3ContextShape): Promise<never>;
}

export interface EarendilV3SelectionGateShape {
  readonly productionVersion: "0.84.4";
  readonly assessedVersion: "0.85.0";
  readonly assessedReleaseCommit: "107d79f11072bbc8a3a757ed7fd69596bee7d68c";
  readonly nextCandidate: "corrected_0.85.1_or_later";
  readonly packageClosure: "fresh_coding_agent_root_import_must_resolve_pi_server_transitively";
  readonly directPiServerWorkaround: "forbidden";
  readonly watchSession: "must_be_implemented_or_explicitly_excluded";
  readonly harnessActivation: "blocked";
  readonly productionImporter: "forbidden";
}
