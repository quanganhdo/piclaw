import { expect, test } from 'bun:test';
import { createConstrainedNativeOwner } from '../../src/agent-pool/mcp-native-owner';
import type { McpOwnerLifecycle } from '../../src/agent-pool/mcp-bridge-owner';
import { resolve } from 'node:path';

test('Native profile has one shutdown owner, denies browser command and omits resource tools', async () => {
  let lifecycle!: McpOwnerLifecycle;
  const commands = new Map<string, any>();
  const tools: string[] = [];
  const events = new Map<string, any[]>();
  const factory = createConstrainedNativeOwner({ servers: [], errors: [], autoEnableCodemode: false }, handle => lifecycle = handle);
  const pi: any = {
    on(name: string, handler: any) { events.set(name, [...(events.get(name) ?? []), handler]); },
    registerCommand(name: string, command: any) { commands.set(name, command); },
    registerTool(tool: any) { tools.push(tool.name); },
    registerMessageRenderer() {},
    registerToolRenderer() {},
    registerFlag() {},
    registerMcpServer() {}, getMcpServers: () => [],
    getActiveTools: () => [],
    setActiveTools() {},
    getAllTools: () => [],
    events: { on() { return () => {}; }, emit() {} },
  };
  await factory(pi);
  expect(events.get('session_shutdown')).toBeUndefined();
  expect(commands.has('mcp')).toBe(true);
  await expect(commands.get('mcp').handler()).rejects.toThrow('Browser OAuth is disabled');
  expect(tools).not.toContain('list_mcp_resources');
  expect(tools).not.toContain('read_mcp_resource');
  const shutdown = lifecycle.shutdown();
  expect(lifecycle.shutdown()).toBe(shutdown);
  await shutdown;
});

test('actual Native extension connects stdio, executes a tool and closes its owned process', async () => {
  let lifecycle!: McpOwnerLifecycle;
  const tools = new Map<string, any>(), events = new Map<string, any[]>();
  let ready!: () => void;
  const registered = new Promise<void>(resolve => ready = resolve);
  const factory = createConstrainedNativeOwner({ servers: [{ name: 'fixture', config: { type: 'stdio', command: process.execPath, args: ['--no-env-file', resolve(import.meta.dir, '../fixtures/mcp-native-tool-server.mjs')], exposure: 'direct' }, source: 'fixture' }], errors: [], autoEnableCodemode: false }, handle => lifecycle = handle);
  const pi: any = {
    on(name: string, handler: any) { events.set(name, [...(events.get(name) ?? []), handler]); },
    registerCommand() {}, registerToolRenderer() {}, registerMessageRenderer() {}, registerFlag() {},
    registerTool(tool: any) { tools.set(tool.name, tool); if (tool.name === 'mcp__fixture__echo') ready(); },
    getActiveTools: () => [...tools.keys()], setActiveTools() {}, getAllTools: () => [...tools.values()], getMcpServers: () => [],
    events: { on() { return () => {}; }, emit() {} },
  };
  const ctx: any = { cwd: resolve(import.meta.dir, '../../..'), getMcpServers: () => [], ui: { notify() {} }, modelRegistry: { getApiKey: async () => undefined }, waitForIdle: async () => {} };
  await factory(pi);
  try {
    for (const handler of events.get('session_start') ?? []) await handler({ type: 'session_start' }, ctx);
    let timer: ReturnType<typeof setTimeout>;
    try { await Promise.race([registered, new Promise((_, reject) => { timer = setTimeout(() => reject(Error('Native tool did not register')), 5000); })]); }
    finally { clearTimeout(timer!); }
    const result = await tools.get('mcp__fixture__echo').execute('fixture-call', { text: 'synthetic Native result' }, new AbortController().signal, undefined, ctx);
    expect(result.content).toEqual([{ type: 'text', text: 'synthetic Native result' }]);
    expect(tools.has('list_mcp_resources')).toBe(false);
    await lifecycle.shutdown();
  } finally { await lifecycle.shutdown(); }
}, 10000);

