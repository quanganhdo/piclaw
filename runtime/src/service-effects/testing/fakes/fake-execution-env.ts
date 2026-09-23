import {
  DEFAULT_MAX_BYTES,
  DEFAULT_MAX_LINES,
  ExecutionError,
  FileError,
  Result,
  sanitizeBinaryOutput,
  truncateHead,
  truncateTail,
  type Context,
  type ExecutionEnv,
  type FileInfo,
  type Result as ResultValue,
  type ShellExecOptions,
  type ShellExecResult,
  type ShellOutputMetadata,
} from "@earendil-works/pi-agent-core";

export type FakeShellStep =
  | { readonly _tag: "result"; readonly stdout: string; readonly stderr: string; readonly exitCode: number }
  | { readonly _tag: "error"; readonly error: ExecutionError }
  | { readonly _tag: "disconnect"; readonly afterSubmission: boolean }
  | { readonly _tag: "wait_for_stop"; readonly started: () => void; readonly release: Promise<void> };

export class FakeExecutionEnv implements ExecutionEnv {
  readonly cwd: string;
  readonly routeId: string;
  readonly files = new Map<string, Uint8Array>();
  readonly symlinks = new Map<string, string>();
  readonly shellSteps: FakeShellStep[] = [];
  readonly observedShellEnvironments: Array<Record<string, string> | undefined> = [];
  readonly observedContexts: Context[] = [];
  readonly ownedGroups = new Set<number>();
  readonly killedGroups: number[] = [];
  cleanupCalls = 0;
  throwCleanup = false;
  rejectAllFiles = false;
  rejectAllFilesWithThrow = false;
  private nextGroup = 1;
  private cleaned = false;
  private readonly ownedGroupStops = new Map<number, () => void>();

  constructor(cwd: string, routeId = "local", private readonly defaultShellEnvironment: Readonly<Record<string, string>> = {}) {
    this.cwd = normaliseAbsolute(cwd);
    this.routeId = routeId;
  }

  putText(path: string, value: string): void { this.files.set(this.resolve(path), new TextEncoder().encode(value)); }
  link(path: string, target: string): void { this.symlinks.set(this.resolve(path), target); }
  script(...steps: readonly FakeShellStep[]): void { this.shellSteps.push(...steps); }

