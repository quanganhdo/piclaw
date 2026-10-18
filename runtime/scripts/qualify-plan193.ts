/** Offline Pi 1.2.0 / Plan sidebar 0.1.25 qualification.
 * See docs/development/pi-1.2.0-qualification.md; run only as a standalone Bun process.
 */
import assert from 'node:assert/strict';
import { AsyncLocalStorage } from 'node:async_hooks';
import { mkdtempSync, mkdirSync, rmSync, symlinkSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

assert(import.meta.main, 'Run this fixture as a standalone script, never import it into a host process');
const addonRoot = process.env.PLAN193_ADDONS_ROOT;
assert(addonRoot, 'PLAN193_ADDONS_ROOT is required; no live extension discovery');
const addon = resolve(addonRoot, 'addons/plan-sidebar');
const manifest = JSON.parse(readFileSync(join(addon, 'package.json'), 'utf8'));
assert.equal(manifest.version, '0.1.25');
// This script runs in its own disposable process. Do not inherit host profiles,
// optional extension switches, provider credentials, or config overrides.
const path = process.env.PATH;
for (const name of Object.keys(process.env)) delete process.env[name];
const root = mkdtempSync(join(tmpdir(), 'plan193-'));
// Also clean setup failures before the main lifecycle try/finally is reached.
process.once('exit', () => rmSync(root, { recursive: true, force: true }));
Object.assign(process.env, { PATH: path, HOME: join(root, 'home'), TMPDIR: root,
  PICLAW_WORKSPACE: root, PICLAW_STORE: join(root, 'store'), PICLAW_DATA: join(root, 'data'),
  PICLAW_DB_IN_MEMORY: '1', PICLAW_PI_AGENT_DIR: join(root, 'agent'),
  PI_CODING_AGENT_DIR: join(root, 'agent'), NODE_ENV: 'test' });
mkdirSync(process.env.HOME!, { recursive: true });
process.chdir(root);
let networkAttempts = 0;
globalThis.fetch = (() => { networkAttempts++; throw new Error('Network forbidden in Plan193 harness'); }) as any;
const sdkVersion = JSON.parse(readFileSync(resolve(import.meta.dir, '../../node_modules/@earendil-works/pi-coding-agent/package.json'), 'utf8')).version;
assert.equal(sdkVersion, '1.2.0', 'Requalify expectations before using a different SDK');
const { createAgentSession, createAgentSessionRuntime, DefaultResourceLoader, ModelRuntime, SessionManager, SettingsManager } = await import('@earendil-works/pi-coding-agent');
const { InMemoryCredentialStore, createAssistantMessageEventStream, getCurrentSystemPrompt } = await import('@earendil-works/pi-ai');
const { toolActivation } = await import('../src/extensions/tool-activation.js');
const { currentContextTools, providerTranscriptContext } = await import('../src/extensions/transcript-context-compat.js');
const { createRunToolCeilingController } = await import('../src/agent-pool/run-tool-ceiling.js');
const { AgentSessionManager } = await import('../src/agent-pool/session-manager.js');
const { getInstalledAddonExtensionPaths, createSessionInDir } = await import('../src/agent-pool/session.js');
const { initDatabase, closeDatabase } = await import('../src/db/connection.js');
const { AddonOperationService } = await import('../src/addons/operation-service.js');
const ambient = new AsyncLocalStorage<string>();
const kv = new Map<string, unknown>();
const key = (id: string, name: string, scope = 'chat', jid = '') => [id, scope, jid, name].join('\0');
(globalThis as any).__piclawRuntimeInterop = {
  getChatJid: (fallback = 'web:default') => ambient.getStore() || fallback,
  getChatChannel: () => 'web',
  getExtensionKvStore: () => ({
    get: (id: string, name: string, scope?: string, jid?: string) => kv.get(key(id, name, scope, jid)) ?? null,
    set: (id: string, name: string, value: unknown, scope?: string, jid?: string) => kv.set(key(id, name, scope, jid), structuredClone(value)),
  }),
};
const planFactory = (await import(join(addon, 'index.ts'))).default;
const settings = SettingsManager.inMemory({ retry: { enabled: false }, compaction: { enabled: false }, cacheWarming: 'off' });
let script: any[][] = [], request = 0, current: any = null, label = '', generation = 0;
const requests: Array<{ label: string; request: number; declared: string[]; planInstructions: boolean; mutablePlanInSystem: boolean }> = [];
let nextGeneration = 0;
const generations = new WeakMap<object, number>();
function registerSession(session: any) {
  generation = ++nextGeneration; generations.set(session, generation); live.push(session);
}
const trace: any[] = [];
const emit = (event: string, extra: any = {}) => {
  const row = { event, label, generation, chat: ambient.getStore() ?? null,
    all: current?.getAllTools().map((t: any) => t.name), active: current?.getActiveToolNames(), ...extra };
  trace.push(row); console.log(JSON.stringify(row));
};
const modelRuntime = await ModelRuntime.create({ credentials: new InMemoryCredentialStore(), modelsPath: null, refreshOnCreate: false, allowModelNetwork: false });
modelRuntime.registerProvider('plan193-local', {
  api: 'openai-completions', baseUrl: 'http://synthetic.invalid', apiKey: 'not-a-credential',
  models: [{ id: 'fixture', name: 'Local deterministic fixture', reasoning: false, input: ['text'],
    cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 }, contextWindow: 32768, maxTokens: 256 }],
  streamSimple: (_model: any, context: any) => {
    const stream = createAssistantMessageEventStream();
    const content = script[request++] ?? [{ type: 'text', text: 'done' }];
    const system = getCurrentSystemPrompt(providerTranscriptContext(context).messages);
    const receipt = { label, request, declared: currentContextTools(context).map((t: any) => t.name),
      planInstructions: system.includes('## Plan Sidebar'), mutablePlanInSystem: system.includes('synthetic-A') };
    requests.push(receipt);
    emit('model_request', { ...receipt, calls: content.filter((b: any) => b.type === 'toolCall').map((b: any) => b.name) });
    queueMicrotask(() => {
      const message: any = { role: 'assistant', api: 'openai-completions', provider: 'plan193-local', model: 'fixture', timestamp: Date.now(),
        content, stopReason: content.some((b: any) => b.type === 'toolCall') ? 'toolUse' : 'stop',
        usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 0, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } } };
      stream.push({ type: 'start', partial: message });
      stream.push({ type: 'done', reason: message.stopReason, message }); stream.end(message);
    });
    return stream;
  },
});
const call = (name: string, args: any = {}) => ({ type: 'toolCall', id: `${name}-${Math.random()}`, name, arguments: args });
const activate = () => call('activate_tools', { names: ['plan'] });
const read = () => call('plan', { action: 'read' });
const live: any[] = [];
async function makeLoader(mode: string, agentDir = join(root, 'agent')) {
  mkdirSync(agentDir, { recursive: true });
  const loader = new DefaultResourceLoader({ cwd: root, agentDir, settingsManager: settings,
    noSkills: true, noPromptTemplates: true, noThemes: true, noContextFiles: true,
    noExtensions: mode !== 'auto', additionalExtensionPaths: mode === 'file' ? [join(addon, 'index.ts')] : mode === 'package' ? [addon] : mode === 'installed' ? getInstalledAddonExtensionPaths(root) : [],
    extensionFactories: [toolActivation, ...(mode === 'inline' ? [planFactory] : [])],
    systemPromptOverride: () => 'Offline Plan193 test.' });
  await loader.reload();
  current = null;
  emit('loader', { mode, extensions: loader.getExtensions().extensions.map(e => ({ path: e.path, tools: [...e.tools.keys()] })), errors: loader.getExtensions().errors });
  assert.deepEqual(loader.getExtensions().errors, []);
  return loader;
}
async function create(mode = 'file', tools?: string[], excludeTools?: string[], loader?: any) {
  const result = await createAgentSession({ cwd: root, agentDir: join(root, 'agent'), modelRuntime,
    model: modelRuntime.getModel('plan193-local', 'fixture')!, sessionManager: SessionManager.inMemory(root), settingsManager: settings,
    resourceLoader: loader ?? await makeLoader(mode), ...(tools === undefined ? {} : { tools }), ...(excludeTools ? { excludeTools } : {}) });
  current = result.session; registerSession(current);
  await current.bindExtensions({ uiContext: {} as any, commandContextActions: {} as any, onError: (e: any) => { throw new Error(JSON.stringify(e)); } });
  emit('bound', { mode, toolsOption: tools ?? null, excludeTools: excludeTools ?? [] });
  return current;
}
async function run(session: any, name: string, batches: any[][], jid = 'web:fixture:branch:a') {
  current = session; generation = generations.get(session)!; label = name; request = 0; script = batches;
  const results: any[] = [];
  const off = session.subscribe((e: any) => {
    if (e.type === 'tool_execution_end') {
      results.push({ name: e.toolName, isError: e.isError, details: e.result.details, text: e.result.content?.map((b: any) => b.text).join('\n') });
      // No checklist/prompt contents in trace, only synthetic IDs, activation receipt and success/error.
      emit('tool_end', { name: e.toolName, isError: e.isError, activation: e.toolName === 'activate_tools' ? e.result.details : undefined,
        resolvedChat: e.result.details?.chat_jid, error: e.isError ? e.result.content : undefined });
    }
  });
  try { await ambient.run(jid, () => session.prompt('Offline scripted qualification')); }
  finally { off(); }
  assert.equal(request, batches.length + 1, `${name}: expected scripted requests plus final stop`);
  return results;
}
function success(results: any[], jid = 'web:fixture:branch:a') {
  assert.equal(results.filter(r => r.isError).length, 0);
  const plans = results.filter(r => r.name === 'plan');
  assert(plans.length > 0);
  for (const result of plans) assert.equal(result.details?.chat_jid, jid);
  const activation = results.find(r => r.name === 'activate_tools');
  if (activation) {
    assert.equal(activation.details.availability, 'same_turn');
    assert.deepEqual(activation.details.missing, []);
    assert.deepEqual(activation.details.unavailable, []);
    assert(activation.details.activeToolNames.includes('plan'));
  }
  const declared = requests.filter(r => r.label === label);
  assert(declared.some(r => r.declared.includes('plan')));
}
let cases = 0;
try {
  initDatabase();
  // Establish actual loading boundaries before treating a missing tool as execution evidence.
  const autoDir = join(root, 'auto-agent'); mkdirSync(join(autoDir, 'extensions'), { recursive: true });
  symlinkSync(addon, join(autoDir, 'extensions', 'plan-sidebar'));
  const enabled = await makeLoader('auto', autoDir);
  assert(enabled.getExtensions().extensions.some(e => e.tools.has('plan'))); cases++;
  const disabled = await makeLoader('disabled', autoDir);
  assert(!disabled.getExtensions().extensions.some(e => e.tools.has('plan')));
  assert(disabled.getExtensions().extensions.some(e => e.tools.has('activate_tools'))); cases++;
  const installedDir = join(root, '.pi/extensions/node_modules/@rcarmo'); mkdirSync(installedDir, { recursive: true });
  symlinkSync(addon, join(installedDir, 'piclaw-addon-plan-sidebar'));
  for (const mode of ['inline', 'file', 'package', 'installed']) {
    const session = await create(mode);
    assert(session.getAllTools().some((t: any) => t.name === 'plan'));
    assert(!session.getActiveToolNames().includes('plan'));
    success(await run(session, `${mode}-next-step`, [[activate()], [read()]])); cases++;
  }
  const session = await create();
  success(await run(session, 'update-A', [[activate()], [call('plan', { action: 'update', plan: [{ step: 'synthetic-A', status: 'in_progress' }] })]])); cases++;
  success(await run(session, 'cached-later-turn', [[read()]])); cases++;
  session.setActiveToolsByName(['activate_tools']);
  const batch = await run(session, 'same-batch-negative-control', [[activate(), read()], [read()]]);
  const batchPlans = batch.filter(r => r.name === 'plan');
  assert.equal(batchPlans.length, 2);
  assert.equal(batchPlans[0].isError, true);
  assert.equal(batchPlans[0].text, 'Tool plan not found');
  assert.equal(batchPlans[1].isError, false);
  const batchRequests = requests.filter(r => r.label === 'same-batch-negative-control');
  assert(!batchRequests[0].declared.includes('plan'));
  assert(batchRequests[1].declared.includes('plan'));
  assert.deepEqual(batch.find(r => r.name === 'activate_tools').details.newlyActivated, ['plan']); cases++;
  const ceiling = createRunToolCeilingController({ chatJid: 'web:fixture:branch:a', runOptions: { toolCeilingFilter: name => name !== 'plan' } });
  ceiling.apply(session);
  for (let n = 0; n < 2; n++) {
    const denied = await run(session, `ceiling-denied-${n}`, [[activate()], [read()]]);
    assert.deepEqual(denied[0].details.unavailable, ['plan']); assert.deepEqual(denied[0].details.newlyActivated, []);
    assert.equal(denied[1].name, 'plan');
    assert.equal(denied[1].isError, true);
    assert.equal(denied[1].text, 'Tool plan not found'); cases++;
  }
  ceiling.release(); success(await run(session, 'ceiling-release', [[activate()], [read()]])); cases++;
  for (const options of [{ tools: ['activate_tools'] }, { tools: [] }, { exclude: ['plan'] }]) {
    const filtered = await create('file', options.tools, options.exclude);
    assert(!filtered.getAllTools().some((t: any) => t.name === 'plan'));
    if (filtered.getActiveToolNames().includes('activate_tools')) {
      const denied = await run(filtered, 'sdk-filter-negative-control', [[activate()], [read()]]);
      assert.deepEqual(denied[0].details.missing, ['plan']);
      assert.equal(denied[1].name, 'plan');
      assert.equal(denied[1].isError, true);
      assert.equal(denied[1].text, 'Tool plan not found');
    }
    cases++;
  }
  // Exercise actual core cache manager, injecting only the offline SDK runtime factory (not production MCP/built-ins).
  const pool = new Map(), sidePool = new Map();
  const manager = new AgentSessionManager({ pool, sidePool, modelRuntime, settingsManager: settings, createDefaultTools: () => [],
    bindSession: async (runtime: any) => runtime.session.bindExtensions({ uiContext: {} as any, commandContextActions: {} as any }),
    ensureBranchRegistration: () => {}, createSession: async (_jid: string) => {
      const runtime = await createAgentSessionRuntime(async ({ sessionManager, sessionStartEvent }: any) => {
        const loader = await makeLoader('installed');
        const result = await createAgentSession({ cwd: root, agentDir: join(root, 'agent'), modelRuntime, model: modelRuntime.getModel('plan193-local', 'fixture')!,
          settingsManager: settings, sessionManager, sessionStartEvent, resourceLoader: loader });
        registerSession(result.session);
        return { ...result, services: { cwd: root, agentDir: join(root, 'agent'), modelRuntime, settingsManager: settings, resourceLoader: loader, diagnostics: [] }, diagnostics: [] };
      }, { cwd: root, agentDir: join(root, 'agent'), sessionManager: SessionManager.inMemory(root) });
      return runtime;
    } });
  try {
    const a = await manager.getOrCreate('web:fixture:branch:a');
    success(await run(a.session, 'core-cache-A', [[activate()], [read()]]));
    const cached = await manager.getOrCreate('web:fixture:branch:a'); assert.equal(cached, a);
    success(await run(cached.session, 'core-cache-reuse-A', [[read()]])); cases += 2;
    const b = await manager.getOrCreate('web:fixture:branch:b');
    const branchB = await run(b.session, 'core-cache-B', [[activate()], [read()]], 'web:fixture:branch:b');
    success(branchB, 'web:fixture:branch:b'); assert(!branchB[1].details.plan.some((p: any) => p.step === 'synthetic-A')); cases++;
    assert.notEqual(a.session, b.session);
    await manager.recreate('web:fixture:branch:a');
    const replacement = await manager.getOrCreate('web:fixture:branch:a'); assert.notEqual(replacement, a);
    assert(!replacement.session.getActiveToolNames().includes('plan'));
    const recreated = await run(replacement.session, 'core-recreated-A', [[activate()], [read()]]); success(recreated);
    assert(recreated[1].details.plan.some((p: any) => p.step === 'synthetic-A')); cases++;
    const old = replacement.session;
    await replacement.newSession(); assert.notEqual(replacement.session, old);
    await replacement.session.bindExtensions({ uiContext: {} as any, commandContextActions: {} as any });
    success(await run(replacement.session, 'sdk-runtime-replacement-A', [[activate()], [read()]])); cases++;
  } finally { await manager.shutdown(); }
  // Actual production core session factory: installed package discovery, all normal core factories,
  // no tools allowlist on ordinary branches; empty isolated MCP configuration.
  const coreRuntime = await createSessionInDir(join(root, 'actual-core-session'), { modelRuntime, settingsManager: settings, tools: [], chatJid: 'web:fixture:branch:core' });
  try {
    const coreSession = coreRuntime.session; registerSession(coreSession); current = coreSession;
    await coreSession.setModel(modelRuntime.getModel('plan193-local', 'fixture')!);
    const extensionErrors: unknown[] = [];
    await ambient.run('web:fixture:branch:core', () => coreSession.bindExtensions({ uiContext: { setStatus() {}, notify() {} } as any, commandContextActions: {} as any,
      onError: error => extensionErrors.push(error) }));
    assert.deepEqual(extensionErrors, []);
    assert(coreSession.getAllTools().some(t => t.name === 'plan'));
    assert.equal(coreRuntime.services.agentDir, join(root, 'agent'));
    assert.equal(coreRuntime.services.cwd, root);
    assert.deepEqual(coreRuntime.diagnostics, []);
    const loader = coreRuntime.services.resourceLoader;
    assert.equal(loader.getSkills().skills.length, 0);
    assert.equal(loader.getAgentsFiles().agentsFiles.length, 0);
    assert.deepEqual(loader.getExtensions().errors, []);
    emit('actual_core_factory', { diagnostics: coreRuntime.diagnostics, agentDir: '<fixture>/agent', cwd: '<fixture>' });
    success(await run(coreSession, 'actual-core-factory-next-step', [[activate()], [read()]], 'web:fixture:branch:core'), 'web:fixture:branch:core'); cases++;
  } finally { await coreRuntime.dispose(); }
  // An admitted production operation profile, not a hand-built approximation.
  const operations = new AddonOperationService({
    authorize: () => ({ decision: 'allow', grant: { target: 'task', revision: 'fixture', allowedTools: ['read'],
      maxToolCalls: 1, timeoutMs: 1000, parentWorkId: null } }),
    execute: async () => ({ status: 'completed' }),
  });
  try {
    const receipt = await operations.bind({ addonId: 'fixture', principalId: 'fixture' }).admit({
      target: 'task', idempotencyKey: 'profile', text: 'synthetic operation',
    });
    await operations.waitForIdle();
    const operation = await createSessionInDir(join(root, 'operation-session'), { modelRuntime, settingsManager: settings,
      tools: [], chatJid: `operation:${receipt.operation!.id}`,
      extensionFactories: [() => { throw new Error('Operation must not invoke extension factories'); }] });
    try {
      current = operation.session; registerSession(current); label = 'actual-operation-profile';
      assert.deepEqual(current.getAllTools().map((t: any) => t.name), ['read']);
      assert.deepEqual(current.getActiveToolNames(), ['read']);
      assert.deepEqual(operation.services.resourceLoader.getExtensions().extensions, []);
      emit('operation_profile', { extensions: [], toolsOption: ['read'] }); cases++;
    } finally { await operation.dispose(); }
  } finally { operations.shutdown(); await operations.waitForIdle(); }
  const cachedRequest = requests.find(r => r.label === 'cached-later-turn' && r.request === 1)!;
  assert(cachedRequest.planInstructions);
  assert(!cachedRequest.mutablePlanInSystem);
  assert(cachedRequest.declared.includes('plan'));
  assert.equal(networkAttempts, 0);
  console.log(JSON.stringify({ event: 'PASS', cases, sdk: sdkVersion, addon: manifest.version, rows: trace.length,
    fetchAttempts: networkAttempts, storage: 'in-memory DB/KV; disposable core session files' }));
} finally {
  for (const session of live) { await session.abort(); session.dispose(); }
  closeDatabase(); rmSync(root, { recursive: true, force: true });
}
