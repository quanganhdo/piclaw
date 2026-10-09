import { expect, test } from 'bun:test';
import { createMcpSettingsController, type McpSettingsState } from '../../web/src/ui/mcp-settings-model.js';

function payload(engine = 'adapter', codemode = 'auto') {
    return { ok: true, revision: 'opaque-fixture', effect: 'abort_active_turns_and_update_codemode', nativeBlockReason: 'Native shutdown acknowledgement is unqualified.', nativeBlockers: ['Closure unqualified'], persisted: { policy: { engine: 'adapter', codemode: 'auto' } }, runtime: { configuredFactory: 'adapter', observedPolicy: {engine:'adapter',codemode:'auto'}, connectionStatus: 'unknown', applyAvailable: true }, readiness: { adapter: true, native: false, codemode: true }, servers: [{ name: 'test', nativeProjectionStatus: 'mapped' }], plan: { policy: { engine, codemode }, applicable: engine === 'adapter', codemodeEnabled: codemode === 'on', issues: [] }, applyAvailable: engine === 'adapter' };
}
function harness() {
    let state: McpSettingsState;
    const states: McpSettingsState[] = [];
    const calls: Array<{ url: string; options: RequestInit; finish: (r: Response) => void }> = [];
    const request = ((url: string, options: RequestInit) => new Promise<Response>(finish => calls.push({ url, options, finish }))) as typeof fetch;
    const controller = createMcpSettingsController(next => { state = next; states.push(next); }, request);
    return { controller, calls, states, get state() { return state!; } };
}

test('MCP reads and previews explicitly without any save or apply request', async () => {
    const h = harness();
    const loading = h.controller.refresh(); h.calls[0].finish(Response.json(payload())); await loading;
    expect(h.state.draft).toEqual({ engine: 'adapter', codemode: 'auto' });
    h.controller.select({ engine: 'native', codemode: 'off' });
    expect(h.calls).toHaveLength(1); expect(h.state.preview).toBeNull();
    const preview = h.controller.preview();
    expect(h.calls[1].url).toBe('/agent/settings/mcp/preview');
    expect(h.calls[1].options).toMatchObject({ method: 'POST', credentials: 'same-origin', cache: 'no-store', body: '{"engine":"native","codemode":"off"}' });
    h.calls[1].finish(Response.json(payload('native', 'off'))); await preview;
    expect(h.state.previewed).toBe(true); expect(h.state.preview?.applicable).toBe(false);
    expect(h.state.payload?.persisted.policy).toEqual({ engine: 'adapter', codemode: 'auto' }); h.controller.dispose();
});

test('changing selection or refreshing invalidates stale even noncooperative preview responses', async () => {
    const h = harness(); const read = h.controller.refresh(); h.calls[0].finish(Response.json(payload())); await read;
    const stale = h.controller.preview(); h.controller.select({ engine: 'native', codemode: 'on' });
    expect(h.calls[1].options.signal?.aborted).toBe(true);
    h.calls[1].finish(Response.json(payload())); await stale;
    expect(h.state.draft.engine).toBe('native'); expect(h.state.previewed).toBe(false);
    const old = h.controller.preview(), fresh = h.controller.refresh();
    h.calls[3].finish(Response.json(payload())); await fresh;
    h.calls[2].finish(Response.json(payload('native', 'on'))); await old;
    expect(h.state.draft.engine).toBe('adapter'); expect(h.state.previewed).toBe(false); h.controller.dispose();
});

test('refresh clears previous state and same-task partial selections compose', async () => {
    const h = harness(); const read = h.controller.refresh(); h.calls[0].finish(Response.json(payload())); await read;
    const refresh = h.controller.refresh(); expect(h.state.payload).toBeNull();
    h.controller.select({ engine: 'native' }); h.controller.select({ codemode: 'off' });
    expect(h.state.draft).toEqual({ engine: 'native', codemode: 'off' }); expect(h.state.payload).toBeNull();
    h.calls[1].finish(Response.json(payload())); await refresh;
    expect(h.state.payload).toBeNull(); expect(h.state.previewed).toBe(false); h.controller.dispose();
});

