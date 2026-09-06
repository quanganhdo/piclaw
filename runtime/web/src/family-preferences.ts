import { validateAccountPreferenceValues, type OwnAccountPreferences } from '../../src/core/account-preferences.js';
import { FamilyApi } from './family-api.js';
import { FamilyModelDefaults } from './family-model-defaults.js';

const node = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
/** Own preferences only; no localStorage, instance Settings or provider configuration. */
export class FamilyPreferences {
  private root = node<HTMLElement>('account-preferences');
  private form = node<HTMLFormElement>('preferences-form');
  private theme = node<HTMLSelectElement>('preferences-theme');
  private guidance = node<HTMLTextAreaElement>('preferences-guidance');
  private status = node<HTMLElement>('preferences-status');
  private snapshot: OwnAccountPreferences | null = null;
  private opened = false;
  private paused = false;
  private stopped = false;
  private busy = false;
  private generation = 0;
  private appliedRevision = -1;
  private modelDefaults: FamilyModelDefaults;
  constructor(private api: FamilyApi) {
    this.modelDefaults = new FamilyModelDefaults(api);
    node('open-preferences').addEventListener('click', () => { this.opened = true; this.paused = false; void this.load(true); });
    node('close-preferences').addEventListener('click', () => { this.opened = false; this.clear(); node('open-preferences').focus(); });
    node('refresh-preferences').addEventListener('click', () => { void this.load(); });
    node('reset-preferences').addEventListener('click', () => {
      if (!this.snapshot || this.busy) return;
      this.theme.value = this.snapshot.defaults.theme; this.guidance.value = this.snapshot.defaults.response_guidance;
      this.status.textContent = 'Defaults loaded into the form. Save to apply.';
    });
    this.form.addEventListener('submit', event => { event.preventDefault(); void this.save(); });
  }
  private parse(value: OwnAccountPreferences): OwnAccountPreferences {
    if (value?.user_id !== this.api.identity.userId || !Number.isSafeInteger(value.preferences?.revision) || value.preferences.revision < 0
      || typeof value.can_edit !== 'boolean') throw new Error('Invalid account preferences.');
    validateAccountPreferenceValues(value.preferences.theme, value.preferences.response_guidance);
    validateAccountPreferenceValues(value.defaults?.theme, value.defaults?.response_guidance);
    return value;
  }
  applyAppearance(value: OwnAccountPreferences): void {
    this.parse(value);
    if (this.stopped || document.hidden || value.preferences.revision < this.appliedRevision) return;
    this.appliedRevision = value.preferences.revision;
    if (value.preferences.theme === 'system') document.documentElement.removeAttribute('data-account-theme');
    else document.documentElement.dataset.accountTheme = value.preferences.theme;
  }
  private clear(): void {
    this.modelDefaults.clear();
    this.generation++; this.root.hidden = true; this.form.hidden = true; this.snapshot = null;
    this.theme.value = 'system'; this.guidance.value = ''; this.status.textContent = '';
  }
  suspend(): void {
    this.paused = true; this.clear(); this.appliedRevision = -1;
    document.documentElement.removeAttribute('data-account-theme'); node<HTMLButtonElement>('open-preferences').disabled = true;
  }
  resume(): void {
    if (this.stopped) return;
    node<HTMLButtonElement>('open-preferences').disabled = false;
    const wasPaused = this.paused; this.paused = false;
    if (wasPaused && this.opened && !this.busy) void this.load();
  }
  stop(): void { this.stopped = true; this.opened = false; this.suspend(); }
  private visible(): boolean { return this.opened && !this.stopped && !this.paused && !document.hidden; }
  private render(value: OwnAccountPreferences): void {
    this.snapshot = this.parse(value); this.applyAppearance(value);
    this.theme.value = value.preferences.theme; this.guidance.value = value.preferences.response_guidance; this.form.hidden = false;
    this.theme.disabled = this.guidance.disabled = node<HTMLButtonElement>('save-preferences').disabled = node<HTMLButtonElement>('reset-preferences').disabled = !value.can_edit;
    this.status.textContent = `Personal preferences · revision ${value.preferences.revision}. Response guidance applies to new model runs.`;
  }
  private async load(focus = false): Promise<void> {
    if (!this.visible() || this.busy) return;
    this.clear(); this.root.hidden = false; this.status.textContent = 'Loading preferences…'; const generation = this.generation;
    void this.modelDefaults.load();
    if (focus) node('preferences-heading').focus();
    try {
      const value = await this.api.request('/account/preferences');
      if (!this.visible() || generation !== this.generation) return;
      this.render(value);
    } catch (error) { if (this.visible() && generation === this.generation) this.status.textContent = (error as Error).message; }
  }
  private async save(): Promise<void> {
    if (!this.visible() || this.busy || !this.snapshot?.can_edit) return;
    let values;
    try { values = validateAccountPreferenceValues(this.theme.value, this.guidance.value); }
    catch { this.status.textContent = 'Use up to 2,000 characters of guidance without control/format characters.'; return; }
    const revision = this.snapshot.preferences.revision, generation = ++this.generation;
    this.busy = true; this.theme.disabled = this.guidance.disabled = true;
    node<HTMLButtonElement>('save-preferences').disabled = node<HTMLButtonElement>('reset-preferences').disabled = true;
    this.status.textContent = 'Saving personal preferences…';
    try {
      const value = await this.api.request('/account/preferences', 'PATCH', { expected_revision: revision, ...values });
      if (!this.visible() || generation !== this.generation) return;
      this.render(value); this.status.textContent = 'Preferences saved. Other accounts and global Settings are unchanged.';
    } catch (error) {
      if (this.visible() && generation === this.generation) this.status.textContent = `${(error as Error).message} Refresh before trying again; another tab may have saved changes. No automatic retry was made.`;
    } finally { this.busy = false; if (this.visible() && generation !== this.generation) void this.load(); }
  }
}
