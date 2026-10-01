import { readFileSync, lstatSync, realpathSync } from 'node:fs';
import path from 'node:path';
import { getConfigPath, getWorkspaceDir } from './config-context.js';
import { getWorkspaceSearchConfig } from './config-tools.js';
import { readJsonConfig, writeJsonConfig } from './config-store.js';

export interface WorkspaceIndexPolicy { roots: string[]; ignorePatterns: string[] }
export class WorkspaceIndexPolicyChanged extends Error { constructor() { super('Workspace indexing policy changed; retry.'); } }
export const WORKSPACE_INDEX_DEFAULT_ROOTS = ['notes', '.pi/skills'];
const object = (value: unknown): Record<string, unknown> => value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {};
const protectedParts = new Set(['.piclaw', '.git', '.cache', 'node_modules', 'generated']);
export function workspaceIndexProtectedPath(name: string): boolean {
  const parts = name.split('/');
  return parts.some(p => protectedParts.has(p) || p === '.env' || p.startsWith('.env.'))
    || (parts[0] === '.pi' && parts[1] !== 'skills')
    || (parts[0] === 'notes' && ['users', 'family'].includes(parts[1] ?? ''));
}
function normalizedEntry(value: unknown, pattern: boolean): string {
  if (typeof value !== 'string' || value.length > 512) throw new Error('Each path or pattern must be a string of at most 512 characters.');
  const result = value.trim().replace(/\/+$/, '');
  if (!result || /[\\\x00-\x1f\x7f:!\[\]{}()]/.test(result) || result.startsWith('/') || result.split('/').some(p => !p || p === '.' || p === '..')) {
    throw new Error('Use workspace-relative paths; traversal, negation and extended pattern syntax are not supported.');
  }
  if (!pattern && /[*?#]/.test(result)) throw new Error('Indexed roots must be literal directory paths.');
  if (pattern && result.split('/').some(p => p.includes('**') && p !== '**')) throw new Error('Use ** as a whole path segment.');
  return result;
}
export function validateWorkspaceIndexPolicy(input: unknown): WorkspaceIndexPolicy {
  const value = object(input);
  if (Object.keys(value).some(k => !['roots', 'ignorePatterns'].includes(k)) || !Array.isArray(value.roots) || !Array.isArray(value.ignorePatterns)) {
    throw new Error('Provide roots and ignorePatterns arrays only.');
  }
  if (value.roots.length > 32 || value.ignorePatterns.length > 128 || JSON.stringify(value).length > 32768) throw new Error('Index policy exceeds 32 roots, 128 patterns or 32 KiB.');
  const roots = [...new Set(value.roots.map(r => normalizedEntry(r, false)))];
  if (roots.some(workspaceIndexProtectedPath)) throw new Error('Private/runtime paths cannot be indexed.');
  const ignorePatterns = [...new Set(value.ignorePatterns.map(p => {
    if (typeof p !== 'string' || p.length > 512) throw new Error('Invalid ignore pattern.');
    const line = p.trim();
    return !line || line.startsWith('#') ? line : normalizedEntry(line, true);
  }))];
  return { roots, ignorePatterns };
}
let cacheKey = '', cached: WorkspaceIndexPolicy | undefined;
export function getWorkspaceIndexPolicy(): WorkspaceIndexPolicy {
  const file = getConfigPath();
  let raw: string;
  try { raw = readFileSync(file, 'utf8'); } catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; raw = '{}'; }
  const config = object(JSON.parse(raw));
  const saved = object(object(config.web).workspace).indexing;
  const legacy = getWorkspaceSearchConfig().roots;
  const key = JSON.stringify([file, raw, legacy, getWorkspaceDir()]);
  if (cached && key === cacheKey) return { roots: [...cached.roots], ignorePatterns: [...cached.ignorePatterns] };
  let next: WorkspaceIndexPolicy;
  if (saved !== undefined) next = validateWorkspaceIndexPolicy(saved);
  else {
    // Adopt existing roots inside this workspace; legacy external roots no longer grant indexing access.
    const roots = legacy.length ? legacy.flatMap(root => {
      const relative = path.isAbsolute(root) ? path.relative(getWorkspaceDir(), root) : root;
      try { const r = normalizedEntry(relative, false); return workspaceIndexProtectedPath(r) ? [] : [r]; } catch { return []; }
    }) : WORKSPACE_INDEX_DEFAULT_ROOTS;
    next = validateWorkspaceIndexPolicy({ roots, ignorePatterns: [] });
  }
  cacheKey = key; cached = next;
  return { roots: [...next.roots], ignorePatterns: [...next.ignorePatterns] };
}
export function saveWorkspaceIndexPolicy(input: unknown): WorkspaceIndexPolicy {
  const policy = validateWorkspaceIndexPolicy(input);
  const file = getConfigPath(), config = readJsonConfig(file);
  const web = object(config.web), workspace = object(web.workspace);
  writeJsonConfig(file, { ...config, web: { ...web, workspace: { ...workspace, indexing: policy } } });
  return policy;
}
// Dynamic programming avoids regex backtracking on adversarial wildcard patterns.
function segmentMatches(pattern: string, name: string): boolean {
  let row=Array<boolean>(name.length+1).fill(false);row[0]=true;
  for(const c of pattern){const next=Array<boolean>(name.length+1).fill(false);next[0]=c==='*'&&row[0]!;
    for(let j=1;j<=name.length;j++)next[j]=c==='*'?(row[j]!||next[j-1]!):(row[j-1]!&&(c==='?'||c===name[j-1]));row=next;}
  return row[name.length]!;
}
function globMatches(pattern: string, name: string): boolean {
  const parts=name.split('/');let row=Array<boolean>(parts.length+1).fill(false);row[0]=true;
  for(const segment of pattern.split('/')){const next=Array<boolean>(parts.length+1).fill(false);next[0]=segment==='**'&&row[0]!;
    for(let j=1;j<=parts.length;j++)next[j]=segment==='**'?(row[j]!||next[j-1]!):(row[j-1]!&&segmentMatches(segment,parts[j-1]!));row=next;}
  return row[parts.length]!;
}
export function workspaceIndexPathDecision(name: string, policy = getWorkspaceIndexPolicy()): { included: boolean; reason: string; rule?: string } {
  if (!name || name.startsWith('/') || name.includes('\\') || name.split('/').some(p => !p || p === '.' || p === '..') || /[\x00-\x1f]/.test(name)) return { included: false, reason: 'Invalid workspace-relative path.' };
  if (workspaceIndexProtectedPath(name)) return { included: false, reason: 'Excluded by workspace safety rules.' };
  if (!policy.roots.some(root => name === root || name.startsWith(root + '/'))) return { included: false, reason: 'Outside indexed roots.' };
  const parts = name.split('/');
  for (const pattern of policy.ignorePatterns) {
    if (!pattern || pattern.startsWith('#')) continue;
    if (parts.some((_, i) => globMatches(pattern,parts.slice(0, i + 1).join('/')))) return { included: false, reason: 'Matched ignore pattern.', rule: pattern };
  }
  return { included: true, reason: 'Selected by indexed roots.' };
}
/** A scope is an intersection with configured roots, never a bypass around them. */
export function workspaceIndexPolicyRoots(scope?: string, policy = getWorkspaceIndexPolicy()): string[] {
  const prefix = scope === 'notes' ? 'notes' : scope === 'skills' ? '.pi/skills' : null;
  return [...new Set(policy.roots.flatMap(root => !prefix ? [root] : root === prefix || root.startsWith(prefix + '/') ? [root] : prefix.startsWith(root + '/') ? [prefix] : []))];
}
export function workspaceIndexPolicySnapshot() {
  const policy = getWorkspaceIndexPolicy(), key = JSON.stringify(policy); let changed = false;
  return { policy, validate: () => {
    if (changed || JSON.stringify(getWorkspaceIndexPolicy()) !== key) { changed = true; throw new WorkspaceIndexPolicyChanged(); }
  } };
}
/** Existing-path check shared by scanner and result publication. No links or private state. */
export function workspaceIndexSafePath(workspace: string, relative: string): boolean {
  if (!relative || workspaceIndexProtectedPath(relative) || relative.startsWith('/') || relative.includes('\\') || relative.split('/').some(p => !p || p === '.' || p === '..')) return false;
  try {
    const base = realpathSync(workspace), parts = relative.split('/');
    for (let i = 1; i <= parts.length; i++) {
      const full = path.join(base, ...parts.slice(0, i)), s = lstatSync(full);
      if (s.isSymbolicLink() || realpathSync(full) !== full || (i < parts.length && !s.isDirectory()) || (!s.isDirectory() && (!s.isFile() || s.nlink !== 1))) return false;
    }
    return true;
  } catch { return false; }
}