test('invalid runtime and readiness fields never enter retained UI state', async () => {
    for (const patch of [
        { runtime: { ...payload().runtime, observedPolicy: {} } },
        { runtime: { ...payload().runtime, applyAvailable: 'yes' } },
        { readiness: { adapter: true, native: 'yes', codemode: false } },
        { plan: { ...payload().plan, issues: [{ serverName: null, field: 'engine', message: 'test' }] } },
    ]) {
        const h = harness(), pending = h.controller.refresh(); h.calls[0].finish(Response.json({ ...payload(), ...patch })); await pending;
        expect(h.state.payload).toBeNull(); expect(h.state.error).toBe('Invalid MCP settings response.'); h.controller.dispose();
    }
});

test('unmount aborts work and suppresses every late state update', async () => {
    const h = harness(), loading = h.controller.refresh(); const count = h.states.length;
    h.controller.dispose(); expect(h.calls[0].options.signal?.aborted).toBe(true);
    h.calls[0].finish(Response.json(payload())); await loading;
    expect(h.states).toHaveLength(count); await h.controller.refresh(); expect(h.calls).toHaveLength(1);
});

test('Apply requires fresh preview and explicit acknowledgement; active Apply cannot overlap selection or refresh', async () => {
    const h = harness(), read = h.controller.refresh(); h.calls[0].finish(Response.json(payload())); await read;
    await h.controller.apply(true); expect(h.calls).toHaveLength(1);
    h.controller.select({codemode:'on'});
    const preview = h.controller.preview(); h.calls[1].finish(Response.json(payload('adapter','on'))); await preview;
    await h.controller.apply(false); expect(h.calls).toHaveLength(2);
    const apply = h.controller.apply(true); expect(h.state.applying).toBe(true);
    expect(JSON.parse(h.calls[2].options.body as string)).toEqual({policy:{engine:'adapter',codemode:'on'},revision:'opaque-fixture',acknowledgeInterruptions:true});
    h.controller.select({codemode:'off'}); await h.controller.refresh(); await h.controller.apply(true);
    expect(h.calls).toHaveLength(3); expect(h.state.draft.codemode).toBe('on');
    const result = payload('adapter','on'); result.persisted.policy.codemode='on';result.runtime.observedPolicy.codemode='on';
    h.calls[2].finish(Response.json(result));await apply;
    expect(h.state.applied).toBe(true); expect(h.state.previewed).toBe(false); expect(h.state.applying).toBe(false);h.controller.dispose();
});

test('Apply errors never claim rollback or retain server state', async () => {
    const h = harness(), read = h.controller.refresh(); h.calls[0].finish(Response.json(payload())); await read;
    const preview = h.controller.preview(); h.calls[1].finish(Response.json(payload())); await preview;
    const apply = h.controller.apply(true);h.calls[2].finish(Response.json({error:'PRIVATE_SENTINEL'},{status:503}));await apply;
    expect(h.state.applied).toBe(false);expect(h.state.payload).toBeNull();expect(h.state.error).toContain('Refresh');expect(h.state.error).not.toContain('PRIVATE_SENTINEL');h.controller.dispose();
});

test('denial and malformed server results clear prior state and do not expose raw errors', async () => {
    const h = harness();
    for (const response of [Response.json({ error: 'PRIVATE_SENTINEL' }, { status: 403 }), Response.json({ ok: true }), new Response('PRIVATE_SENTINEL')]) {
        const seed = h.controller.refresh(); h.calls.at(-1)!.finish(Response.json(payload())); await seed;
        const next = h.controller.refresh(); h.calls.at(-1)!.finish(response); await next;
        expect(h.state.payload).toBeNull(); expect(h.state.preview).toBeNull(); expect(h.state.loading).toBe(false);
        expect(h.state.error).toBeTruthy(); expect(h.state.error).not.toContain('PRIVATE_SENTINEL');
    }
    const seed = h.controller.refresh(); h.calls.at(-1)!.finish(Response.json(payload())); await seed;
    h.controller.select({ engine: 'native', codemode: 'on' });
    const preview = h.controller.preview(); h.calls.at(-1)!.finish(Response.json(payload())); await preview;
    expect(h.state.error).toContain('did not match'); expect(h.state.payload).toBeNull(); h.controller.dispose();
});
