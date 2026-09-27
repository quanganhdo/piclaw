import { useId } from "preact/hooks";
import { useSignal } from "@preact/signals";
import { type SettingsData, type SettingsSectionProps } from "./types";
import { NumberStepper } from "./NumberStepper";
import { registerSettingsPane } from "./pane-registry";

export function GeneralSection({
  data,
  onSaveGeneral,
}: {
  data: SettingsData;
  onSaveGeneral: (field: string, value: unknown) => void;
}) {
  const prefix = useId();
  const assistantName = useSignal(data.assistantName ?? "");
  const userName = useSignal(data.userName ?? "");
  const composeUploadMb = useSignal(data.composeUploadLimitMb ?? 32);
  const workspaceUploadMb = useSignal(data.workspaceUploadLimitMb ?? 256);

  return (
    <section className="settings-panel__section settings-panel__section--general">
      <h2 className="settings-panel__section-title">General</h2>

      {data.version && (
        <div className="settings-panel__field">
          <label className="settings-panel__label">Version</label>
          <div className="settings-panel__field-content">
            <span className="settings-panel__description" style="font-family: var(--font-mono, monospace); font-size: 13px;">piclaw v{data.version}</span>
          </div>
        </div>
      )}

      <h3 className="settings-panel__subsection-title">Identity</h3>

      <div className="settings-panel__field">
        <label htmlFor={`${prefix}-user`} className="settings-panel__label">User name</label>
        <div className="settings-panel__field-content">
          <input
            className="settings-panel__input"
            type="text"
            id={`${prefix}-user`}
            aria-describedby={`${prefix}-user-hint`}
            value={userName.value}
            onInput={(e) => (userName.value = (e.target as HTMLInputElement).value)}
            onBlur={() => onSaveGeneral("userName", userName.value)}
            placeholder="Your name"
          />
          <span id={`${prefix}-user-hint`} className="settings-panel__description">Your display name in chat</span>
        </div>
      </div>

      <div className="settings-panel__field">
        <label htmlFor={`${prefix}-agent`} className="settings-panel__label">Agent name</label>
        <div className="settings-panel__field-content">
          <input
            className="settings-panel__input"
            type="text"
            id={`${prefix}-agent`}
            aria-describedby={`${prefix}-agent-hint`}
            value={assistantName.value}
            onInput={(e) => (assistantName.value = (e.target as HTMLInputElement).value)}
            onBlur={() => onSaveGeneral("assistantName", assistantName.value)}
            placeholder="Agent display name"
          />
          <span id={`${prefix}-agent-hint`} className="settings-panel__description">Display name for the AI agent</span>
        </div>
      </div>

      <h3 className="settings-panel__subsection-title">Notifications</h3>

      <div className="settings-panel__field">
        <label className="settings-panel__label">Browser notifications</label>
        <span className="settings-panel__description">Use the 🔔 bell button in the compose bar to enable/disable notifications. Web Push requires HTTPS or localhost.</span>
      </div>

      <h3 className="settings-panel__subsection-title">Instance Configuration</h3>

      <div className="settings-panel__field">
        <label htmlFor={`${prefix}-compose`} className="settings-panel__label">Compose upload (MB)</label>
        <div className="settings-panel__field-content">
          <NumberStepper id={`${prefix}-compose`} label="Compose upload (MB)" value={composeUploadMb} min={1} max={256} onSave={(v) => onSaveGeneral("composeUploadLimitMb", v)} />
          <span className="settings-panel__description">Chat/media attachments</span>
        </div>
      </div>

      <div className="settings-panel__field">
        <label htmlFor={`${prefix}-workspace`} className="settings-panel__label">Workspace upload (MB)</label>
        <div className="settings-panel__field-content">
          <NumberStepper id={`${prefix}-workspace`} label="Workspace upload (MB)" value={workspaceUploadMb} min={1} max={1024} onSave={(v) => onSaveGeneral("workspaceUploadLimitMb", v)} />
          <span className="settings-panel__description">Defaults to 256 MB; chunked uploads allow up to 1 GB</span>
        </div>
      </div>

      <h3 className="settings-panel__subsection-title">Models</h3>

      <div className="settings-panel__field settings-panel__checkbox-row">
        <input
          id="scopedModelsOnly"
          type="checkbox"
          checked={data.scopedModelsOnly ?? false}
          onChange={(e) =>
            onSaveGeneral(
              "scopedModelsOnly",
              (e.target as HTMLInputElement).checked
            )
          }
        />
        <label htmlFor="scopedModelsOnly" className="settings-panel__label">
          Restrict to scoped models only
        </label>
        <span className="settings-panel__description">Limit the model picker to models that have been explicitly scoped to this instance.</span>
      </div>

    </section>
  );
}


registerSettingsPane({
  id: "general",
  label: "General",
  icon: <i className="codicon codicon-gear" />,
  order: 10,
  component: ({ data, saveSetting }: SettingsSectionProps) => (
    <GeneralSection data={data} onSaveGeneral={(field, value) => saveSetting("general", field, value)} />
  ),
});
