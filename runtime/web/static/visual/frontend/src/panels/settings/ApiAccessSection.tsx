import { useEffect, useRef, useState } from "preact/hooks";
import { copyToClipboard } from "../../utils/clipboard";
import { useDialog } from "../../hooks/useDialog";
import type { SettingsData, SettingsSectionProps } from "./types";

export function ApiAccessSection({ data, mergeSettingsData }: SettingsSectionProps) {
  const [token, setToken] = useState(data.widgetToken ?? "");
  const [revealed, setRevealed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState<string | null>(null);
  const mounted = useRef(true);
  const { showConfirm } = useDialog();
  useEffect(() => { setToken(data.widgetToken ?? ""); }, [data.widgetToken]);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);

  async function copy() {
    const ok = await copyToClipboard(token);
    if (mounted.current) setStatus(ok ? "Copied" : "Could not copy token.");
  }

  async function regenerate() {
    if (busy) return;
    const confirmed = await showConfirm({
      title: "Regenerate widget token?",
      description: "Existing widgets using the old token will stop working. Continue?",
      confirmLabel: "Regenerate",
      destructive: true,
    });
    if (!confirmed || !mounted.current) return;
    setBusy(true);
    setStatus(null);
    try {
      const response = await fetch("/agent/settings/widget-token/regenerate", { method: "POST", credentials: "same-origin" });
      const payload = await response.json() as { ok?: boolean; settings?: SettingsData; error?: string };
      if (!response.ok || !payload.ok || !payload.settings) throw new Error(payload.error || "Failed to regenerate widget token.");
      mergeSettingsData?.(payload.settings);
      if (mounted.current) {
        setToken(payload.settings.widgetToken ?? "");
        setRevealed(false);
        setStatus("Token regenerated.");
      }
    } catch (error) {
      if (mounted.current) setStatus(error instanceof Error ? error.message : String(error));
    } finally {
      if (mounted.current) setBusy(false);
    }
  }

  return (
    <section className="settings-panel__section settings-panel__section--api-access">
      <h3 className="settings-panel__subsection-title">API access</h3>
      <div className="settings-panel__field">
        <label className="settings-panel__label">Widget token</label>
        <div className="settings-panel__field-content">
          <code className="settings-panel__env-var" style={{ overflowWrap: "anywhere" }}>{revealed ? token || "—" : token ? "•".repeat(32) : "—"}</code>
          <div style={{ display: "flex", gap: "8px", flexWrap: "wrap" }}>
            <button type="button" className="settings-panel__provider-btn" disabled={!token} onClick={() => setRevealed(!revealed)}>{revealed ? "Hide token" : "Reveal token"}</button>
            <button type="button" className="settings-panel__provider-btn" disabled={!token} onClick={copy}>Copy token</button>
            <button type="button" className="settings-panel__provider-btn" disabled={busy} onClick={regenerate}>{busy ? "Regenerating…" : "Regenerate"}</button>
          </div>
          <span className="settings-panel__description">Use this token for <code>GET /api/state</code> and <code>GET /api/state/events</code> with <code>Authorization: Bearer …</code>.</span>
          {status && <p role="status" aria-live="polite" className="settings-panel__description">{status}</p>}
        </div>
      </div>
    </section>
  );
}
