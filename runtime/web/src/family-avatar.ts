import { ACCOUNT_AVATAR_INPUT_BYTES, ACCOUNT_AVATAR_TYPES, type OwnAccountAvatar } from '../../src/core/account-avatar.js';
import { FamilyApi } from './family-api.js';

const node = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;

/** Only canonical server rasters become blob URLs. No URL, path or original-file preview. */
export class FamilyAvatar {
  private snapshot: OwnAccountAvatar | null = null;
  private generation = 0;
  private active = false;
  private busy = false;
  private url: string | null = null;
  private image = node<HTMLImageElement>('account-avatar-image');
  private file = node<HTMLInputElement>('account-avatar-file');
  private message = node('account-avatar-status');
  private confirm = node<HTMLInputElement>('account-avatar-confirm');
  constructor(private api: FamilyApi) {
    node('refresh-account-avatar').addEventListener('click', () => { if (this.active && !this.busy) void this.load(); });
    this.file.addEventListener('change', () => {
      if (!this.active || !this.snapshot || this.busy || document.hidden) { this.file.value = ''; return; }
      const file = this.file.files?.[0];
      if (file && (!file.size || file.size > ACCOUNT_AVATAR_INPUT_BYTES || !(ACCOUNT_AVATAR_TYPES as readonly string[]).includes(file.type))) {
        this.file.value = ''; this.message.textContent = 'Choose a PNG, JPEG or WebP image up to 2 MiB.';
      }
      node<HTMLButtonElement>('save-account-avatar').disabled = this.snapshot.can_edit !== true || !this.file.files?.length;
    });
    node('account-avatar-form').addEventListener('submit', event => {
      event.preventDefault();
      const file = this.file.files?.[0], snapshot = this.snapshot;
      if (file && snapshot?.can_edit === true) void this.mutate(() => this.api.uploadAvatar(file, snapshot.revision), 'Avatar saved.');
    });
    this.confirm.addEventListener('change', () => { node<HTMLButtonElement>('remove-account-avatar').disabled = !this.confirm.checked || this.snapshot?.can_edit !== true || !this.snapshot.present || this.busy; });
    node('remove-account-avatar').addEventListener('click', () => {
      const snapshot = this.snapshot;
      if (this.confirm.checked && snapshot?.can_edit === true && snapshot.present) void this.mutate(() => this.api.request('/account/avatar', 'DELETE', { expected_revision: snapshot.revision }), 'Avatar removed.');
    });
  }
  private disable(): void {
    for (const control of node('account-avatar').querySelectorAll<HTMLInputElement | HTMLButtonElement>('input,button')) control.disabled = true;
  }
  clear(): void {
    this.active = false; this.generation++; this.snapshot = null; this.file.value = ''; this.confirm.checked = false;
    this.image.hidden = true; this.image.removeAttribute('src');
    if (this.url) URL.revokeObjectURL(this.url); this.url = null;
    this.message.textContent = ''; this.disable();
  }
  private valid(generation: number): boolean { return this.active && !document.hidden && this.generation === generation; }
  async load(): Promise<void> {
    this.clear(); this.active = true;
    if (this.busy) return;
    const generation = this.generation; this.message.textContent = 'Loading avatar…';
    try {
      const value: OwnAccountAvatar = await this.api.request('/account/avatar');
      if (!this.valid(generation)) return;
      if (value?.user_id !== this.api.identity.userId || !Number.isSafeInteger(value.revision) || value.revision < 0 || typeof value.present !== 'boolean') throw new Error('Invalid avatar response.');
      if (value.present) {
        const blob = await this.api.avatarImage();
        if (!this.valid(generation)) return;
        this.url = URL.createObjectURL(blob); this.image.src = this.url; this.image.hidden = false;
      }
      this.snapshot = value; this.file.disabled = value.can_edit !== true; this.confirm.disabled = value.can_edit !== true || !value.present;
      this.message.textContent = value.present ? 'Your saved avatar. Shared only with your signed-in account in this preview.' : 'No account avatar.';
    } catch (error) { if (this.valid(generation)) this.message.textContent = (error as Error).message; }
    finally { if (this.valid(generation)) node<HTMLButtonElement>('refresh-account-avatar').disabled = false; }
  }
  private async mutate(operation: () => Promise<unknown>, success: string): Promise<void> {
    if (!this.active || document.hidden || this.busy) return;
    this.busy = true; const generation = ++this.generation; this.file.value = ''; this.confirm.checked = false; this.disable(); this.message.textContent = 'Saving avatar…';
    let failure = '';
    try { await operation(); }
    catch (error) { failure = `${(error as Error).message} Refresh before trying again; the change may already have completed.`; }
    finally {
      this.busy = false;
      if (this.valid(generation)) {
        if (failure) { this.message.textContent = failure; node<HTMLButtonElement>('refresh-account-avatar').disabled = false; }
        else { await this.load(); if (this.valid(generation+1)) this.message.textContent = success; }
      } else if (this.active && !document.hidden) { void this.load(); }
    }
  }
}
