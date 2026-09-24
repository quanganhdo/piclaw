import { PasskeySettings } from "../../../../../../shared/passkey-settings";
import { useSignal } from "@preact/signals";
import { useDialog } from "../../hooks/useDialog";
import { CopyButton } from "../../components/CopyButton";
import { registerSettingsPane } from "./pane-registry";
import type { SettingsSectionProps } from "./types";
import { sanitizeSvg } from "../../utils/agent-status";

function AuthenticationSection({ data, saveSetting }: SettingsSectionProps) {
  const totp = data.instanceTotp ?? {};
  const totpStatus = useSignal<string | null>(null);

  const { showConfirm } = useDialog();

  // ── TOTP ──────────────────────────────────────────────────────────────────

  async function enableTotp() {
    await saveSetting("general", "totp", true);
    totpStatus.value = "TOTP enabled ✓";
    setTimeout(() => (totpStatus.value = null), 3000);
    // Reload settings data by dispatching a reload event (settings panel listens)
    window.dispatchEvent(new CustomEvent("piclaw:reload-settings"));
  }

  async function disableTotp() {
    const confirmed = await showConfirm({
      title: "Disable TOTP?",
      message: "Disabling TOTP removes a layer of security. Anyone with your password will be able to log in without a second factor.",
      confirmLabel: "Disable",
      destructive: true,
    });
    if (!confirmed) return;
    await saveSetting("general", "totp", false);
    totpStatus.value = "TOTP disabled";
    setTimeout(() => (totpStatus.value = null), 3000);
    window.dispatchEvent(new CustomEvent("piclaw:reload-settings"));
  }

  // ── Render ────────────────────────────────────────────────────────────────

  return (
    <section className="settings-panel__section">
      <h2 className="settings-panel__section-title">Authentication</h2>

      {/* ── TOTP ── */}
      <h3 className="settings-panel__subsection-title">Two-Factor Authentication (TOTP)</h3>

      {totp.configured ? (
        <div className="settings-panel__field">
          <div style={{ display: "flex", alignItems: "center", gap: "10px", flexWrap: "wrap" }}>
            <span className="auth-section__badge auth-section__badge--enabled">
              <i className="codicon codicon-check" /> TOTP enabled
            </span>
            <button
              type="button"
              className="settings-panel__provider-btn settings-panel__provider-btn--logout"
              onClick={disableTotp}
            >
              Disable TOTP
            </button>
          </div>
          {totpStatus.value && (
            <p className="settings-panel__description" style={{ marginTop: "8px" }}>
              {totpStatus.value}
            </p>
          )}
        </div>
      ) : (
        <div className="settings-panel__field">
          <p className="settings-panel__description">
            Scan this QR code with your authenticator app, then click Enable.
          </p>

          {totp.qrSvg && (
            <div
              className="auth-section__qr"
              // eslint-disable-next-line react/no-danger
              dangerouslySetInnerHTML={{ __html: sanitizeSvg(totp.qrSvg) }}
            />
          )}

          {totp.secret && (
            <div className="settings-panel__field" style={{ marginTop: "12px" }}>
              <label className="settings-panel__label">Secret key</label>
              <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
                <code className="settings-panel__env-var">{totp.secret}</code>
                <CopyButton
                  text={totp.secret}
                  className="settings-panel__provider-btn"
                  title="Copy secret"
                >
                  <i className="codicon codicon-copy" />
                </CopyButton>
              </div>
            </div>
          )}

          {totp.otpauth && (
            <div className="settings-panel__field">
              <label className="settings-panel__label">OTPAuth URI</label>
              <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
                <code className="settings-panel__env-var auth-section__otpauth">{totp.otpauth}</code>
                <CopyButton
                  text={totp.otpauth}
                  className="settings-panel__provider-btn"
                  title="Copy OTPAuth URI"
                >
                  <i className="codicon codicon-copy" />
                </CopyButton>
              </div>
            </div>
          )}

          <div style={{ marginTop: "12px" }}>
            <button
              type="button"
              className="settings-panel__provider-btn"
              onClick={enableTotp}
            >
              Enable TOTP
            </button>
          </div>

          {totpStatus.value && (
            <p className="settings-panel__description" style={{ marginTop: "8px" }}>
              {totpStatus.value}
            </p>
          )}
        </div>
      )}

      <PasskeySettings />
    </section>
  );
}

registerSettingsPane({
  id: "authentication",
  label: "Authentication",
  icon: <i className="codicon codicon-shield" />,
  order: 55,
  component: (props: SettingsSectionProps) => <AuthenticationSection {...props} />,
});
