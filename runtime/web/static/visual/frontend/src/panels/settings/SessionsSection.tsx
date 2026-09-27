import { useId } from "preact/hooks";
import { useSignal } from "@preact/signals";
import { type SettingsData, type SettingsSectionProps } from "./types";
import { NumberStepper } from "./NumberStepper";
import { registerSettingsPane } from "./pane-registry";
import { CustomSelect } from "../../components/CustomSelect";

export function SessionsSection({
  data,
  onSaveGeneral,
}: {
  data: SettingsData;
  onSaveGeneral: (field: string, value: unknown) => void;
}) {
  const prefix = useId();
  const sessionMaxSizeMb = useSignal(data.sessionMaxSizeMb ?? 0);
  const toolUseBudget = useSignal(data.toolUseBudget ?? 0);
  const recoveryAttempts = useSignal(data.automaticRecoveryMaxAttempts ?? 0);
  const recoveryBudget = useSignal(data.automaticRecoveryTotalBudgetMs ?? 0);

  return (
    <section className="settings-panel__section settings-panel__section--sessions">
      <h2 className="settings-panel__section-title">Sessions</h2>

      <h3 className="settings-panel__subsection-title">Session Lifecycle</h3>

      <div className="settings-panel__field settings-panel__checkbox-row">
        <input
          id="sessionAutoRotate"
          type="checkbox"
          checked={data.sessionAutoRotate ?? false}
          onChange={(e) =>
            onSaveGeneral("sessionAutoRotate", (e.target as HTMLInputElement).checked)
          }
        />
        <label htmlFor="sessionAutoRotate" className="settings-panel__label">
          Auto-rotate sessions
        </label>
        <span className="settings-panel__description">Automatically start new session when context is full</span>
      </div>

      <div className="settings-panel__field">
        <label className="settings-panel__label">Max session size (MB)</label>
        <div className="settings-panel__field-content">
          <NumberStepper value={sessionMaxSizeMb} min={1} max={500} onSave={(v) => onSaveGeneral("sessionMaxSizeMb", v)} />
          <span className="settings-panel__description">Maximum session context size before auto-compaction</span>
        </div>
      </div>

      <h3 className="settings-panel__subsection-title">Agent Behaviour</h3>

      <div className="settings-panel__field">
        <label className="settings-panel__label">Tool use budget</label>
        <div className="settings-panel__field-content">
          <NumberStepper value={toolUseBudget} min={0} max={200} onSave={(v) => onSaveGeneral("toolUseBudget", v)} />
          <span className="settings-panel__description">Max tool-call messages per turn</span>
        </div>
      </div>

      <div className="settings-panel__field">
        <label className="settings-panel__label">Session isolation</label>
        <div className="settings-panel__field-content">
          <CustomSelect
            value={data.sessionIsolation ?? "none"}
            options={[
              { value: "none", label: "None — full cross-session visibility" },
              { value: "summary", label: "Summary" },
              { value: "full", label: "Full" },
            ]}
            onChange={(val) => onSaveGeneral("sessionIsolation", val)}
          />
          <span className="settings-panel__description">Controls visibility between sessions</span>
        </div>
      </div>
      <h3 className="settings-panel__subsection-title">Agent recovery</h3>
      <div className="settings-panel__field settings-panel__checkbox-row">
        <input id={`${prefix}-recovery`} type="checkbox" checked={data.automaticRecoveryEnabled ?? true}
          onChange={(e) => onSaveGeneral("automaticRecoveryEnabled", (e.target as HTMLInputElement).checked)} />
        <label htmlFor={`${prefix}-recovery`} className="settings-panel__label">Automatic recovery</label>
      </div>
      <div className="settings-panel__field">
        <label htmlFor={`${prefix}-attempts`} className="settings-panel__label">Maximum recovery attempts</label>
        <div className="settings-panel__field-content">
          <NumberStepper id={`${prefix}-attempts`} label="Maximum recovery attempts" value={recoveryAttempts} min={0} onSave={(v) => onSaveGeneral("automaticRecoveryMaxAttempts", v)} />
          <span className="settings-panel__description">0 inherits the normal retry limit.</span>
        </div>
      </div>
      <div className="settings-panel__field">
        <label htmlFor={`${prefix}-budget`} className="settings-panel__label">Recovery time allowance (ms)</label>
        <div className="settings-panel__field-content">
          <NumberStepper id={`${prefix}-budget`} label="Recovery time allowance (ms)" value={recoveryBudget} min={0} step={1000} onSave={(v) => onSaveGeneral("automaticRecoveryTotalBudgetMs", v)} />
          <span className="settings-panel__description">0 derives a budget from the turn timeout (one-third, bounded to 6–60 minutes).{recoveryBudget.value === 0 && Number.isFinite(data.automaticRecoveryEffectiveBudgetMs) ? ` Effective allowance: ${data.automaticRecoveryEffectiveBudgetMs} ms.` : ""}</span>
        </div>
      </div>
    </section>
  );
}

registerSettingsPane({
  id: "sessions",
  label: "Sessions",
  icon: <i className="codicon codicon-terminal-bash" />,
  order: 12,
  component: ({ data, saveSetting }: SettingsSectionProps) => (
    <SessionsSection data={data} onSaveGeneral={(field, value) => saveSetting("general", field, value)} />
  ),
});
