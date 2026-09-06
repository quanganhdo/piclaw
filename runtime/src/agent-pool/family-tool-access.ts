import { readAccessConfig } from '../core/config-access.js';
import { getExecutionIdentity } from '../core/execution-context.js';
import { isFamilyWebToolAllowed } from '../core/family-workspace-policy.js';
import { ChatAccessDenied } from '../db/session-ownership.js';
import { requireOwnedSource } from './owned-session-target.js';

/** Direct store/discovery tool boundary. Use the run snapshot, revalidate live source authority. */
export function requireFamilyToolAccess(name: string): void {
  const mode = readAccessConfig().mode, identity = getExecutionIdentity();
  if (mode === 'single-user' && (!identity || identity.mode === 'single-user')) return;
  if (mode !== 'family-shared' || identity?.mode !== mode || !isFamilyWebToolAllowed(name)) throw new ChatAccessDenied();
  const policy = identity.toolPolicy;
  if (!policy || !Number.isSafeInteger(policy.revision) || policy.revision < 0 || !Array.isArray(policy.allowed) || !Array.isArray(policy.denied)
    || !policy.allowed.includes(name) || policy.denied.includes(name)) throw new ChatAccessDenied();
  // New runs pick up new denials. Existing runs keep their snapshot, but logout,
  // disable, role/ownership changes and a mismatched source must still deny now.
  requireOwnedSource();
}
