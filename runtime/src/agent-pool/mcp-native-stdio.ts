import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import type { JsonRpcMessage, McpTransport } from '@earendil-works/pi-mcp';

/** Host-owned stdio: no ambient credentials, and cleanup awaits pipes plus process-group exit. */
export function createNativeStdio(options: { command: string; args?: string[]; cwd?: string; env?: Record<string, string> }): McpTransport {
  if (process.platform === 'win32') throw Error('Experimental Native stdio requires POSIX process-group cleanup.');
  const messages = new Set<(message: JsonRpcMessage) => void>();
  const errors = new Set<(error: Error) => void>();
  const closed = new Set<() => void>();
  const events = {
    emitMessage(message: JsonRpcMessage) { for (const listener of messages) listener(message); },
    emitError(error: Error) { for (const listener of errors) listener(error); },
    emitClose() { for (const listener of closed) listener(); },
  };
  let child: ChildProcessWithoutNullStreams | undefined;
  let ended: Promise<void> | undefined;
  let resolveEnded!: () => void;
  let closePromise: Promise<void> | undefined;
  let buffer = '';
  const pipeFailures: Error[] = [];
  const env: NodeJS.ProcessEnv = {};
  for (const name of ['PATH', 'HOME', 'TMPDIR', 'TMP', 'TEMP', 'LANG', 'LC_ALL', 'TZ']) if (process.env[name] !== undefined) env[name] = process.env[name];
  Object.assign(env, options.env);
  const groupExists = () => {
    if (!child?.pid) return false;
    try { process.kill(-child.pid, 0); return true; } catch (error: any) { if (error.code === 'ESRCH') return false; throw error; }
  };
  const kill = (signal: NodeJS.Signals) => {
    if (!child?.pid) return;
    try { process.kill(-child.pid, signal); } catch (error: any) { if (error.code !== 'ESRCH') throw error; }
  };
  return {
    async start() {
      if (child || closePromise) throw Error('Native stdio transport cannot restart.');
      ended = new Promise<void>(resolve => resolveEnded = resolve);
      child = spawn(options.command, options.args ?? [], { cwd: options.cwd, env, detached: true, stdio: 'pipe' });
      child.once('close', () => { resolveEnded(); events.emitClose(); });
      child.on('error', error => { pipeFailures.push(error); events.emitError(error); });
      for (const stream of [child.stdin, child.stdout, child.stderr]) stream.on('error', error => { pipeFailures.push(error); events.emitError(error); });
      // Consume stderr without exporting potentially credential-bearing server output.
      child.stderr.on('data', () => {});
      child.stdout.setEncoding('utf8');
      child.stdout.on('data', chunk => {
        buffer += chunk;
        if (Buffer.byteLength(buffer) > 1024 * 1024) { events.emitError(Error('Native MCP message exceeds 1 MiB.')); kill('SIGKILL'); return; }
        let index: number;
        while ((index = buffer.indexOf('\n')) >= 0) {
          const line = buffer.slice(0, index); buffer = buffer.slice(index + 1);
          if (!line.trim()) continue;
          try { events.emitMessage(JSON.parse(line) as JsonRpcMessage); }
          catch { events.emitError(Error('Native MCP server returned malformed JSON.')); kill('SIGKILL'); }
        }
      });
      await new Promise<void>((resolve, reject) => { child!.once('spawn', resolve); child!.once('error', reject); });
    },
    async send(message) {
      if (!child || closePromise || child.exitCode !== null || child.signalCode !== null) throw Error('Native stdio is closed.');
      const data = JSON.stringify(message) + '\n';
      if (Buffer.byteLength(data) > 1024 * 1024) throw Error('Native MCP message exceeds 1 MiB.');
      await new Promise<void>((resolve, reject) => child!.stdin.write(data, error => error ? reject(error) : resolve()));
    },
    close() {
      if (!closePromise) closePromise = (async () => {
        if (!child) return;
        child.stdin.end();
        kill('SIGTERM');
        let timer: ReturnType<typeof setTimeout>;
        try { await Promise.race([ended!, new Promise<void>(resolve => { timer = setTimeout(resolve, 500); })]); }
        finally { clearTimeout(timer!); }
        // Parent exit never exempts descendants from group cleanup.
        if (groupExists()) kill('SIGKILL');
        let deadline: ReturnType<typeof setTimeout>;
        try { await Promise.race([ended!, new Promise<never>((_, reject) => { deadline = setTimeout(() => reject(Error('Native stdio pipes did not close.')), 2000); })]); }
        finally { clearTimeout(deadline!); }
        if (groupExists()) throw Error('Native stdio process group still exists; cleanup is uncertain.');
        if (pipeFailures.length) throw pipeFailures[0];
      })();
      return closePromise;
    },
    onMessage(listener) { messages.add(listener); return () => { messages.delete(listener); }; },
    onError(listener) { errors.add(listener); return () => { errors.delete(listener); }; },
    onClose(listener) { closed.add(listener); return () => { closed.delete(listener); }; },
  };
}
