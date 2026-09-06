import { ACCOUNT_THINKING_LEVELS, validateAccountModelDefaults, type OwnAccountModelDefaults } from '../../src/core/account-model-defaults.js';
import { FamilyApi } from './family-api.js';
const node = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;

/** Separate revision/form from appearance. Never writes shared provider or session settings. */
export class FamilyModelDefaults {
  private form = node<HTMLFormElement>('model-defaults-form');
  private model = node<HTMLSelectElement>('default-model');
  private thinking = node<HTMLSelectElement>('default-thinking');
  private status = node('model-defaults-status');
  private snapshot: OwnAccountModelDefaults | null = null;
  private active = false;
  private busy = false;
  private generation = 0;
  constructor(private api: FamilyApi) {
    node('refresh-model-defaults').addEventListener('click', () => { if (this.active && !this.busy) void this.load(); });
    this.model.addEventListener('change', () => { this.thinkingOptions(null); });
    node('reset-model-defaults').addEventListener('click', () => { if (this.busy || !this.snapshot?.can_edit) return; this.model.value = ''; this.thinkingOptions(null); this.status.textContent = 'Instance defaults selected. Save to apply to empty owned roots.'; });
    this.form.addEventListener('submit', event => { event.preventDefault(); void this.save(); });
  }
  clear(): void {
    this.active = false; this.generation++; this.form.hidden = true; this.snapshot = null;
    this.model.replaceChildren(); this.thinking.replaceChildren(); this.status.textContent = '';
    node('model-defaults-effective').textContent = ''; node<HTMLButtonElement>('refresh-model-defaults').disabled = true;
  }
  private valid(generation: number): boolean { return this.active && !document.hidden && generation === this.generation; }
  private option(select: HTMLSelectElement, value: string, text: string): void {
    const option = document.createElement('option'); option.value = value; option.textContent = text; select.append(option);
  }
  private thinkingOptions(value: string | null): void {
    this.thinking.replaceChildren(); this.option(this.thinking, '', 'Use instance thinking default');
    const model = this.snapshot?.models.find(model => model.label === this.model.value);
    for (const level of model?.thinking_levels ?? []) this.option(this.thinking, level, level);
    if (value && !model?.thinking_levels.includes(value as any)) this.option(this.thinking, value, `${value} (unavailable)`);
    this.thinking.value = value ?? ''; this.thinking.disabled = !this.model.value || this.snapshot?.can_edit !== true;
  }
  private render(value: OwnAccountModelDefaults): void {
    if (value?.user_id !== this.api.identity.userId || !Number.isSafeInteger(value.preferences?.revision) || value.preferences.revision < 0 || !Array.isArray(value.models)
      || !value.effective || !['account','instance'].includes(value.effective.source) || typeof value.effective.available !== 'boolean') throw new Error('Invalid model defaults.');
    validateAccountModelDefaults(value.preferences.model, value.preferences.thinking_level);
    if (value.effective.model !== null) validateAccountModelDefaults(value.effective.model, value.effective.thinking_level);
    for (const model of value.models) {
      validateAccountModelDefaults(model.label, null);
      if (typeof model.name !== 'string' || !Array.isArray(model.thinking_levels) || !model.thinking_levels.length || model.thinking_levels.some(level => !ACCOUNT_THINKING_LEVELS.includes(level))) throw new Error('Invalid model choices.');
    }
    this.snapshot = value; this.model.replaceChildren(); this.option(this.model, '', 'Use instance model default');
    for (const model of value.models) this.option(this.model, model.label, `${model.name} · ${model.label}`);
    if (value.preferences.model && !value.models.some(model => model.label === value.preferences.model)) this.option(this.model, value.preferences.model, `${value.preferences.model} (unavailable)`);
    this.model.value = value.preferences.model ?? ''; this.thinkingOptions(value.preferences.thinking_level);
    this.model.disabled = node<HTMLButtonElement>('save-model-defaults').disabled = node<HTMLButtonElement>('reset-model-defaults').disabled = value.can_edit !== true;
    node('model-defaults-effective').textContent = value.effective.model
      ? `Configured ${value.effective.source} default: ${value.effective.model} · thinking ${value.effective.thinking_level ?? 'instance'}${value.effective.available ? '' : ' · unavailable; choose another model or use instance defaults'}`
      : 'No explicit instance model default. The runtime selects an available model when the empty root is first opened.';
    this.form.hidden = false; this.status.textContent = `Model defaults · revision ${value.preferences.revision}. Existing conversations and forks keep their selection.`;
  }
  async load(): Promise<void> {
    this.clear(); this.active = true;
    if (this.busy) return;
    const generation = this.generation; this.status.textContent = 'Loading model defaults…';
    try {
      const value = await this.api.request('/account/model-defaults');
      if (this.valid(generation)) this.render(value);
    } catch (error) { if (this.valid(generation)) this.status.textContent = (error as Error).message; }
    finally { if (this.valid(generation)) node<HTMLButtonElement>('refresh-model-defaults').disabled = false; }
  }
  private async save(): Promise<void> {
    if (!this.active || document.hidden || this.busy || this.snapshot?.can_edit !== true) return;
    let values;
    try { values = validateAccountModelDefaults(this.model.value || null, this.thinking.value || null); }
    catch (error) { this.status.textContent = (error as Error).message; return; }
    const revision = this.snapshot.preferences.revision, generation = ++this.generation; this.busy = true;
    for (const control of this.form.querySelectorAll<HTMLSelectElement | HTMLButtonElement>('select,button')) control.disabled = true;
    this.status.textContent = 'Saving model defaults…';
    try {
      const value = await this.api.request('/account/model-defaults', 'PATCH', { expected_revision: revision, ...values });
      if (this.valid(generation)) { this.render(value); this.status.textContent = 'Model defaults saved. Existing conversations and shared settings are unchanged.'; }
    } catch (error) { if (this.valid(generation)) this.status.textContent = `${(error as Error).message} Refresh before trying again. No automatic retry was made.`; }
    finally { this.busy = false; if (this.active && generation !== this.generation && !document.hidden) void this.load(); }
  }
}
