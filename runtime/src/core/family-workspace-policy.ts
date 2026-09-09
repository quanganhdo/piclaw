import type { AccessMode } from './config-access.js';

/** Fixed ceiling for admitted family web turns, not a configurable role permission matrix. */
export const FAMILY_WEB_TOOLS = Object.freeze([
  'read', 'ls', 'find', 'grep', 'messages', 'session_status', 'session_control', 'chat', 'search_tool_output',
] as const);
export function isFamilyWebToolAllowed(name: string): boolean {
  return (FAMILY_WEB_TOOLS as readonly string[]).includes(name);
}

export interface FamilyWorkspacePolicy {
  user_id: string;
  deployment: { routing_mode: 'family-shared'; configured_mode: AccessMode; activated_mode: AccessMode; supported_startup_mode: 'family-shared'; activation_allowed: false; container_isolation: false };
  tools: { policy: 'fixed-family-web-preview'; configurable: false; allowed: string[]; denied: string[]; revision: number; scope: string };
  resources: { name: string; scope: 'shared' | 'owner-selected' | 'account-private' | 'browser-memory'; detail: string }[];
  operations: { name: string; state: 'owner-scoped' | 'admin-metadata' | 'shared-read' | 'denied'; detail: string }[];
  settings: { name: string; scope: string; availability: string }[];
  memory: { personal: string[]; family: string };
  skills: { precedence: 'packaged-first'; entries: import('./family-skill-provenance.js').FamilySkillProvenance[] };
}
