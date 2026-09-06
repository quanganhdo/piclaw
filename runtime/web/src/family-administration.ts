import type { AdministrationSettings } from '../../src/core/administration-settings.js';
import type { AdminSecurity, AdminSecurityRevocation } from '../../src/core/admin-security.js';
import type { AdminHome } from '../../src/core/admin-home.js';
import type { AdminToolPolicy } from '../../src/core/family-tool-restrictions.js';
import { FamilyApi } from './family-api.js';

const node = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
type User = AdministrationSettings['users'][number];
type Action = Exclude<keyof User['capabilities'], 'inspect_security' | 'assign_home' | 'restrict_tools'>;
const labels: Record<Action, string> = { disable: 'Disable', enable: 'Reactivate', change_role: 'Change role', invite: 'Issue invitation', invite_passkey: 'Issue passkey invitation', revoke_invitation: 'Revoke invitation', reset: 'Reset account', reset_passkey: 'Reset to passkey' };

/** No foreign conversation links, stored grants, automatic retries or impersonation. */
export class FamilyAdministration {
  private root = node<HTMLElement>('administration-settings');
  private list = node<HTMLElement>('administration-users');
  private status = node<HTMLElement>('administration-status');
  private form = node<HTMLFormElement>('administration-action');
  private confirm = node<HTMLInputElement>('administration-confirm');
  private confirmationName = node<HTMLInputElement>('administration-confirm-name');
  private username = node<HTMLInputElement>('new-account-username');
  private displayName = node<HTMLInputElement>('new-account-display-name');
  private role = node<HTMLSelectElement>('new-account-role');
  private link = node<HTMLInputElement>('administration-invitation-link');
  private selected: { user: User; action: Action } | { user: User; action: 'revoke_security'; input: AdminSecurityRevocation } | { user: User; action: 'assign_home'; branchId: string } | null = null;
  private opened = false;
  private paused = false;
  private stopped = false;
  private busy = false;
  private generation = 0;
  private canCreate = false;
  private expiry: ReturnType<typeof setTimeout> | null = null;
  private toolPolicy: AdminToolPolicy | null = null;

