import { html, useState, useEffect, useRef } from '../../vendor/preact-htm.js';
import { createMcpSettingsController, INITIAL_MCP_SETTINGS, type McpPolicy, type McpSettingsState } from '../../ui/mcp-settings-model.js';
import { McpServersSection } from './mcp-servers.js';

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
    return html`<section class="settings-section mcp-settings" aria-label="MCP settings">
      <h3>MCP</h3>
      <p class="settings-hint">Instance-wide MCP policy. Preview does not change settings. Apply interrupts active turns. Engine changes close the old owner before reloading extensions; chat history is preserved.</p>
      <button class="settings-btn" type="button" disabled=${state.loading || serversApplying} onClick=${() => void controller.current?.refresh()}>Refresh MCP status</button>
      ${state.loading && html`<p role="status" aria-live="polite">Loading MCP settings…</p>`}
      ${state.error && html`<p class="settings-error" role="alert">${state.error}</p>`}
      ${state.payload && html`
        <div class="settings-row settings-row-vertical"><strong>Persisted policy</strong><span>${state.payload.persisted.policy.engine} / ${state.payload.persisted.policy.codemode}</span></div>
        <p class="settings-hint">Configured factory: ${state.payload.runtime.configuredFactory}. Observed policy: ${state.payload.runtime.observedPolicy ? `${state.payload.runtime.observedPolicy.engine} / ${state.payload.runtime.observedPolicy.codemode}` : 'unknown or blocked'}. Live connection status is unknown.</p>
        <p class="settings-hint">Auto keeps codemode inactive with Adapter and enables it when Native needs it. On enables scripting; Off blocks scripting. Model execution inside scripts is disabled.</p>
        <div class="settings-row settings-row-vertical"><label for="mcp-engine">Engine to preview</label>
          <select id="mcp-engine" disabled=${state.applying || serversApplying} value=${state.draft.engine} onChange=${(e: Event) => select({ engine: (e.target as HTMLSelectElement).value as McpPolicy['engine'] })}>
            <option value="adapter">Adapter (default)</option><option value="native">Native (experimental)</option>
          </select>
        </div>
        <div class="settings-row settings-row-vertical"><label for="mcp-codemode">Codemode to preview</label>
          <select id="mcp-codemode" disabled=${state.applying || serversApplying} value=${state.draft.codemode} onChange=${(e: Event) => select({ codemode: (e.target as HTMLSelectElement).value as McpPolicy['codemode'] })}>
            <option value="auto">Auto (default)</option><option value="on">On</option><option value="off">Off</option>
          </select>
        </div>
        <button class="settings-btn" type="button" disabled=${state.loading || serversApplying} onClick=${() => void controller.current?.preview()}>Preview compatibility</button>
        ${state.draft.engine === 'native' && state.preview?.applicable === false && html`<p class="settings-hint">${state.payload.nativeBlockReason}</p>`}
        ${state.draft.engine === 'native' && html`<ul>${state.payload.nativeBlockers.map(reason => html`<li>${reason}</li>`)}</ul>`}
        <label><input type="checkbox" checked=${acknowledged} disabled=${state.loading || serversApplying} onChange=${(e: Event) => setAcknowledged((e.target as HTMLInputElement).checked)} /> I understand Apply may interrupt active turns across all chats.</label>
        <button class="settings-btn" type="button" disabled=${serversApplying || state.loading || !acknowledged || !state.previewed || !state.payload.applyAvailable || !state.preview?.applicable} onClick=${() => void controller.current?.apply(acknowledged)}>${state.applying ? 'Applying…' : 'Apply MCP settings'}</button>
        ${state.applied && html`<p role="status">MCP settings saved and applied to current and new sessions.</p>`}
        ${state.previewed && state.preview && html`<div role="status" aria-live="polite"><strong>${state.preview.applicable ? 'Preview compatible — not applied.' : 'Preview blocked — not applied.'}</strong>
          ${state.preview.issues.length > 0 && html`<ul>${state.preview.issues.map(issue => html`<li>${issue.serverName ? `${issue.serverName}: ` : ''}${issue.field} — ${issue.message}</li>`)}</ul>`}
        </div>`}
        <h4>Servers: native compatibility</h4>
        <p class="settings-hint">These are configuration classifications, not live connection states. A native-blocked server may work through the adapter.</p>
        ${state.payload.servers.length ? html`<ul>${state.payload.servers.map(server => html`<li><strong>${server.name}</strong> — ${server.nativeProjectionStatus}</li>`)}</ul>` : html`<p>No servers in the prepared configuration.</p>`}
      `}
      ${state.payload && html`<${McpServersSection} busy=${state.loading} onApplying=${setServersApplying} />`}
    </section>`;
}
