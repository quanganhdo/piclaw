import { createMcpExtension, type ExtensionFactory } from '@earendil-works/pi-coding-agent';
import type { McpTransport } from '@earendil-works/pi-mcp';
import type { McpOwnerLifecycle } from './mcp-bridge-owner';
import { constrainNativeTransport } from './mcp-native-transport';
import { nativeAuthorizationHeader, nativeHeadersCompatible } from './mcp-native-header-policy';
import { createNativeStdio } from './mcp-native-stdio';
import { createNativeHttp } from './mcp-native-http';

type NativeOptions = NonNullable<Parameters<typeof createMcpExtension>[0]>;
type NativeConfig = Awaited<ReturnType<NonNullable<NativeOptions['loadConfig']>>>;

/** Native keeps its own default credential store; this profile never starts OAuth. */
export function createConstrainedNativeOwner(config: NativeConfig, onLifecycle: (owner: McpOwnerLifecycle) => void, resolveRuntimeEnv: (name: string) => Readonly<NodeJS.ProcessEnv> = () => ({})): ExtensionFactory {
  const closes: (() => Promise<void>)[] = [];
  const shutdownHandlers: ((...args: any[]) => Promise<unknown>)[] = [];
  let shutdownPromise: Promise<void> | undefined;
  let shuttingDown = false;
  let startupFailure: unknown;
  const lifecycle: McpOwnerLifecycle = {
    assertReady() { if (startupFailure) throw new Error('Native MCP startup failed; admission remains blocked.', { cause: startupFailure }); },
    shutdown() {
      if (!shutdownPromise) {
        shuttingDown = true;
        shutdownPromise = (async () => {
        // Native marks itself shutting down synchronously before its first await.
        const handlers = shutdownHandlers.map(handler => Promise.resolve(handler()));
        const results = await Promise.allSettled([...handlers, ...closes.map(close => close())]);
        // Every cleanup tail settles before reporting failure; no early owner release.
        const failure = results.find((result): result is PromiseRejectedResult => result.status === 'rejected');
        if (failure) throw failure.reason;
        })();
      }
      return shutdownPromise;
    },
  };
  onLifecycle(lifecycle);
  return async pi => {
    // Forward upstream definitions; this host wrapper does not define a new tool family.
    const registerNativeTool = pi.registerTool.bind(pi);
    const proxy = new Proxy(pi, {
      get(target, property) {
        if (property === 'on') return (event: string, handler: (...args: any[]) => unknown) => {
          if (event === 'session_shutdown') {
            shutdownHandlers.push(async () => handler({ type: 'session_shutdown' }, {}));
            return;
          }
          if (event === 'session_start') return target.on(event as any, (async (...args: any[]) => {
            try { return await handler(...args); }
            catch (error) { startupFailure = error; throw error; }
          }) as any);
          return target.on(event as any, handler as any);
        };
        // Native's TUI command cannot safely own browser login/config writes in web mode.
        if (property === 'registerCommand') return (name: string, command: any) => {
          if (name === 'mcp') return target.registerCommand(name, { description: 'Native experimental MCP is managed in Settings; OAuth is unavailable.', handler: async () => { throw Error('Native experimental MCP: use Settings. Browser OAuth is disabled.'); } });
          return target.registerCommand(name, command);
        };
        if (property === 'getMcpServers') return () => {
          const servers = target.getMcpServers();
          if (servers.length) throw Error('Native experimental MCP requires Settings-owned server definitions; extension registrations are unsupported.');
          return servers;
        };
        if (property === 'registerTool') return (tool: any) => {
          if (['list_mcp_resources', 'list_mcp_resource_templates', 'read_mcp_resource'].includes(tool.name)) return;
          return registerNativeTool(tool);
        };
        const value = Reflect.get(target, property);
        return typeof value === 'function' ? value.bind(target) : value;
      },
    });
    await createMcpExtension({
      loadConfig: () => config,
      openUrl: async () => { throw Error('Native experimental MCP disables browser OAuth.'); },
      updateConfig: () => { throw Error('Native configuration is managed through Piclaw Settings.'); },
      createTransport(entry) {
        const server = entry.config;
        if (shuttingDown) throw Error('Native MCP owner is shutting down.');
        // Extension-registered servers must pass the same restrictions as Settings.
        const referenced = (value: unknown) => typeof value === 'string' && (/\$\{/.test(value) || value.startsWith('!'));
        if (('oauth' in server && server.oauth) || ('auth' in server && server.auth)) throw Error('Native experimental MCP disables OAuth/provider authentication.');
        if ('command' in server) {
          if (referenced(server.command) || referenced(server.cwd) || server.args?.some(referenced) || Object.values(server.env ?? {}).some(referenced)) throw Error('Native experimental MCP disables command/environment credential references.');
        } else if (referenced(server.url) || !nativeHeadersCompatible(server.headers)) throw Error('Native experimental MCP disables unsupported HTTP credential references.');
        let transport: McpTransport;
        if ('command' in server) transport = createNativeStdio({ command: server.command, args: server.args, cwd: server.cwd, env: server.env });
        else {
          const headers = { ...server.headers };
          const runtimeEnv = resolveRuntimeEnv(entry.name);
          for (const [key, value] of Object.entries(headers)) {
            const match = /^Bearer \$\{([A-Z_][A-Z0-9_]*)\}$/.exec(value);
            if (match) {
              const secret = runtimeEnv[match[1]];
              if (!secret) throw Error('Native HTTP credential is unavailable.');
              headers[key] = `Bearer ${secret}`;
            }
          }
          const authorization = nativeAuthorizationHeader(headers);
          if (!authorization || server.auth) throw Error('Native HTTP requires explicit Authorization; OAuth/provider auth is unavailable.');
          transport = createNativeHttp(server.url, headers);
        }
        const constrained = constrainNativeTransport(transport);
        closes.push(constrained.close);
        return constrained.transport;
      },
    })(proxy);
  };
}