  absolutePath(path: string, context: Context) { return this.file(path, context, () => this.resolve(path)); }
  joinPath(parts: string[], context: Context) { return this.file(undefined, context, () => normaliseAbsolute(parts.join("/"))); }
  openTextLineReader(path: string, context: Context) { return this.file(path, context, () => {
    const addressed = this.resolve(path);
    if (this.cleaned) throw new FileError('aborted','environment cleaned up',addressed); const bytes = this.files.get(addressed);
    if (!bytes) throw new FileError('not_found', 'not found', addressed);
    const text = new TextDecoder().decode(bytes);
    const lines = text.split('\n').map((value, index, values) => ({ text: value, terminated: index < values.length - 1 }));
    if (text.endsWith('\n') || text === '') lines.pop();
    let position = 0, closed = false;
    return Object.freeze({
      readLine: async (readContext: Context): Promise<ResultValue<{text:string;terminated:boolean}|undefined,FileError>> => {
        this.observedContexts.push(readContext);
        if (readContext.abortSignal?.aborted || this.cleaned) return Result.err(new FileError('aborted','aborted',addressed));
        if (closed) return Result.err(new FileError('invalid','reader closed',addressed));
        if (this.rejectAllFiles) {
          if (this.rejectAllFilesWithThrow) throw new Error('backend rejection');
          return Result.err(new FileError('unknown','fake reader fault',addressed));
        }
        return Result.ok(lines[position++]);
      },
      close: async (closeContext: Context): Promise<void> => { this.observedContexts.push(closeContext); closed = true; },
    });
  }); }
  readTextFile(path: string, context: Context) { return this.file(path, context, () => {
    const addressed = this.resolve(path); const bytes = this.files.get(addressed);
    if (!bytes) throw new FileError("not_found", "not found", addressed);
    return new TextDecoder().decode(bytes);
  }); }
  readTextLines(path: string, options: { maxLines?: number } | undefined, context: Context) { return this.file(path, context, () => {
    const addressed = this.resolve(path); const bytes = this.files.get(addressed);
    if (!bytes) throw new FileError("not_found", "not found", addressed);
    return new TextDecoder().decode(bytes).split(/\r?\n/).slice(0, options?.maxLines);
  }); }
  readBinaryFile(path: string, context: Context) { return this.file(path, context, () => {
    const addressed = this.resolve(path); const bytes = this.files.get(addressed);
    if (!bytes) throw new FileError("not_found", "not found", addressed);
    return new Uint8Array(bytes);
  }); }
  writeFile(path: string, content: string | Uint8Array, context: Context) { return this.file(path, context, () => {
    this.files.set(this.resolve(path), typeof content === "string" ? new TextEncoder().encode(content) : new Uint8Array(content));
  }); }
  appendFile(path: string, content: string | Uint8Array, context: Context) { return this.file(path, context, () => {
    const addressed = this.resolve(path); const existing = this.files.get(addressed) ?? new Uint8Array(); const next = typeof content === "string" ? new TextEncoder().encode(content) : content;
    const combined = new Uint8Array(existing.length + next.length); combined.set(existing); combined.set(next, existing.length); this.files.set(addressed, combined);
  }); }
  renameFile(source: string, destination: string, context: Context) { return this.file(source, context, () => {
    const from = this.resolve(source); const bytes = this.files.get(from); if (!bytes) throw new FileError("not_found", "not found", from);
    this.files.delete(from); this.files.set(this.resolve(destination), bytes);
  }); }
  fileInfo(path: string, context: Context): Promise<ResultValue<FileInfo, FileError>> { return this.file(path, context, () => {
    const addressed = this.resolve(path);
    if (this.symlinks.has(addressed)) return info(addressed, "symlink", 0);
    const bytes = this.files.get(addressed); if (bytes) return info(addressed, "file", bytes.length);
    if (this.isDirectory(addressed)) return info(addressed, "directory", 0);
    throw new FileError("not_found", "not found", addressed);
  }); }
  listDir(path: string, context: Context): Promise<ResultValue<FileInfo[], FileError>> { return this.file(path, context, () => {
    const directory = this.resolve(path).replace(/\/$/, "");
    if (!this.isDirectory(directory)) throw new FileError("not_directory", "not directory", directory);
    const children = new Map<string, FileInfo>();
    for (const [file, bytes] of this.files) if (file.startsWith(`${directory}/`)) { const direct = file.slice(directory.length + 1).split("/")[0]; const child = `${directory}/${direct}`; children.set(child, info(child, child === file ? "file" : "directory", child === file ? bytes.length : 0)); }
    for (const link of this.symlinks.keys()) if (link.startsWith(`${directory}/`) && !link.slice(directory.length + 1).includes("/")) children.set(link, info(link, "symlink", 0));
    return [...children.values()];
  }); }
  canonicalPath(path: string, context: Context) { return this.file(path, context, () => {
    const addressed = this.resolve(path); const target = this.symlinks.get(addressed); if (!target) {
      if (!this.files.has(addressed) && !this.isDirectory(addressed)) throw new FileError("not_found", "not found", addressed);
      return addressed;
    }
    return target.startsWith("/") ? normaliseAbsolute(target) : normaliseAbsolute(`${addressed.slice(0, addressed.lastIndexOf("/"))}/${target}`);
  }); }
  exists(path: string, context: Context) { return this.file(path, context, () => { const addressed = this.resolve(path); return this.files.has(addressed) || this.symlinks.has(addressed) || this.isDirectory(addressed); }); }
  createDir(path: string, options: { recursive?: boolean } | undefined, context: Context) { return this.file(path, context, () => { this.files.set(`${this.resolve(path)}/.dir`, new Uint8Array()); }); }
  remove(path: string, options: { recursive?: boolean; force?: boolean } | undefined, context: Context) { return this.file(path, context, () => {
    const addressed = this.resolve(path); const existed = this.files.delete(addressed) || this.symlinks.delete(addressed);
    if (options?.recursive) for (const file of [...this.files.keys()]) if (file.startsWith(`${addressed}/`)) this.files.delete(file);
    if (!existed && !options?.force && !options?.recursive) throw new FileError("not_found", "not found", addressed);
  }); }
  createTempDir(prefix: string | undefined, context: Context) { return this.file(undefined, context, () => `${this.cwd}/${prefix ?? "tmp-"}dir`); }
  createTempFile(options: { prefix?: string; suffix?: string } | undefined, context: Context) { return this.file(undefined, context, () => {
    const path = `${this.cwd}/${options?.prefix ?? ""}file${options?.suffix ?? ""}`; this.files.set(path, new Uint8Array()); return path;
  }); }

