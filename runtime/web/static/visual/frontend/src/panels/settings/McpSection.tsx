import { useEffect, useRef, useState } from 'preact/hooks';
import { registerSettingsPane } from './pane-registry';
import { McpServersSection } from './McpServersSection';
import { createMcpSettingsController, INITIAL_MCP_SETTINGS, type McpPolicy, type McpSettingsState } from '../../../../../../src/ui/mcp-settings-model';

export function McpSection() {
    const [state, setState] = useState<McpSettingsState>(INITIAL_MCP_SETTINGS);
    const [acknowledged, setAcknowledged] = useState(false);
    const [serversApplying, setServersApplying] = useState(false);
    const controller = useRef<ReturnType<typeof createMcpSettingsController> | null>(null);
    useEffect(() => {
        const current = createMcpSettingsController(setState); controller.current = current;
        void current.refresh();
        return () => { current.dispose(); controller.current = null; };
    }, []);
    const select = (patch: Partial<McpPolicy>) => { setAcknowledged(false); controller.current?.select(patch); };
    return <section className="settings-panel__section mcp-settings" aria-label="MCP settings">
      <h2 className="settings-panel__section-title">MCP</h2>
      <p className="settings-panel__description">Instance-wide MCP policy. Preview does not change settings. Apply interrupts active turns. Engine changes close the old owner before reloading extensions; chat history is preserved.</p>
      <button className="settings-panel__button" type="button" disabled={state.loading || serversApplying} onClick={() => void controller.current?.refresh()}>Refresh MCP status</button>
      {state.loading && <p role="status" aria-live="polite">Loading MCP settings…</p>}
      {state.error && <p className="settings-panel__error" role="alert">{state.error}</p>}
      {state.payload && <>
        <div className="settings-panel__field"><strong>Persisted policy</strong><span>{state.payload.persisted.policy.engine} / {state.payload.persisted.policy.codemode}</span></div>
        <p className="settings-panel__description">Configured factory: {state.payload.runtime.configuredFactory}. Observed policy: {state.payload.runtime.observedPolicy ? `${state.payload.runtime.observedPolicy.engine} / ${state.payload.runtime.observedPolicy.codemode}` : 'unknown or blocked'}. Live connection status is unknown.</p>
        <p className="settings-panel__description">Auto keeps codemode inactive with Adapter and enables it when Native needs it. On enables scripting; Off blocks scripting. Model execution inside scripts is disabled.</p>
        <label className="settings-panel__label" htmlFor="mcp-engine">Engine to preview</label>
        <select className="settings-panel__input" id="mcp-engine" disabled={state.applying || serversApplying} value={state.draft.engine} onChange={e => select({ engine: e.currentTarget.value as McpPolicy['engine'] })}>
          <option value="adapter">Adapter (default)</option><option value="native">Native (experimental)</option>
        </select>
        <label className="settings-panel__label" htmlFor="mcp-codemode">Codemode to preview</label>
        <select className="settings-panel__input" id="mcp-codemode" disabled={state.applying || serversApplying} value={state.draft.codemode} onChange={e => select({ codemode: e.currentTarget.value as McpPolicy['codemode'] })}>
          <option value="auto">Auto (default)</option><option value="on">On</option><option value="off">Off</option>
        </select>
        <button className="settings-panel__button" type="button" disabled={state.loading || serversApplying} onClick={() => void controller.current?.preview()}>Preview compatibility</button>
        {state.draft.engine === 'native' && state.preview?.applicable === false && <p className="settings-panel__description">{state.payload.nativeBlockReason}</p>}
        {state.draft.engine === 'native' && <ul>{state.payload.nativeBlockers.map(reason => <li>{reason}</li>)}</ul>}
        <label><input type="checkbox" checked={acknowledged} disabled={state.loading || serversApplying} onChange={e => setAcknowledged(e.currentTarget.checked)} /> I understand Apply may interrupt active turns across all chats.</label>
        <button className="settings-panel__button" type="button" disabled={serversApplying || state.loading || !acknowledged || !state.previewed || !state.payload.applyAvailable || !state.preview?.applicable} onClick={() => void controller.current?.apply(acknowledged)}>{state.applying ? 'Applying…' : 'Apply MCP settings'}</button>
        {state.applied && <p role="status">MCP settings saved and applied to current and new sessions.</p>}
        {state.previewed && state.preview && <div role="status" aria-live="polite"><strong>{state.preview.applicable ? 'Preview compatible — not applied.' : 'Preview blocked — not applied.'}</strong>
          {state.preview.issues.length > 0 && <ul>{state.preview.issues.map(issue => <li>{issue.serverName ? `${issue.serverName}: ` : ''}{issue.field} — {issue.message}</li>)}</ul>}
        </div>}
        <h3 className="settings-panel__subsection-title">Servers: native compatibility</h3>
        <p className="settings-panel__description">These are configuration classifications, not live connection states. A native-blocked server may work through the adapter.</p>
        {state.payload.servers.length ? <ul>{state.payload.servers.map(server => <li><strong>{server.name}</strong> — {server.nativeProjectionStatus}</li>)}</ul> : <p>No servers in the prepared configuration.</p>}
      </>}
      {state.payload && <McpServersSection busy={state.loading} onApplying={setServersApplying} />}
    </section>;
}
registerSettingsPane({ id: 'mcp', label: 'MCP', icon: <i className="codicon codicon-plug" />, order: 42, component: () => <McpSection /> });
