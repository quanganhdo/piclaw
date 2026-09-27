import { ApiAccessSection } from "./ApiAccessSection";
import { PasskeySettings } from "../../../../../../shared/passkey-settings";
import { useId } from "preact/hooks";
import { CopyButton } from "../../components/CopyButton";
import { registerSettingsPane } from "./pane-registry";
import type { SettingsSectionProps } from "./types";
import { sanitizeSvg } from "../../utils/agent-status";

function AuthenticationSection(props: SettingsSectionProps) {
  const { data } = props;
  const totp = data.instanceTotp ?? {};
  const prefix = useId();
  return (
    <section className="settings-panel__section settings-panel__section--authentication">
      <h2 className="settings-panel__section-title">Authentication</h2>
      <h3 className="settings-panel__subsection-title">Two-Factor Authentication (TOTP)</h3>
      <p className="settings-panel__description">
        {totp.configured ? "TOTP is configured for this instance." : "TOTP is not configured for this instance yet, so no setup QR is available."}
      </p>
      {totp.configured && <>
        {totp.qrSvg && <div className="auth-section__qr" dangerouslySetInnerHTML={{ __html: sanitizeSvg(totp.qrSvg) }} />}
        {([ ["issuer", "Issuer", totp.issuer], ["label", "Label", totp.label], ["secret", "Secret", totp.secret], ["uri", "OTPAuth URI", totp.otpauth] ] as const).map(([key, label, value]) => (
          <div className="settings-panel__field" key={key}>
            <label htmlFor={`${prefix}-${key}`} className="settings-panel__label">{label}</label>
            <div className="settings-panel__field-content">
              <input id={`${prefix}-${key}`} className="settings-panel__input" type="text" readOnly value={value ?? ""} />
              {value && (key === "secret" || key === "uri") && <CopyButton text={value} title={`Copy ${label}`} className="settings-panel__provider-btn"><i className="codicon codicon-copy" /></CopyButton>}
            </div>
          </div>
        ))}
      </>}
      <p className="settings-panel__description">To enrol an authenticator, use <code>/totp enrol</code> in chat. To replace the secret, use <code>/totp reset &lt;current code&gt;</code>. Changes require confirmation through the enrolment flow.</p>
      <PasskeySettings />
      <ApiAccessSection {...props} />
    </section>
  );
}

registerSettingsPane({
  id: "authentication",
  label: "Authentication",
  icon: <i className="codicon codicon-shield" />,
  order: 55,
  component: AuthenticationSection,
});
