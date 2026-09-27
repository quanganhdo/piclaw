import { paneRegistry } from '../panes/pane-registry.js';

export interface AddonWorkspaceActionContext {
  readonly path: string;
  readonly type: 'file';
  readonly name: string;
  readonly size?: number;
  readonly contentType?: string;
  /** UI suggestion only. Backend must resolve and authorise the target. */
  readonly chatJid: string | null;
}
export interface AddonWorkspaceAction {
  id: string;
  label: string;
  title: string;
  /** Optional host-rendered preview icon; raw add-on SVG/HTML is not accepted. */
  icon?: 'review';
  when?: (context: AddonWorkspaceActionContext) => boolean;
  run: (context: AddonWorkspaceActionContext) => void | Promise<void>;
}
export interface AddonPaneRequest { path: string; label?: string; paneId: string }
const actions = new Map<string, AddonWorkspaceAction>();
const subscribers = new Set<() => void>();
let launcher: ((path: string, options: { label?: string; paneOverrideId: string }) => void) | null = null;

/** Reserved virtual namespace, never a workspace filesystem path. */
export function isAddonVirtualPath(path: unknown): path is string {
  return typeof path === 'string' && path.startsWith('piclaw://addon/');
}
export function validAddonVirtualPath(path: unknown): path is string {
  if (!isAddonVirtualPath(path) || path.length > 2048 || /[?#\s\\]/.test(path)) return false;
  const parts = path.slice('piclaw://addon/'.length).split('/');
  return parts.length >= 2 && /^[a-z0-9][a-z0-9._-]{0,63}$/.test(parts[0]!)
    && parts.slice(1).every(p => /^[a-zA-Z0-9_-]+$/.test(p));
}
export function workspaceActionContext(node: any, chatJid: string | null): AddonWorkspaceActionContext | null {
  const path = typeof node?.path === 'string' ? node.path : '';
  if (node?.type !== 'file' || !path || path.startsWith('/') || path.includes('://') || /[\\\0]/.test(path)
    || path.split('/').some(p => !p || p === '.' || p === '..')) return null;
  return Object.freeze({ path, type: 'file', name: path.split('/').pop()!,
    ...(Number.isFinite(node.size) ? { size: node.size } : {}),
    ...(typeof node.contentType === 'string' ? { contentType: node.contentType } : {}), chatJid });
}
export function subscribeWorkspaceActions(fn: () => void): () => void {
  subscribers.add(fn); return () => { subscribers.delete(fn); };
}
function changed() { for (const fn of subscribers) fn(); }
export function registerWorkspaceAction(action: AddonWorkspaceAction): () => void {
  if (!action || !/^[a-z0-9][a-z0-9._:-]{0,127}$/.test(action.id) || !action.label?.trim()
    || !action.title?.trim() || typeof action.run !== 'function') throw new Error('Invalid workspace action.');
  const registered = Object.freeze({ ...action });
  actions.set(action.id, registered); changed();
  return () => { if (actions.get(action.id) === registered) { actions.delete(action.id); changed(); } };
}
export function listWorkspaceActions(context: AddonWorkspaceActionContext | null): AddonWorkspaceAction[] {
  if (!context) return [];
  return [...actions.values()].filter(action => {
    try { return !action.when || action.when(context); } catch { return false; }
  });
}
/** Recheck registration and selection at invocation, not only when the menu rendered. */
export async function invokeWorkspaceAction(id: string, context: AddonWorkspaceActionContext | null): Promise<boolean> {
  const action = listWorkspaceActions(context).find(item => item.id === id);
  if (!action || !context) return false;
  // Server stat revalidates existence/root containment; it does not grant backend ownership.
  const response = await fetch(`/workspace/stat?path=${encodeURIComponent(context.path)}`, { credentials: 'same-origin', cache: 'no-store' });
  if (!response.ok) throw new Error('Selected workspace file is unavailable.');
  const stat = await response.json();
  if (stat.type !== 'file') throw new Error('Selected workspace entry is not a file.');
  if (actions.get(id) !== action) return false;
  await action.run(context); return true;
}
export function bindAddonPaneLauncher(fn: NonNullable<typeof launcher>): () => void {
  launcher = fn; return () => { if (launcher === fn) launcher = null; };
}
export function openAddonPane(request: AddonPaneRequest): boolean {
  if (!launcher || !request || !validAddonVirtualPath(request.path)) return false;
  const pane = paneRegistry.get(request.paneId);
  if (!pane || pane.placement !== 'tabs' || !pane.capabilities.includes('readonly') || pane.capabilities.includes('edit')) return false;
  try {
    if (!pane.canHandle?.({ path: request.path, mode: 'view' })) return false;
    launcher(request.path, { paneOverrideId: request.paneId, ...(request.label ? { label: request.label.slice(0, 160) } : {}) });
    return true;
  } catch { return false; }
}
export function resetAddonWorkspaceActionsForTests(): void { actions.clear(); launcher = null; changed(); subscribers.clear(); }
