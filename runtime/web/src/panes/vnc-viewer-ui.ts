/** Pane-scoped presentation only; protocol, credentials and socket lifetime stay in VncPaneInstance. */
export function escapeVncHtml(value: unknown): string {
  return String(value ?? "").replace(
    /[&<>"']/g,
    (c) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[
        c
      ]!,
  );
}
export function installVncViewerStyles(doc: Document): void {
  if (doc.getElementById("vnc-viewer-styles")) return;
  const style = doc.createElement("style");
  style.id = "vnc-viewer-styles";
  style.textContent = `
.vnc-pane-shell{position:relative;display:flex;flex-direction:column;width:100%;height:100%;min-width:0;container:vnc-pane / inline-size;background:var(--bg-primary);color:var(--text-primary);font-size:13px}
.vnc-pane-shell [hidden]{display:none!important}
.vnc-pane-body{flex:1;min-height:0;min-width:0;position:relative;display:flex}
.vnc-pane-shell button,.vnc-pane-shell input,.vnc-pane-shell textarea{font:inherit;-webkit-appearance:none;appearance:none;color:inherit;border:1px solid var(--border-color,#444);border-radius:6px;background:var(--bg-primary,#141414);padding:6px 10px;box-sizing:border-box}
.vnc-pane-shell button{cursor:pointer}.vnc-pane-shell button:hover{background:var(--bg-hover,#292929)}.vnc-pane-shell button:disabled{opacity:.5;cursor:default}
.vnc-pane-shell :is(button,input,textarea,summary):focus-visible{outline:2px solid var(--accent-color,#1d9bf0);outline-offset:2px}
.vnc-pane-shell input,.vnc-pane-shell textarea{width:100%;min-width:0}.vnc-pane-shell h2{font-size:17px;margin:0 0 12px}.vnc-pane-shell h3{font-size:13px;margin:18px 0 8px}.vnc-pane-shell p{font-size:12px;color:var(--text-secondary);margin:8px 0 14px}
.vnc-manager{box-sizing:border-box;width:100%;min-width:0;min-height:0;overflow:auto;padding:16px;display:grid;grid-template-columns:minmax(0,1fr);gap:20px;align-content:start}
.vnc-manager-toolbar{grid-column:1 / -1}.vnc-connect-panel{grid-column:1;grid-row:auto}.vnc-saved-panel{grid-column:1;min-width:0;border-top:1px solid var(--border-color,#444);padding-top:20px}
.vnc-manager section{min-width:0}.vnc-endpoint{display:grid;grid-template-columns:minmax(0,1fr) 80px;gap:10px}.vnc-manager label{display:block;margin-bottom:12px}.vnc-manager label>span{display:block;margin-bottom:4px}.vnc-connect{width:100%;margin-top:12px}
.vnc-history-row{display:flex;align-items:center;gap:6px;border-bottom:1px solid var(--border-color,#444);padding:8px 0}.vnc-history-row .vnc-history-open{flex:1;text-align:left;min-width:0;border:0;background:none}.vnc-history-row .vnc-history-open{overflow:hidden;padding-left:0;padding-right:4px}.vnc-history-row strong,.vnc-history-row small{display:block;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.vnc-history-row :is([data-pin],[data-remove]){flex:0 0 32px;width:32px;height:32px;padding:0}.vnc-manager [data-vnc-clear]{margin-top:12px}.vnc-manager details>label{margin-top:10px}.vnc-manager summary{cursor:pointer}.vnc-manager p:empty{display:none}.vnc-manager .vnc-help{font-size:12px;color:var(--text-secondary);margin-top:12px}.vnc-manager .vnc-help p{margin-bottom:0}.vnc-history-row small{font-size:11px;color:var(--text-secondary)}
.vnc-session{width:100%;height:100%;min-width:0;min-height:0;position:relative;overflow:hidden;background:#000}.vnc-stage{width:100%;height:100%;display:flex;align-items:center;justify-content:center;overflow:hidden}.vnc-stage canvas{display:none;background:#000;outline:none;max-width:100%;max-height:100%}
.vnc-cue{position:absolute;top:0;left:50%;transform:translateX(-50%);width:50px;height:24px;z-index:3;padding:0!important;border-radius:0 0 6px 6px!important}
.vnc-cue-hidden:not(:focus-visible){opacity:0;pointer-events:none}
.vnc-controls{position:absolute;top:28px;left:50%;transform:translateX(-50%);z-index:4;max-height:calc(100% - 36px);overflow:auto;width:min(330px,calc(100% - 24px));padding:12px;box-sizing:border-box;border:1px solid var(--border-color,#444);border-radius:8px;background:var(--bg-primary,#151515);color:var(--text-primary,#eee);box-shadow:0 8px 24px #0008}
.vnc-controls header{display:flex;align-items:center;gap:8px;margin-bottom:10px}.vnc-controls [data-vnc-hide]{flex:0 0 32px;width:32px;height:32px;padding:0}.vnc-actions button{min-width:0;white-space:normal;overflow-wrap:anywhere}.vnc-controls header strong{flex:1;min-width:0;overflow-wrap:anywhere}.vnc-actions{display:grid;gap:6px}.vnc-actions button{text-align:left}.vnc-controls textarea{height:100px;resize:vertical}.vnc-controls details{margin-top:12px}.vnc-controls pre{white-space:pre-wrap;overflow-wrap:anywhere;font:11px/1.5 monospace}.vnc-controls label{display:block;margin-bottom:6px}.vnc-controls p{overflow-wrap:anywhere}
.vnc-message{position:absolute;inset:0;display:grid;place-content:center;text-align:center;gap:10px;padding:24px;background:#000a;color:#eee;pointer-events:none}.vnc-message p{color:#ddd}.vnc-controls .vnc-danger{color:var(--error-color,#e66)}
/* Layout follows the docked/popout pane, not the browser viewport. Single-column is the safe fallback. */
@container vnc-pane (min-width:720px){.vnc-manager{padding:24px;grid-template-columns:minmax(0,1fr) minmax(0,.9fr);gap:24px}.vnc-connect-panel{grid-column:2;grid-row:1}.vnc-saved-panel{grid-column:1;grid-row:1;border-top:0;padding-top:0}.vnc-manager-toolbar{grid-row:1}.vnc-manager:has(.vnc-manager-toolbar) :is(.vnc-connect-panel,.vnc-saved-panel){grid-row:2}}
@container vnc-pane (max-width:319px){.vnc-manager{padding:12px;gap:16px}.vnc-endpoint{grid-template-columns:minmax(0,1fr) 76px;gap:8px}}
@media (pointer:coarse){.vnc-pane-shell input,.vnc-pane-shell textarea{font-size:16px}.vnc-history-row button{min-height:36px}}
`;
  doc.head.appendChild(style);
}
export function vncSessionMarkup(label: string, readOnly: boolean): string {
  return `<div class="vnc-session" data-vnc-session-shell>
    <div class="vnc-stage" data-display-stage><canvas data-display-canvas tabindex="0" aria-label="Remote desktop. Control Alt Shift V opens local controls."></canvas></div>
    <div class="vnc-message" data-display-placeholder><strong>${escapeVncHtml(label)}</strong><p data-vnc-progress>Connecting…</p></div>
    <button class="vnc-cue vnc-cue-hidden" data-vnc-cue aria-label="Show VNC controls" aria-expanded="false">⌄</button>
    <section class="vnc-controls" data-vnc-session-chrome hidden aria-label="VNC controls">
      <header><strong>${escapeVncHtml(label)}</strong><button data-vnc-hide aria-label="Hide VNC controls">×</button></header>
      <p data-vnc-state role="status">Connecting…</p>
      <div class="vnc-actions"><button data-vnc-reconnect>Reconnect</button><button data-open-target-picker>Connections &amp; history</button><button class="vnc-danger" data-vnc-disconnect>Disconnect</button></div>
      <details data-vnc-auth><summary>Password</summary><label>VNC password<input type="password" data-vnc-password autocomplete="off" placeholder="Optional"></label><button data-vnc-auth-connect>Connect</button></details>
      <details data-vnc-clipboard-panel><summary>Clipboard</summary><label>Text<textarea data-vnc-clipboard spellcheck="false" placeholder="Paste here to send, or receive remote clipboard text"></textarea></label><div class="vnc-actions"><button data-vnc-send-clipboard ${readOnly ? "disabled" : ""}>Send to remote</button><button data-vnc-copy-clipboard>Copy remote text</button><button data-vnc-paste-clipboard>Paste from this device</button></div><p data-vnc-clipboard-status role="status"></p></details>
      <details><summary>Connection details</summary><pre data-display-info></pre><pre data-display-meta></pre><p>${readOnly ? "Read-only" : "Interactive"} · WebSocket → TCP proxy</p></details>
    </section>
  </div>`;
}
