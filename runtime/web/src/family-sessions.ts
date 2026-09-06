import type { SessionSettings } from '../../src/core/session-settings.js';
import { FamilyApi } from './family-api.js';
import { FamilyTranscript } from './family-transcript.js';

const node = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
type Branch = SessionSettings['branches'][number];
type Action = 'fork' | 'rename' | 'archive' | 'restore' | 'set_home';
const labels: Record<Action, string> = { fork: 'Fork', rename: 'Rename', archive: 'Archive', restore: 'Restore', set_home: 'Set home' };
const paths: Record<Action, string> = { fork: '/agent/branch-fork', rename: '/agent/branch-rename', archive: '/agent/branch-prune', restore: '/agent/branch-restore', set_home: '/account/home' };

/** Owner-only tree controls; all targeting comes from a pinned server snapshot. */
export class FamilySessions {
  private root = node<HTMLElement>('session-settings');
  private list = node<HTMLElement>('owned-tree-list');
  private status = node<HTMLElement>('session-settings-status');
  private editor = node<HTMLFormElement>('session-action-form');
  private name = node<HTMLInputElement>('session-action-name');
  private confirmation = node<HTMLInputElement>('session-action-confirm');
  private createName = node<HTMLInputElement>('root-name');
  private selected: { branch: Branch; action: Action } | null = null;
  private retry: { chat: string; name: string; id: string } | null = null;
  private opened = false;
  private paused = false;
  private stopped = false;
  private busy = false;
  private generation = 0;
  private canCreate = false;
  private transcript:FamilyTranscript;