  constructor(private api: FamilyApi) {
    node('open-administration').addEventListener('click', () => { this.opened = true; this.paused = false; void this.load(true); });
    node('close-administration').addEventListener('click', () => { this.opened = false; this.clear(); node('open-administration').focus(); });
    node('refresh-administration').addEventListener('click', () => { void this.load(); });
    node('close-administration-security').addEventListener('click', () => { this.generation++; this.clearSecurity(); this.resetAction(); });
    node('close-administration-home').addEventListener('click', () => { this.generation++; this.clearHome(); this.resetAction(); });
    node('close-administration-tools').addEventListener('click', () => { this.generation++; this.clearTools(); });
    const toolConfirmState = () => { node<HTMLButtonElement>('save-administration-tools').disabled = this.busy || !this.toolPolicy
      || !node<HTMLInputElement>('administration-tools-confirm').checked || node<HTMLInputElement>('administration-tools-username').value !== this.toolPolicy.user.username; };
    node('administration-tools-confirm').addEventListener('change', toolConfirmState);
    node('administration-tools-username').addEventListener('input', toolConfirmState);
    node('administration-tools-form').addEventListener('submit', event => {
      event.preventDefault();
      if (!this.toolPolicy || this.busy || !this.visible() || node<HTMLButtonElement>('save-administration-tools').disabled) return;
      const policy = this.toolPolicy;
      const denied = Array.from(node('administration-tools-list').querySelectorAll<HTMLInputElement>('input:checked')).map(input => input.value);
      void this.mutate(`/admin/users/${encodeURIComponent(policy.user.id)}/tools`, 'PATCH', { confirm_username: policy.user.username, expected_revision: policy.policy.revision, denied_tools: denied });
    });
    node('clear-administration-invitation').addEventListener('click', () => this.clearGrant());
    node('cancel-administration-action').addEventListener('click', () => this.resetAction());
    const confirmState = () => { node<HTMLButtonElement>('submit-administration-action').disabled = this.busy || !this.confirm.checked || this.confirmationName.value !== this.selected?.user.username; };
    this.confirm.addEventListener('change', confirmState); this.confirmationName.addEventListener('input', confirmState);
    node('create-account-form').addEventListener('submit', event => {
      event.preventDefault(); if (!this.canCreate) return;
      void this.mutate('/admin/users', 'POST', { username: this.username.value, displayName: this.displayName.value, role: this.role.value });
    });
    this.form.addEventListener('submit', event => {
      event.preventDefault(); if (!this.selected || !this.confirm.checked || this.confirmationName.value !== this.selected.user.username) return;
      if (this.selected.action === 'assign_home') {
        if (this.selected.user.capabilities.assign_home !== true) return;
        void this.mutate(`/admin/users/${encodeURIComponent(this.selected.user.id)}/home`, 'PATCH', { branch_id: this.selected.branchId, confirm_username: this.selected.user.username }); return;
      }
      if (this.selected.action === 'revoke_security') {
        if (this.selected.user.capabilities.inspect_security !== true) return;
        void this.mutate(`/admin/users/${encodeURIComponent(this.selected.user.id)}/security/revoke`, 'POST', this.selected.input); return;
      }
      const { user, action } = this.selected;
      if (user.capabilities[action] !== true) return;
      const path = `/admin/users/${encodeURIComponent(user.id)}`;
      if (action === 'invite_passkey' || action === 'reset_passkey') { void this.mutate(path + (action === 'invite_passkey' ? '/passkey-invitation' : '/reset-passkey'), 'POST', { confirm_username: user.username }, true); return; }
      if (action === 'invite' || action === 'revoke_invitation') void this.mutate(path + '/invitation', action === 'invite' ? 'POST' : 'DELETE', undefined, action === 'invite');
      else if (action === 'reset') void this.mutate(path + '/reset', 'POST', { confirm_username: user.username }, true);
      else void this.mutate(path, 'PATCH', action === 'change_role' ? { role: user.role === 'admin' ? 'member' : 'admin' } : { enabled: action === 'enable' });
    });
  }
  private visible(): boolean { return this.opened && !this.paused && !this.stopped && !document.hidden && this.api.identity.manageUsers; }
  private clearGrant(): void {
    if (this.expiry) clearTimeout(this.expiry); this.expiry = null; this.link.value = '';
    node('administration-invitation').hidden = true; node('administration-invitation-expiry').textContent = '';
  }
  private resetAction(): void {
    this.selected = null; this.confirm.checked = false; this.confirmationName.value = ''; this.form.hidden = true;
    node('administration-action-title').textContent = ''; node('administration-action-warning').textContent = '';
    node<HTMLButtonElement>('submit-administration-action').disabled = true;
  }
  private clear(): void {
    this.clearTools();
    this.clearHome();
    this.clearSecurity();
    this.generation++; this.clearGrant(); this.resetAction(); this.root.hidden = true; this.list.replaceChildren();
    this.username.value = ''; this.displayName.value = ''; this.role.value = 'member'; this.status.textContent = '';
    node('administration-auth-notice').textContent = ''; this.canCreate = false; node<HTMLButtonElement>('create-account').disabled = true;
  }
  suspend(): void { this.paused = true; this.clear(); node<HTMLButtonElement>('open-administration').disabled = true; }
  resume(): void {
    const button = node<HTMLButtonElement>('open-administration'); button.hidden = !this.api.identity.manageUsers;
    button.disabled = this.stopped || !this.api.identity.manageUsers;
    if (!this.api.identity.manageUsers) { this.opened = false; this.clear(); return; }
    const wasPaused = this.paused; this.paused = false;
    if (wasPaused && this.opened && !this.busy && !this.stopped) void this.load();
  }
  stop(): void { this.stopped = true; this.opened = false; this.clear(); node('open-administration').hidden = true; }
  private choose(user: User, action: Action): void {
    if (!this.visible() || this.busy || user.capabilities[action] !== true) return;
    this.generation++; this.clearSecurity();
    this.clearTools();
    this.clearHome();
    this.clearGrant(); this.resetAction(); this.selected = { user, action }; this.form.hidden = false;
    this.confirm.disabled = this.confirmationName.disabled = false;
    node<HTMLButtonElement>('cancel-administration-action').disabled = false;
    node('administration-action-title').textContent = `${labels[action]} @${user.username}`;
    node('administration-action-warning').textContent = action === 'reset_passkey'
      ? 'Disable this account, delete every sign-in factor, sign out every device and issue a passkey-only invitation. History and ownership remain unchanged. Setup must prove possession; no normal login is issued.'
      : action === 'invite_passkey' ? 'Issue a private one-use passkey invitation. It replaces any previous invitation or pending authenticator setup. The recipient must create and verify a discoverable passkey within five minutes; no TOTP is required.'
      : action === 'reset'
      ? 'Disable this account, delete all of its sign-in factors, sign out every device and issue a new authenticator invitation. History and ownership remain unchanged. You can replace this user’s authentication; this does not open their conversations.'
      : action === 'invite' ? 'Issue a private one-use authenticator invitation. This replaces any previous grant or pending enrolment. The new link is shown once; keep it private.'
      : action === 'revoke_invitation' ? 'Revoke this account’s current invitation and pending authenticator or passkey enrolment.'
      : action === 'change_role' ? `Change this account to ${user.role === 'admin' ? 'member' : 'administrator'} and sign out every device. Administrators can manage accounts and reset other users’ sign-in factors.`
      : action === 'disable' ? 'Disable this account and revoke its logins and pending enrolments. Existing data remains stored.'
      : 'Reactivate this account using its existing usable factors and owned home. No login is issued.';
    this.confirmationName.focus();
  }
  private render(snapshot: AdministrationSettings): void {
    if (!snapshot?.capabilities || !Array.isArray(snapshot.users)) throw new Error('Invalid administration response.');
    this.canCreate = snapshot.capabilities.create_user === true;
    node<HTMLButtonElement>('create-account').disabled = this.username.disabled = this.displayName.disabled = this.role.disabled = !this.canCreate;
    node('administration-auth-notice').textContent = snapshot.recent_auth === true ? 'Account changes require a sign-in within five minutes.' : 'Sign in again before changing accounts.';
    this.list.replaceChildren();
    for (const user of snapshot.users) {
      const row = document.createElement('li'), title = document.createElement('p'), buttons = document.createElement('div');
      title.textContent = `${user.display_name} (@${user.username}) · ${user.role} · ${user.enabled ? 'Enabled' : 'Disabled'} · Invitation: ${user.invitation}`;
      for (const action of Object.keys(labels) as Action[]) {
        const button = document.createElement('button'); button.type = 'button'; button.textContent = labels[action]; button.disabled = user.capabilities?.[action] !== true;
        button.addEventListener('click', () => this.choose(user, action)); buttons.append(button);
      }
      const security = document.createElement('button'); security.type = 'button'; security.textContent = 'Security';
      security.disabled = user.capabilities.inspect_security !== true;
      security.addEventListener('click', () => { void this.loadSecurity(user); }); buttons.append(security);
      const home = document.createElement('button'); home.type = 'button'; home.textContent = 'Home'; home.disabled = user.capabilities.assign_home !== true;
      home.addEventListener('click', () => { void this.loadHome(user); }); buttons.append(home);
      const tools = document.createElement('button'); tools.type = 'button'; tools.textContent = 'Tool restrictions'; tools.disabled = user.capabilities.restrict_tools !== true;
      tools.addEventListener('click', () => { void this.loadTools(user); }); buttons.append(tools);
      row.append(title, buttons); this.list.append(row);
    }
  }
  private clearSecurity(): void {
    node('administration-security').hidden = true; node('administration-security-title').textContent = '';
    node('administration-security-items').replaceChildren();
  }
  private clearHome(): void {
    node('administration-home').hidden = true; node('administration-home-title').textContent = ''; node('administration-home-roots').replaceChildren();
  }
  private clearTools(): void {
    this.toolPolicy = null; node('administration-tools').hidden = true; node('administration-tools-title').textContent = '';
    node('administration-tools-list').replaceChildren(); node<HTMLInputElement>('administration-tools-username').value = '';
    node<HTMLInputElement>('administration-tools-confirm').checked = false; node<HTMLButtonElement>('save-administration-tools').disabled = true;
  }
  private async loadTools(user: User): Promise<void> {
    if (!this.visible() || this.busy || user.capabilities.restrict_tools !== true) return;
    this.clearTools(); this.clearHome(); this.clearSecurity(); this.clearGrant(); this.resetAction(); const generation = ++this.generation;
    this.status.textContent = 'Loading tool restrictions…';
    try {
      const value: AdminToolPolicy = await this.api.request(`/admin/users/${encodeURIComponent(user.id)}/tools`);
      if (!this.visible() || generation !== this.generation) return;
      if (value?.user?.id !== user.id || value.user.username !== user.username || !Array.isArray(value.ceiling) || !Array.isArray(value.policy?.denied)
        || !Number.isSafeInteger(value.policy.revision) || value.policy.revision < 0) throw new Error('Invalid tool policy. Refresh before continuing.');
      this.toolPolicy = value; node('administration-tools').hidden = false;
      node('administration-tools-title').textContent = `Tool restrictions for @${user.username} · revision ${value.policy.revision}`;
      for (const name of value.ceiling) {
        const label = document.createElement('label'), input = document.createElement('input'); input.type = 'checkbox'; input.value = name; input.checked = value.policy.denied.includes(name);
        label.append(input, document.createTextNode(` Deny ${name}`)); node('administration-tools-list').append(label);
      }
      node<HTMLInputElement>('administration-tools-username').disabled = false; node<HTMLInputElement>('administration-tools-confirm').disabled = false;
      node<HTMLButtonElement>('close-administration-tools').disabled = false; this.status.textContent = '';
    } catch (error) { if (this.visible() && generation === this.generation) this.status.textContent = (error as Error).message; }
  }
  private async loadHome(user: User): Promise<void> {
    if (!this.visible() || this.busy || user.capabilities.assign_home !== true) return;
    this.clearTools();
    this.clearHome(); this.clearSecurity(); this.clearGrant(); this.resetAction(); const generation = ++this.generation;
    this.status.textContent = 'Loading eligible home roots…';
    try {
      const value: AdminHome = await this.api.request(`/admin/users/${encodeURIComponent(user.id)}/home`);
      if (!this.visible() || generation !== this.generation) return;
      if (value?.user?.id !== user.id || value.user.username !== user.username || !Array.isArray(value.roots)) throw new Error('Account changed. Refresh before continuing.');
      node('administration-home').hidden = false; node('administration-home-title').textContent = `Home for @${user.username}`;
      node<HTMLButtonElement>('close-administration-home').disabled = false;
      const list = node('administration-home-roots');
      for (const root of value.roots) {
        const item = document.createElement('li'), label = document.createElement('span'), button = document.createElement('button');
        label.textContent = `@${root.agent_name} · ${root.branch_id}${root.current ? ' · Current home' : ''}`;
        button.type = 'button'; button.textContent = 'Assign home'; button.disabled = root.current === true;
        button.addEventListener('click', () => {
          if (!this.visible() || this.busy) return;
          this.resetAction(); this.selected = { user, action: 'assign_home', branchId: root.branch_id }; this.form.hidden = false;
          this.confirm.disabled = this.confirmationName.disabled = false; node<HTMLButtonElement>('cancel-administration-action').disabled = false;
          node('administration-action-title').textContent = `Assign home for @${user.username}`;
          node('administration-action-warning').textContent = `Use @${root.agent_name} (${root.branch_id}) for future sign-ins and targetless requests. Existing conversations, active runs, ownership and logins remain unchanged. This does not open the target account or change its container destination.`;
          this.confirmationName.focus();
        });
        item.append(label, button); list.append(item);
      }
      if (!value.roots.length) list.textContent = 'No eligible owned roots. Provision or repair ownership before assigning a home.';
      this.status.textContent = '';
    } catch (error) { if (this.visible() && generation === this.generation) this.status.textContent = (error as Error).message; }
  }
  private async loadSecurity(user: User): Promise<void> {
    if (!this.visible() || this.busy || user.capabilities.inspect_security !== true) return;
    this.clearTools();
    this.clearHome();
    this.clearGrant(); this.clearSecurity(); this.resetAction(); const generation = ++this.generation;
    this.status.textContent = 'Loading account security…';
    try {
      const value: AdminSecurity = await this.api.request(`/admin/users/${encodeURIComponent(user.id)}/security`);
      if (!this.visible() || generation !== this.generation) return;
      if (value?.user?.id !== user.id || value.user.username !== user.username || !value.factors || !Array.isArray(value.factors.passkeys) || !Array.isArray(value.sessions)) throw new Error('Account changed. Refresh before continuing.');
      node('administration-security').hidden = false; node('administration-security-title').textContent = `Security for @${user.username}`;
      node<HTMLButtonElement>('close-administration-security').disabled = false;
      const list = node('administration-security-items');
      const add = (text: string, enabled: boolean, input: AdminSecurityRevocation) => {
        const row = document.createElement('li'), description = document.createElement('span'), button = document.createElement('button');
        description.textContent = text; button.type = 'button'; button.textContent = input.kind === 'session' ? 'Revoke device login' : 'Remove factor'; button.disabled = !enabled;
        button.addEventListener('click', () => {
          if (!this.visible() || this.busy) return;
          this.resetAction(); this.selected = { user, action: 'revoke_security', input }; this.form.hidden = false;
          this.confirm.disabled = this.confirmationName.disabled = false; node<HTMLButtonElement>('cancel-administration-action').disabled = false;
          node('administration-action-title').textContent = `Revoke security item for @${user.username}`;
          node('administration-action-warning').textContent = `${text}. ${input.kind === 'session' ? 'Sign out only this device login and cancel its pending registrations.' : 'Remove this factor and sign out every device for this account. The last usable factor cannot be removed.'} History and ownership remain unchanged.`;
          this.confirmationName.focus();
        });
        row.append(description, button); list.append(row);
      };
      if (value.factors.totp.enrolled) add('Authenticator (TOTP)', value.factors.totp.removable === true, { kind: 'totp', confirm_username: user.username });
      for (const key of value.factors.passkeys) add(`${key.label || 'Unnamed passkey'} · ${key.credential_id} · Last used ${key.last_used_at ?? 'never'}${key.usable ? '' : ' · Not usable under current policy'}`, key.removable === true, { kind: 'passkey', item_id: key.credential_id, confirm_username: user.username });
      for (const session of value.sessions) add(`${session.label || 'Unnamed login'} · ${session.session_id} · ${session.auth_method} · Expires ${session.expires_at}`, true, { kind: 'session', item_id: session.session_id, confirm_username: user.username });
      if (!list.childElementCount) list.textContent = 'No sign-in factors or active device logins.';
      this.status.textContent = '';
    } catch (error) { if (this.visible() && generation === this.generation) this.status.textContent = (error as Error).message; }
  }
  private async load(focus = false): Promise<void> {
    if (!this.visible() || this.busy) return;
    this.clear(); this.root.hidden = false; this.status.textContent = 'Loading accounts…';
    node<HTMLButtonElement>('refresh-administration').disabled = false;
    const generation = this.generation; if (focus) node('administration-heading').focus();
    try {
      const snapshot = await this.api.request('/admin/users/settings');
      if (!this.visible() || generation !== this.generation) return;
      this.render(snapshot); this.status.textContent = '';
    } catch (error) { if (this.visible() && generation === this.generation) this.status.textContent = (error as Error).message; }
  }
  private showGrant(value: any): void {
    if (typeof value?.token !== 'string' || !/^[A-Za-z0-9_-]{43}$/.test(value.token) || !Number.isFinite(value.expiresAt) || value.expiresAt <= Date.now() || value.expiresAt > Date.now() + 15 * 60_000) throw new Error('Invitation response unavailable. Revoke and reissue explicitly.');
    if (value.method !== undefined && !['totp','passkey'].includes(value.method)) throw new Error('Invalid invitation method.');
    this.link.value = `${location.origin}/auth/invitation#token=${value.token}${value.method === 'passkey' ? '&method=passkey' : ''}`;
    this.link.disabled = false; node<HTMLButtonElement>('clear-administration-invitation').disabled = false;
    node('administration-invitation-expiry').textContent = `Expires ${new Date(value.expiresAt).toISOString()}`;
    node('administration-invitation').hidden = false;
    this.expiry = setTimeout(() => this.clearGrant(), value.expiresAt - Date.now());
  }
  private async mutate(path: string, method: string, body?: unknown, grant = false): Promise<void> {
    if (!this.visible() || this.busy) return;
    this.busy = true; this.clearGrant(); const generation = ++this.generation;
    const enabled = Array.from(this.root.querySelectorAll<HTMLInputElement | HTMLButtonElement | HTMLSelectElement>('input,button,select')).filter(control => !control.disabled && control.id !== 'close-administration');
    for (const control of enabled) control.disabled = true;
    this.status.textContent = 'Saving…';
    try {
      const result = await this.api.request(path, method, body);
      if (!this.visible() || generation !== this.generation) return;
      const snapshot = await this.api.request('/admin/users/settings');
      if (!this.visible() || generation !== this.generation) return;
      this.resetAction(); this.clearSecurity(); this.clearHome(); this.clearTools(); this.username.value = ''; this.displayName.value = ''; this.role.value = 'member'; this.render(snapshot);
      this.status.textContent = grant ? 'Invitation issued. Copy the link privately now; blur or close clears it.' : 'Account change saved.';
      if (grant) this.showGrant(result);
    } catch (error) {
      if (this.visible() && generation === this.generation) this.status.textContent = `${(error as Error).message} No automatic retry was made. Refresh before repeating; a lost invitation response requires explicit revocation and reissue.`;
    } finally {
      this.busy = false;
      if (this.visible() && generation === this.generation) {
        // Snapshot rendering owns field/button capability state; do not re-enable stale controls.
        node<HTMLButtonElement>('refresh-administration').disabled = false;
        if (!this.form.hidden) { this.confirm.disabled = false; this.confirmationName.disabled = false; node<HTMLButtonElement>('cancel-administration-action').disabled = false; }
      } else if (this.visible()) void this.load();
    }
  }
}