test('actual Native HTTP uses only its captured server credential for tool requests', async () => {
  const requests: string[] = [];
  const server = Bun.serve({ hostname: '127.0.0.1', port: 0, async fetch(req) {
    requests.push(req.headers.get('authorization') ?? 'absent');
    if (req.method === 'GET') return new Response(null, { status: 405 });
    if (req.method === 'DELETE') return new Response(null, { status: 204 });
    const message = await req.json();
    if (message.id === undefined) return new Response(null, { status: 202 });
    const result = message.method === 'initialize' ? { protocolVersion: message.params.protocolVersion, capabilities: { tools: {}, resources: {}, prompts: {} }, serverInfo: { name: 'http-fixture', version: '1' } }
      : message.method === 'tools/list' ? { tools: [{ name: 'echo', inputSchema: { type: 'object', properties: {} } }] }
      : { content: [{ type: 'text', text: 'http result' }] };
    return Response.json({ jsonrpc: '2.0', id: message.id, result });
  } });
  let lifecycle!: McpOwnerLifecycle;
  const events = new Map<string, any[]>(), tools = new Map<string, any>();
  let ready!: () => void;
  const registered = new Promise<void>(resolve => ready = resolve);
  const factory = createConstrainedNativeOwner({ servers: [{ name: 'fixture', config: { type: 'http', url: server.url.href, headers: { Authorization: 'Bearer ${NATIVE_FIXTURE_TOKEN}' }, exposure: 'direct' }, source: 'fixture' }], errors: [] }, owner => lifecycle = owner, name => {
    expect(name).toBe('fixture'); return { NATIVE_FIXTURE_TOKEN: 'synthetic-captured' };
  });
  const pi: any = { on(name: string, handler: any) { events.set(name, [...(events.get(name) ?? []), handler]); }, registerCommand() {}, registerToolRenderer() {}, registerMessageRenderer() {}, registerFlag() {}, registerTool(tool: any) { tools.set(tool.name, tool); if (tool.name === 'mcp__fixture__echo') ready(); }, getActiveTools: () => [...tools.keys()], setActiveTools() {}, getAllTools: () => [...tools.values()], getMcpServers: () => [], events: { on() { return () => {}; }, emit() {} } };
  try {
    await factory(pi);
    for (const handler of events.get('session_start') ?? []) await handler({ type: 'session_start' }, { cwd: process.cwd(), modelRegistry: { getApiKey: async () => { throw Error('Provider credentials must not be read'); } }, ui: { notify() {} } });
    let timer: ReturnType<typeof setTimeout>;
    try { await Promise.race([registered, new Promise((_, reject) => { timer = setTimeout(() => reject(Error('HTTP tool missing')), 5000); })]); }
    finally { clearTimeout(timer!); }
    const result = await tools.get('mcp__fixture__echo').execute('call', {}, new AbortController().signal, undefined, {});
    expect(result.content).toEqual([{ type: 'text', text: 'http result' }]);
    await lifecycle.shutdown();
    expect(requests.length).toBeGreaterThan(1);
    expect(new Set(requests)).toEqual(new Set(['Bearer synthetic-captured']));
  } finally { await lifecycle?.shutdown(); server.stop(true); }
}, 10000);

test('HTTP authentication challenge does not start OAuth, provider login or browser activity', async () => {
  let requests = 0, providerReads = 0;
  const server = Bun.serve({hostname:'127.0.0.1',port:0,fetch(req){requests++;expect(req.headers.get('authorization')).toBe('Bearer synthetic');return new Response(null,{status:401,headers:{'www-authenticate':'Bearer resource_metadata="https://never-call.invalid/.well-known/oauth-protected-resource"'}});}});
  let lifecycle!: McpOwnerLifecycle;
  const events=new Map<string,any[]>();
  const pi:any={on(name:string,handler:any){events.set(name,[...(events.get(name)??[]),handler]);},registerCommand(){},registerToolRenderer(){},registerMessageRenderer(){},registerFlag(){},registerTool(){},getMcpServers:()=>[],getActiveTools:()=>[],setActiveTools(){},getAllTools:()=>[],events:{on(){return()=>{};},emit(){}}};
  const factory=createConstrainedNativeOwner({servers:[{name:'denied',config:{type:'http',url:server.url.href,headers:{Authorization:'Bearer synthetic'},exposure:'direct'},source:'fixture'}],errors:[]},owner=>lifecycle=owner);
  try{
    await factory(pi);
    const ctx:any={cwd:process.cwd(),modelRegistry:{getApiKey:async()=>{providerReads++;throw Error('Provider auth forbidden');}},ui:{notify(){}}};
    for(const handler of events.get('session_start')??[])await handler({type:'session_start'},ctx);
    for(const handler of events.get('before_agent_start')??[])await handler({type:'before_agent_start',systemPromptOptions:{sections:{}}},ctx);
    expect(requests).toBeGreaterThan(0);expect(providerReads).toBe(0);
    await lifecycle.shutdown();
  }finally{await lifecycle?.shutdown();server.stop(true);}
},15000);
