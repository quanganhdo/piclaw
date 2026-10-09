/** Shared preview/apply MCP settings controller for Classic and Visual. */
export interface McpPolicy { engine: 'adapter' | 'native'; codemode: 'auto' | 'on' | 'off' }
export interface McpSettingsPayload {
    revision: string;
    effect: string;
    nativeBlockReason: string;
    nativeBlockers: string[];
    persisted: { policy: McpPolicy };
    runtime: { configuredFactory: string; observedPolicy: McpPolicy | null; connectionStatus: string; applyAvailable: boolean };
    readiness: { adapter: boolean; native: boolean; codemode: boolean };
    servers: Array<{ name: string; nativeProjectionStatus: string }>;
    plan: { policy: McpPolicy; applicable: boolean; codemodeEnabled: boolean; issues: Array<{ serverName: string | null; field: string; code: string; message: string }> };
    applyAvailable: boolean;
}
export interface McpSettingsState {
    payload: McpSettingsPayload | null;
    draft: McpPolicy;
    preview: McpSettingsPayload['plan'] | null;
    loading: boolean;
    error: string | null;
    previewed: boolean;
    applying: boolean;
    applied: boolean;
}
export const INITIAL_MCP_SETTINGS: McpSettingsState = { payload: null, draft: { engine: 'adapter', codemode: 'auto' }, preview: null, loading: false, error: null, previewed: false, applying: false, applied: false };
const isPolicy = (value: unknown): value is McpPolicy => {
    const p = value as McpPolicy | undefined;
    return !!p && ['adapter', 'native'].includes(p.engine) && ['auto', 'on', 'off'].includes(p.codemode);
};
class McpSettingsError extends Error {}
function payloadFrom(value: any): McpSettingsPayload {
    if (value?.ok !== true || !isPolicy(value.persisted?.policy) || !isPolicy(value.plan?.policy)
        || typeof value.revision !== 'string' || !value.revision || typeof value.effect !== 'string' || typeof value.nativeBlockReason !== 'string'
        || !Array.isArray(value.nativeBlockers) || value.nativeBlockers.some((item: unknown) => typeof item !== 'string')
        || typeof value.plan.applicable !== 'boolean' || typeof value.plan.codemodeEnabled !== 'boolean'
        || !Array.isArray(value.plan.issues) || !Array.isArray(value.servers)
        || !value.runtime || typeof value.runtime.configuredFactory !== 'string' || typeof value.runtime.connectionStatus !== 'string'
        || !(value.runtime.observedPolicy === null || isPolicy(value.runtime.observedPolicy)) || typeof value.runtime.applyAvailable !== 'boolean'
        || !value.readiness || ['adapter', 'native', 'codemode'].some(key => typeof value.readiness[key] !== 'boolean') || typeof value.applyAvailable !== 'boolean'
        || value.servers.some((server: any) => typeof server?.name !== 'string' || typeof server?.nativeProjectionStatus !== 'string')
        || value.plan.issues.some((issue: any) => !(issue?.serverName === null || typeof issue?.serverName === 'string') || typeof issue?.field !== 'string' || typeof issue?.message !== 'string' || typeof issue?.code !== 'string')) throw new McpSettingsError('Invalid MCP settings response.');
    return value;
}
export function createMcpSettingsController(publish: (state: McpSettingsState) => void, request: typeof fetch = fetch) {
    let state: McpSettingsState = { ...INITIAL_MCP_SETTINGS, draft: { ...INITIAL_MCP_SETTINGS.draft } };
    let generation = 0, disposed = false;
    let controller: AbortController | null = null;
    const emit = (patch: Partial<McpSettingsState>) => { state = { ...state, ...patch }; if (!disposed) publish(state); };
    async function run(mode: 'refresh' | 'preview' | 'apply') {
        if (disposed || state.applying) return;
        const preview = mode === 'preview', apply = mode === 'apply';
        if (apply && (!state.previewed || !state.payload?.applyAvailable || !state.preview?.applicable)) return;
        const revision = state.payload?.revision;
        controller?.abort(); controller = new AbortController();
        const current = ++generation, signal = controller.signal, draft = { ...state.draft };
        emit({ loading: true, applying: apply, applied: false, error: null, preview: null, previewed: false, ...(mode === 'refresh' ? { payload: null } : {}) });
        try {
            const response = await request(apply ? '/agent/settings/mcp/apply' : preview ? '/agent/settings/mcp/preview' : '/agent/settings/mcp', {
                credentials: 'same-origin', cache: 'no-store', signal,
                ...(preview || apply ? { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(apply ? { policy: draft, revision, acknowledgeInterruptions: true } : draft) } : {}),
            });
            if (!response.ok) throw new McpSettingsError(response.status === 403 || response.status === 401 ? 'MCP settings are available only to the instance owner.' : response.status === 429 ? 'Too many requests. Wait before retrying.' : apply ? 'MCP settings were not confirmed. Refresh to check the policy and blocked state before retrying.' : 'Could not load MCP settings. Retry when the service is available.');
            const payload = payloadFrom(await response.json());
            if (disposed || current !== generation || signal.aborted) return;
            if (preview && (payload.plan.policy.engine !== draft.engine || payload.plan.policy.codemode !== draft.codemode)) throw new McpSettingsError('MCP preview response did not match the requested policy.');
            if (apply && (payload.persisted.policy.engine !== draft.engine || payload.persisted.policy.codemode !== draft.codemode || payload.runtime.observedPolicy?.engine !== draft.engine || payload.runtime.observedPolicy?.codemode !== draft.codemode)) throw new McpSettingsError('MCP application could not be confirmed. Refresh before retrying.');
            emit({ payload, draft: preview ? draft : { ...payload.persisted.policy }, preview: payload.plan, previewed: preview, loading: false, applying: false, applied: apply });
        } catch (error) {
            if (disposed || current !== generation || signal.aborted) return;
            // Clear server state on all failures, especially revoked owner access.
            emit({ payload: null, preview: null, previewed: false, loading: false, applying: false, applied: false, error: error instanceof McpSettingsError ? error.message : apply ? 'MCP application outcome is unknown. Refresh before retrying.' : 'Could not load MCP settings. Retry when the service is available.' });
        }
    }
    return {
        refresh: () => run('refresh'), preview: () => run('preview'),
        apply: (acknowledgeInterruptions: boolean) => acknowledgeInterruptions ? run('apply') : Promise.resolve(),
        select(patch: Partial<McpPolicy>) {
            const policy = { ...state.draft, ...patch };
            if (disposed || state.applying || !isPolicy(policy)) return;
            controller?.abort(); generation++;
            emit({ draft: policy, preview: null, previewed: false, loading: false, error: null, applied: false });
        },
        dispose() { disposed = true; generation++; controller?.abort(); },
    };
}