  constructor(private api: FamilyApi, private hooks: { lock: (busy: boolean) => boolean; changed: () => Promise<void>; navigate: (jid: string) => Promise<void> }) {
    this.transcript=new FamilyTranscript(api);
    node('open-sessions').addEventListener('click', () => { this.opened = true; this.paused = false; void this.load(true); });
    node('close-sessions').addEventListener('click', () => { this.opened = false; this.clear(); node('open-sessions').focus(); });
    node('refresh-sessions').addEventListener('click', () => { void this.load(); });
    node('cancel-session-action').addEventListener('click', () => { this.resetAction(); });
    this.confirmation.addEventListener('change', () => { node<HTMLButtonElement>('submit-session-action').disabled = !this.confirmation.checked; });
    node('create-root-form').addEventListener('submit', event => {
      event.preventDefault(); if (!this.canCreate) return;
      const name = this.createName.value;
      void this.mutate('/agent/root-session', 'POST', { agent_name: name });
    });
    this.editor.addEventListener('submit', event => {
      event.preventDefault(); if (!this.selected) return;
      const { branch, action } = this.selected;
      if (branch.capabilities[action] !== true || (['archive', 'set_home'].includes(action) && !this.confirmation.checked)) return;
      const body: Record<string, string> = { chat_jid: branch.chat_jid };
      if (['fork', 'rename', 'restore'].includes(action)) body.agent_name = this.name.value;
      if (action === 'fork') {
        if (!this.retry || this.retry.chat !== branch.chat_jid || this.retry.name !== this.name.value) this.retry = { chat: branch.chat_jid, name: this.name.value, id: crypto.randomUUID() };
        body.request_id = this.retry.id;
      }
      void this.mutate(paths[action], action === 'set_home' ? 'PATCH' : 'POST', body);
    });
  }
  private visible(): boolean { return this.opened && !this.paused && !this.stopped && !document.hidden; }
  private resetAction(): void {
    this.selected = null; this.retry = null; this.name.value = ''; this.confirmation.checked = false;
    this.editor.hidden = true; node('session-action-title').textContent = ''; node('session-action-warning').textContent = '';
  }
  private clear(): void {
    this.transcript.clear();
    this.generation++; this.root.hidden = true; this.list.replaceChildren(); this.status.textContent = '';
    this.createName.value = ''; this.canCreate = false; this.resetAction(); node('session-home').textContent = '';
    node<HTMLButtonElement>('create-root').disabled = true;
  }
  suspend(): void { this.paused = true; this.clear(); }
  resume(): void { if (!this.paused || this.stopped) return; this.paused = false; if (this.opened && !this.busy) void this.load(); }
  stop(): void { this.stopped = true; this.opened = false; this.clear(); }
  private choose(branch: Branch, action: Action): void {
    if (!this.visible() || this.busy || branch.capabilities[action] !== true) return;
    this.transcript.clear();
    this.resetAction(); this.selected = { branch, action }; this.editor.hidden = false;
    node('session-action-title').textContent = `${labels[action]} @${branch.agent_name}`;
    const named = ['fork', 'rename', 'restore'].includes(action), confirmed = ['archive', 'set_home'].includes(action);
    node('session-action-name-field').hidden = !named; this.name.required = named; this.name.disabled = !named;
    this.name.value = action === 'fork' ? '' : branch.agent_name;
    node('session-action-confirm-field').hidden = !confirmed; this.confirmation.disabled = false;
    node<HTMLButtonElement>('submit-session-action').disabled = confirmed;
    node<HTMLButtonElement>('cancel-session-action').disabled = false;
    node('session-action-warning').textContent = action === 'archive' ? 'Archive retains history and files, and stops this session being used. Archive descendants first. The server requires an idle session.'
      : action === 'set_home' ? 'Use this owned root for future sign-ins and targetless requests. This does not change the conversation open in any tab. A sign-in within five minutes is required.'
      : action === 'restore' ? 'Restore under an active parent. Change the name if it is already in use. The server requires an idle session.'
      : action === 'fork' ? 'Fork your selected source at a stable turn boundary. An unchanged manual retry reuses its request ID while this form stays open.' : 'Change the friendly handle only. Internal identity, ownership and history remain unchanged.';
    (named ? this.name : this.confirmation).focus();
  }
  private render(value: SessionSettings): void {
    if (!Array.isArray(value?.branches) || !value.capabilities) throw new Error('Invalid owned session response.');
    this.canCreate = value.capabilities.create_root === true;
    node<HTMLButtonElement>('create-root').disabled = this.createName.disabled = !this.canCreate;
    node('session-home').textContent = `Home: ${value.home_chat_jid ?? 'not configured'}`;
    for (const branch of value.branches) {
      const row = document.createElement('li'), title = document.createElement('p'), buttons = document.createElement('div');
      title.textContent = `@${branch.agent_name} · ${branch.parent_branch_id ? 'Fork' : 'Root'} · ${branch.archived_at ? 'Archived' : 'Active'}${branch.chat_jid === value.home_chat_jid ? ' · Home' : ''} · ${branch.chat_jid}`;
      const add = (text: string, enabled: boolean, callback: () => void) => {
        const button = document.createElement('button'); button.type = 'button'; button.textContent = text; button.disabled = !enabled;
        button.addEventListener('click', callback); buttons.append(button);
      };
      add('Open', branch.capabilities?.open === true, () => { if (!this.busy && this.visible()) void this.hooks.navigate(branch.chat_jid); });
      add('Download transcript', branch.capabilities?.download_transcript === true && Boolean(branch.archived_at), () => {
        if (!this.busy && this.visible()) { this.resetAction(); this.transcript.choose(branch); }
      });
      for (const action of Object.keys(labels) as Action[]) add(labels[action], branch.capabilities?.[action] === true, () => this.choose(branch, action));
      row.append(title, buttons); this.list.append(row);
    }
  }
  private async load(focus = false): Promise<boolean> {
    if (!this.visible() || this.busy) return false;
    this.clear(); this.root.hidden = false; this.status.textContent = 'Loading owned sessions…';
    node<HTMLButtonElement>('refresh-sessions').disabled = false;
    const generation = this.generation;
    if (focus) node('session-settings-heading').focus();
    try {
      const value = await this.api.request('/account/trees');
      if (!this.visible() || generation !== this.generation) return false;
      this.render(value); this.status.textContent = ''; return true;
    } catch (error) { if (this.visible() && generation === this.generation) this.status.textContent = (error as Error).message; }
    return false;
  }
  private async mutate(path: string, method: string, body: Record<string, string>): Promise<void> {
    if (!this.visible() || this.busy || !this.hooks.lock(true)) return;
    this.transcript.clear();
    this.busy = true; const generation = ++this.generation;
    const disabled = Array.from(this.root.querySelectorAll<HTMLInputElement | HTMLButtonElement>('input,button')).filter(control => !control.disabled && !['close-sessions'].includes(control.id));
    for (const control of disabled) control.disabled = true;
    this.status.textContent = 'Saving…';
    let success = false;
    try { await this.api.request(path, method, body); success = true; }
    catch (error) { if (this.visible() && generation === this.generation) this.status.textContent = `${(error as Error).message} No automatic retry was made. Check the list before repeating a change; unchanged fork retries reuse their key while this form stays open.`; }
    finally {
      this.busy = false; this.hooks.lock(false);
      if (!this.visible() || generation !== this.generation) {
        await this.hooks.changed();
        if (this.visible()) void this.load(); return;
      }
      for (const control of disabled) control.disabled = false;
      const loaded = success ? await this.load() : false;
      // Never re-enable compose until the current target has been revalidated, even on failure.
      await this.hooks.changed();
      if (loaded && this.visible()) this.status.textContent = 'Session change saved. Use Open or Go home to change the conversation.';
    }
  }
}
