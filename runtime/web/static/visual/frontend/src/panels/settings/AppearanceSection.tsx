import { applyThemeFromEvent, selectLocalTheme, getThemeModePreference, setThemeModePreference } from '../../../../../../src/ui/theme';
import { useSignal } from "@preact/signals";
import { useRef, useEffect } from "preact/hooks";
import { type SettingsData, type SettingsSectionProps } from "./types";
import { AvatarSection } from "./AvatarSection";
import { registerSettingsPane } from "./pane-registry";
import { BUNDLED_THEMES, type BundledTheme } from "../../utils/bundled-themes";
import { CustomSelect } from "../../components/CustomSelect";
import {
  importVSCodeTheme,
  applyTheme,
  saveTheme,
  resetTheme,
  getSavedThemeVars,
  type VSCodeThemeJSON,
} from "../../utils/theme-importer";
import { safeGetItem, safeSetItem, safeRemoveItem } from "../../utils/storage";

export function AppearanceSection({
  data,
  onSaveGeneral,
}: {
  data: SettingsData;
  onSaveGeneral: (field: string, value: unknown) => void;
}) {
  const uiTint = useSignal(data.uiTint ?? "");

  // Current active custom theme name (stored in localStorage key piclaw_custom_theme_name)
  const LS_NAME_KEY = "piclaw_custom_theme_name";
  const activeThemeName = useSignal<string | null>(
    Object.keys(getSavedThemeVars()).length ? safeGetItem(LS_NAME_KEY) : BUNDLED_THEMES.find(t => t.id === (document.documentElement.dataset.colorTheme || data.uiTheme))?.name || null
  );
  const mode = useSignal(getThemeModePreference());

  useEffect(() => {
    const sync = () => {
      if (document.documentElement.dataset.customTheme === 'true') return;
      activeThemeName.value = BUNDLED_THEMES.find(t=>t.id === document.documentElement.dataset.colorTheme)?.name || null;
      uiTint.value = document.documentElement.dataset.tint || '';
      mode.value = getThemeModePreference();
    };
    window.addEventListener('piclaw-theme-change',sync);
    return () => window.removeEventListener('piclaw-theme-change',sync);
  }, []);

  // Pending import state
  const pendingVars = useSignal<Record<string, string> | null>(null);
  const pendingName = useSignal<string>("");
  const importStatus = useSignal<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  function applyBundled(theme: BundledTheme) {
    resetTheme();
    selectLocalTheme(theme.id);
    onSaveGeneral("uiTheme", theme.id);
    safeSetItem(LS_NAME_KEY, theme.name);
    activeThemeName.value = theme.name;
    importStatus.value = `Applied "${theme.name}" ✓`;
    pendingVars.value = null;
    setTimeout(() => { importStatus.value = null; }, 2500);
  }

  function handleReset() {
    resetTheme();
    selectLocalTheme('default');
    onSaveGeneral('uiTheme', 'default');
    safeRemoveItem(LS_NAME_KEY);
    activeThemeName.value = null;
    importStatus.value = "Reset to default ✓";
    setTimeout(() => { importStatus.value = null; }, 2500);
  }

  function handleFileChange(e: Event) {
    const file = (e.target as HTMLInputElement).files?.[0];
    if (!file) return;
    (e.target as HTMLInputElement).value = "";

    const reader = new FileReader();
    reader.onload = (ev) => {
      try {
        const json = JSON.parse(ev.target?.result as string) as VSCodeThemeJSON;
        const vars = importVSCodeTheme(json);
        if (Object.keys(vars).length === 0) {
          importStatus.value = "No recognized color keys found in this file.";
          setTimeout(() => { importStatus.value = null; }, 3000);
          return;
        }
        // Preview — apply but don't save yet
        applyTheme(vars);
        pendingVars.value = vars;
        pendingName.value = json.name ?? file.name.replace(/\.json$/i, "");
        importStatus.value = `Preview: "${pendingName.value}" — confirm to save`;
      } catch {
        importStatus.value = "Failed to parse theme file. Make sure it's valid JSON.";
        setTimeout(() => { importStatus.value = null; }, 3000);
      }
    };
    reader.readAsText(file);
  }

  function confirmImport() {
    if (!pendingVars.value) return;
    saveTheme(pendingVars.value);
    safeSetItem(LS_NAME_KEY, pendingName.value);
    activeThemeName.value = pendingName.value;
    importStatus.value = `Saved "${pendingName.value}" ✓`;
    pendingVars.value = null;
    setTimeout(() => { importStatus.value = null; }, 2500);
  }

  function cancelImport() {
    // Re-apply saved theme (or reset if none)
    const saved = getSavedThemeVars();
    if (Object.keys(saved).length > 0) {
      applyTheme(saved);
    } else {
      // Re-apply the currently active bundled theme if any
      const current = activeThemeName.value;
      if (current) {
        const bt = BUNDLED_THEMES.find((t) => t.name === current);
        if (bt) { resetTheme(); selectLocalTheme(bt.id); }
        else resetTheme();
      } else {
        resetTheme();
      }
    }
    pendingVars.value = null;
    importStatus.value = null;
  }

  return (
    <section className="settings-panel__section">
      <h2 className="settings-panel__section-title">Appearance</h2>

      {/* Theme selector */}
      <div className="settings-panel__field">
        <label htmlFor="appearance-theme" className="settings-panel__label">Theme</label>
        <div style={{ display: 'flex', alignItems: 'center', flexWrap:'wrap', gap: '10px', maxWidth:'100%' }}>
          <CustomSelect
            id="appearance-theme"
            value={activeThemeName.value || ''}
            options={[
              { value: '', label: 'Default' },
              ...BUNDLED_THEMES.map((t) => ({ value: t.name, label: `${t.name} (${t.type})` })),
            ]}
            onChange={(name) => {
              if (!name) {
                handleReset();
              } else {
                const bt = BUNDLED_THEMES.find((t) => t.name === name);
                if (bt) applyBundled(bt);
              }
            }}
          />
          <button className="settings-panel__btn" type="button" onClick={() => fileInputRef.current?.click()}>
            Import…
          </button>
          <button className="settings-panel__btn settings-panel__btn--secondary" type="button" onClick={handleReset}>
            Reset
          </button>
          {importStatus.value && (
            <span style={{ fontSize: '11px', color: 'var(--success, #a6e3a1)', marginLeft: '4px' }}>{importStatus.value}</span>
          )}
        </div>
      </div>

      <div className="settings-panel__field">
        <label className="settings-panel__label" htmlFor="appearance-mode">Automatic theme mode</label>
        <select id="appearance-mode" className="settings-panel__select" value={mode.value} onChange={e => { mode.value=e.currentTarget.value; setThemeModePreference(mode.value as 'auto'|'light'|'dark'); }}><option value="auto">Follow system</option><option value="light">Light</option><option value="dark">Dark</option></select>
        <p className="settings-panel__description">For Default, Solarized and GitHub in this browser. Named Light/Dark themes keep their mode.</p>
      </div>
      {/* Tint color — Default only; named palettes keep their authored accents. */}
      <div className="settings-panel__field">
        <label className="settings-panel__label">Tint color</label>
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
          <input
            type="color"
            aria-label="Default theme tint"
            value={uiTint.value || '#1d9bf0'}
            onInput={(e) => {
              uiTint.value = (e.target as HTMLInputElement).value;
              if (!activeThemeName.value) applyThemeFromEvent({theme:"default",tint:uiTint.value});
              onSaveGeneral("uiTint", uiTint.value);
            }}
            style={{ width: '28px', height: '28px', border: '1px solid var(--border)', borderRadius: '4px', cursor: 'pointer', background: 'transparent', padding: 0 }}
          />
          <span style={{ fontSize: '11px', color: 'var(--text-muted)' }}>{uiTint.value || 'none'}</span>
          {uiTint.value && (
            <button
              type="button"
              className="settings-panel__btn settings-panel__btn--secondary"
              style={{ padding: '2px 8px', fontSize: '11px' }}
              onClick={() => { uiTint.value = ''; if(!activeThemeName.value) applyThemeFromEvent({theme:'default',tint:null}); onSaveGeneral("uiTint", null); }}
            >
              Clear
            </button>
          )}
        </div>
      </div>

      {/* Pending import confirm/cancel */}
      {pendingVars.value && (
        <div style={{ display: 'flex', alignItems: 'center', gap: '10px', padding: '8px 0' }}>
          <span style={{ fontSize: '12px' }}>
            Preview: <strong>{pendingName.value}</strong>
          </span>
          <button className="settings-panel__btn" type="button" onClick={confirmImport}>Apply</button>
          <button className="settings-panel__btn settings-panel__btn--secondary" type="button" onClick={cancelImport}>Cancel</button>
        </div>
      )}


      <input
        ref={fileInputRef}
        type="file"
        accept=".json"
        style={{ display: "none" }}
        onChange={handleFileChange}
      />

      <AvatarSection />
    </section>
  );
}

registerSettingsPane({
  id: "appearance",
  label: "Appearance",
  icon: <i className="codicon codicon-paintcan" />,
  order: 45,
  component: ({ data, saveSetting }: SettingsSectionProps) => (
    <AppearanceSection data={data} onSaveGeneral={(field, value) => saveSetting("general", field, value)} />
  ),
});
