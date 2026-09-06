import type { FamilyWorkspacePolicy } from '../../src/core/family-workspace-policy.js';
import { FamilyApi } from './family-api.js';

const node = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
/** Read-only policy display; never fetches shared inventories, config values or private files. */
export class FamilyWorkspace {
  private root = node<HTMLElement>('workspace-policy');
  private details = node<HTMLElement>('workspace-policy-details');
  private status = node<HTMLElement>('workspace-policy-status');
  private opened = false;
  private paused = false;
  private stopped = false;
  private generation = 0;
  constructor(private api: FamilyApi) {
    node('open-workspace-policy').addEventListener('click', () => { this.opened = true; this.paused = false; void this.load(true); });
    node('close-workspace-policy').addEventListener('click', () => { this.opened = false; this.clear(); node('open-workspace-policy').focus(); });
    node('refresh-workspace-policy').addEventListener('click', () => { void this.load(); });
  }
  private clear(): void { this.generation++; this.root.hidden = true; this.details.replaceChildren(); this.status.textContent = ''; }
  suspend(): void { this.paused = true; this.clear(); node<HTMLButtonElement>('open-workspace-policy').disabled = true; }
  resume(): void {
    if (this.stopped) return;
    node<HTMLButtonElement>('open-workspace-policy').disabled = false;
    const paused = this.paused; this.paused = false;
    if (paused && this.opened) void this.load();
  }
  stop(): void { this.stopped = true; this.opened = false; this.clear(); node<HTMLButtonElement>('open-workspace-policy').disabled = true; }
  private visible(): boolean { return this.opened && !this.paused && !this.stopped && !document.hidden; }
  private render(value: FamilyWorkspacePolicy): void {
    if (value?.user_id !== this.api.identity.userId || value.deployment?.routing_mode !== 'family-shared'
      || value.deployment.activation_allowed !== false || value.deployment.container_isolation !== false
      || value.deployment.supported_startup_mode !== 'single-user'
      || !['single-user', 'family-shared', 'isolated-containers'].includes(value.deployment.configured_mode)
      || !['single-user', 'family-shared', 'isolated-containers'].includes(value.deployment.activated_mode)
      || value.tools?.policy !== 'fixed-family-web-preview' || value.tools.configurable !== false
      || !Array.isArray(value.tools.denied) || !Number.isSafeInteger(value.tools.revision) || value.tools.revision < 0
      || !Array.isArray(value.tools.allowed) || !Array.isArray(value.resources) || !Array.isArray(value.operations) || !Array.isArray(value.settings)
      || !Array.isArray(value.memory?.personal)) throw new Error('Unsupported workspace policy response. Refresh before using this preview.');
    const section = (title: string, lines: string[]) => {
      const group = document.createElement('section'); group.className = 'account-section';
      const heading = document.createElement('h3'); heading.textContent = title;
      const list = document.createElement('ul');
      for (const line of lines) { const item = document.createElement('li'); item.textContent = line; list.append(item); }
      group.append(heading, list); this.details.append(group);
    };
    const deployment = value.deployment;
    section('Deployment (not enabled for release)', [
      `Request routing: ${deployment.routing_mode}; configured mode: ${deployment.configured_mode}; stored activation marker: ${deployment.activated_mode}.`,
      `Supported startup mode: ${deployment.supported_startup_mode}. Family/isolated activation is blocked; no mode change or restart is available here.`,
      'Family mode uses a shared process and filesystem. Conversation ownership is application filtering, not container isolation. An OS-privileged user or installed extension remains trusted.',
    ]);
    section('Family workspace', value.resources.map(row => `${row.name} — ${row.scope}: ${row.detail}`));
    section('Security and capabilities', value.operations.map(row => `${row.name} — ${row.state}: ${row.detail}`));
    section('Admitted web-turn tool ceiling', [`Allowed: ${value.tools.allowed.join(', ') || 'none'}`, `Denied: ${value.tools.denied.join(', ') || 'none'}; policy revision ${value.tools.revision}`, value.tools.scope, 'Unknown tools deny. This list is read-only and does not grant access to other owners.']);
    section('Memory selection (not file confinement)', [...value.memory.personal, `Shared family memory: ${value.memory.family}`, 'These are selection paths, not private volume boundaries; this panel does not read the files.']);
    section('Settings scopes', value.settings.map(row => `${row.name} — ${row.scope}: ${row.availability}`));
  }
  private async load(focus = false): Promise<void> {
    if (!this.visible()) return;
    this.clear(); this.root.hidden = false; this.status.textContent = 'Loading workspace policy…'; const generation = this.generation;
    if (focus) node('workspace-policy-heading').focus();
    try {
      const value = await this.api.request('/account/workspace');
      if (!this.visible() || generation !== this.generation) return;
      this.render(value); this.status.textContent = '';
    } catch (error) { if (this.visible() && generation === this.generation) { this.details.replaceChildren(); this.status.textContent = (error as Error).message; } }
  }
}