  async exec(command: string, options: ShellExecOptions | undefined, context: Context): Promise<ResultValue<ShellExecResult, ExecutionError>> {
    this.observedContexts.push(context);
    if (context.abortSignal?.aborted) return Result.err(new ExecutionError("aborted", "aborted"));
    if (this.cleaned) return Result.err(new ExecutionError("unknown", "execution environment has been cleaned up"));
    const observedEnvironment = { ...(options?.inheritEnv === false ? {} : this.defaultShellEnvironment), ...(options?.env ?? {}) };
    this.observedShellEnvironments.push(Object.keys(observedEnvironment).length > 0 ? observedEnvironment : undefined);
    const group = this.nextGroup++; this.ownedGroups.add(group);
    let resolveStopped!: () => void;
    const stopped = new Promise<void>((resolve) => { resolveStopped = resolve; });
    const stop = () => {
      if (this.ownedGroups.delete(group)) this.killedGroups.push(group);
      this.ownedGroupStops.delete(group);
      resolveStopped();
    };
    this.ownedGroupStops.set(group, stop);
    const onAbort = () => stop(); context.abortSignal?.addEventListener("abort", onAbort, { once: true });
    const step = this.shellSteps.shift() ?? { _tag: "result", stdout: command, stderr: "", exitCode: 0 };
    try {
      if (step._tag === "wait_for_stop") {
        step.started();
        let timedOut = false; let timer: Timer | undefined;
        if (options?.timeout) timer = setTimeout(() => { timedOut = true; stop(); }, options.timeout * 1000);
        try { await Promise.race([step.release, stopped]); } finally { if (timer) clearTimeout(timer); }
        this.ownedGroups.delete(group);
        this.ownedGroupStops.delete(group);
        if (timedOut) return Result.err(new ExecutionError("timeout", `timeout:${options?.timeout}`));
        if (context.abortSignal?.aborted) return Result.err(new ExecutionError("aborted", "aborted"));
        return Result.err(new ExecutionError("unknown", "stopped"));
      }
      this.ownedGroups.delete(group);
      this.ownedGroupStops.delete(group);
      if (step._tag === "error") return Result.err(step.error);
      if (step._tag === "disconnect") return Result.err(new ExecutionError(step.afterSubmission ? "unknown" : "spawn_error", step.afterSubmission ? "Remote execution acknowledgement was lost." : "Remote execution was not submitted."));
      const output = sanitizeBinaryOutput(`${step.stdout}${step.stderr}`);
      const view = captureOutput(output, options);
      if (options?.capture?.spill && view.metadata.truncation.truncated) {
        const spillPath = `${this.cwd}/fake-shell-${group}.log`;
        this.files.set(spillPath, new TextEncoder().encode(output));
        view.metadata = { ...view.metadata, spillPath };
      }
      try { options?.onUpdate?.({ kind: "replace", output: { text: view.text, ...view.metadata } }, context); }
      catch (error) {
        const cause = error instanceof Error ? error : new Error(String(error));
        return Result.err(new ExecutionError("callback_error", cause.message, cause));
      }
      return Result.ok({ exitCode: step.exitCode, ...view.metadata });
    } catch (error) {
      stop();
      const cause = error instanceof Error ? error : new Error(String(error));
      return Result.err(new ExecutionError("unknown", "Scripted execution failed.", cause));
    } finally {
      context.abortSignal?.removeEventListener("abort", onAbort);
      this.ownedGroups.delete(group);
      this.ownedGroupStops.delete(group);
    }
  }

  async cleanup(context: Context): Promise<void> {
    this.observedContexts.push(context);
    if (this.cleaned) return;
    this.cleaned = true;
    this.cleanupCalls += 1;
    for (const group of [...this.ownedGroups]) this.ownedGroupStops.get(group)?.();
    if (this.throwCleanup) throw new Error("cleanup fault");
  }

  private async file<T>(path: string | undefined, context: Context, run: () => T): Promise<ResultValue<T, FileError>> {
    this.observedContexts.push(context);
    const addressed = path ? this.resolve(path) : undefined;
    if (context.abortSignal?.aborted) return Result.err(new FileError("aborted", "aborted", addressed));
    if (this.rejectAllFiles) {
      if (this.rejectAllFilesWithThrow) throw new Error("backend rejection");
      return Result.err(new FileError("unknown", "fake filesystem fault", addressed));
    }
    try { return Result.ok(run()); } catch (error) { return Result.err(error instanceof FileError ? error : new FileError("unknown", "fake filesystem fault", addressed, error as Error)); }
  }
  private resolve(path: string): string { return path.startsWith("/") ? normaliseAbsolute(path) : normaliseAbsolute(`${this.cwd}/${path}`); }
  private isDirectory(path: string): boolean { return path === this.cwd || [...this.files.keys(), ...this.symlinks.keys()].some((entry) => entry.startsWith(`${path.replace(/\/$/, "")}/`)); }
}

function normaliseAbsolute(path: string): string {
  const parts: string[] = [];
  for (const part of path.split("/")) { if (!part || part === ".") continue; if (part === "..") parts.pop(); else parts.push(part); }
  return `/${parts.join("/")}`;
}
function info(path: string, kind: FileInfo["kind"], size: number): FileInfo { return Object.freeze({ name: path.slice(path.lastIndexOf("/") + 1), path, kind, size, mtimeMs: 0 }); }

function captureOutput(output: string, options: ShellExecOptions | undefined): { text: string; metadata: ShellOutputMetadata } {
  const limits = options?.capture?.limits ?? { maxBytes: DEFAULT_MAX_BYTES, maxLines: DEFAULT_MAX_LINES };
  const truncated = limits.retain === "head" ? truncateHead(output, limits) : truncateTail(output, limits);
  const { content: text, ...truncation } = truncated;
  return { text, metadata: { truncation, ...(truncated.lastLinePartial ? { lastLineBytes: utf8LastLineBytes(output) } : {}) } };
}
function utf8LastLineBytes(output: string): number { return new TextEncoder().encode(output.slice(output.lastIndexOf("\n") + 1)).byteLength; }
