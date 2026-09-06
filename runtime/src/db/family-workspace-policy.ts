import type Database from 'bun:sqlite';
import type { AuthenticatedPrincipal } from '../core/access-types.js';
import { readAccessConfig } from '../core/config-access.js';
import type { FamilyWorkspacePolicy } from '../core/family-workspace-policy.js';
import { requireAccountActor } from './account-administration.js';
import { readAccessState } from './access-state.js';
import { readFamilyToolPolicy } from './family-tool-restrictions.js';

/** Own identity + non-secret policy metadata only; no file, provider, add-on or keychain enumeration. */
export function readFamilyWorkspacePolicy(database: Database, actor: AuthenticatedPrincipal): FamilyWorkspacePolicy {
  const configured = readAccessConfig();
  return database.transaction((): FamilyWorkspacePolicy => {
    const user = requireAccountActor(database, actor), state = readAccessState(database);
    const tools = readFamilyToolPolicy(database, user.id);
    return {
      user_id: user.id,
      deployment: { routing_mode: 'family-shared', configured_mode: configured.mode, activated_mode: state.activatedMode,
        supported_startup_mode: 'single-user', activation_allowed: false, container_isolation: false },
      tools: { policy: 'fixed-family-web-preview', configurable: false, allowed: [...tools.allowed], denied: [...tools.denied], revision: tools.revision,
        scope: 'Administrator restrictions narrow the fixed preview ceiling for new runs. A running turn retains its policy snapshot, including recovery replacement. Active tools may be fewer. Direct tools, queues, add-ons and transports still require integrated release verification.' },
      resources: [
        { name: 'Workspace files', scope: 'shared', detail: 'One workspace and OS identity. File reads are shared; application ownership checks do not confine filesystem access.' },
        { name: 'Skills and add-ons', scope: 'shared', detail: 'Installed skills, add-ons and their global configuration are shared. Per-user installation and arbitrary add-on APIs are unavailable in this preview.' },
        { name: 'Workspace search index', scope: 'shared', detail: 'One workspace index; it is not a private conversation index. The family browser does not expose workspace search.' },
        { name: 'Providers and tool credentials', scope: 'shared', detail: 'Provider credentials/configuration and permitted integrations belong to the instance. The preview exposes no provider login, generic keychain or environment editor.' },
        { name: 'Conversation trees', scope: 'account-private', detail: 'HTTP/store-tool reads are checked against active root ownership. Administrators manage metadata, not another owner’s transcript.' },
        { name: 'Authentication factors', scope: 'account-private', detail: 'TOTP ciphertext and enrolment grants use dedicated authentication tables, outside generic keychain listing/injection. Shared-machine privileged processes remain trusted.' },
        { name: 'Personal memory and preferences', scope: 'owner-selected', detail: 'Automatic memory selection uses immutable user ID paths. This is prompt selection, not filesystem isolation. Shared files are not attributed to a user automatically.' },
        { name: 'Browser state', scope: 'browser-memory', detail: 'The family shell keeps drafts and selections in memory. Identity changes clear them. Legacy service-worker/offline-origin migration is not yet verified.' },
      ],
      operations: [
        { name: 'File inspection', state: tools.allowed.some(name => ['read', 'ls', 'find', 'grep'].includes(name)) ? 'shared-read' : 'denied', detail: 'When permitted below, read, ls, find and grep operate on the shared filesystem; do not store private material there expecting user confinement.' },
        { name: 'Messages and session discovery', state: tools.allowed.some(name => ['messages', 'session_status', 'session_control', 'chat'].includes(name)) ? 'owner-scoped' : 'denied', detail: 'When permitted below, messages reads, session_status, session_control inspect/assess_stuck and chat directory are restricted to active owned sessions. Cross-session sends/control writes are disabled.' },
        { name: 'Account management', state: user.role === 'admin' ? 'admin-metadata' : 'owner-scoped', detail: user.role === 'admin' ? 'Own account plus explicit administrator account/security/home APIs. Sensitive reads/writes require recent authentication. No target impersonation or transcript access.' : 'Own profile, factors, devices and owned-session lifecycle only. Sensitive operations require recent authentication.' },
        { name: 'Terminal and remote desktop', state: 'denied', detail: 'Family terminal/VNC HTTP and WebSocket entry points are disabled.' },
        { name: 'Shell and file mutation', state: 'denied', detail: 'Shell, exec, scripts, write and edit tools are outside the admitted web-turn ceiling. This is not a sandbox against an OS-level process or installed extension.' },
        { name: 'Keychain, SQL and environment editing', state: 'denied', detail: 'No generic keychain, raw SQL or environment tools in admitted web turns; raw SQL also denies at its multi-user tool boundary.' },
        { name: 'Add-on management and external automation', state: 'denied', detail: 'Family browser add-on APIs and installed panes are disabled; unknown tools are outside the fixed ceiling.' },
        { name: 'Scheduling, Dream and notifications', state: 'denied', detail: 'Family scheduling and automatic Dream/push flows need durable owner provenance and recipient binding. They are not enabled by account creation.' },
      ],
      settings: [
        { name: 'Account names, factors and device labels', scope: 'user', availability: 'Explicit own-account APIs; administrator operations are separate and confirmed.' },
        { name: 'Account avatar', scope: 'user / immutable account ID', availability: 'Owner-only revisioned raster upload/read/removal. No remote URLs, shared avatar or administrator override; images are re-encoded without metadata.' },
        { name: 'Root, fork, handle and home', scope: 'session/tree and user default', availability: 'Owned lifecycle controls; changing home affects future targetless requests, never another tab’s explicit selection.' },
        { name: 'Appearance and response guidance', scope: 'user / immutable account ID', availability: 'Own revisioned preferences API; system/light/dark appearance and bounded next-run response guidance. No global Settings or memory-file edits.' },
        { name: 'Drafts and recent selections', scope: 'browser-memory', availability: 'Unsaved data stays in the current page and clears on identity changes; legacy stored preferences are not imported.' },
        { name: 'Model/thinking defaults and compaction', scope: 'personal empty-root defaults; existing session state; shared compaction', availability: 'Own model-defaults editor selects from the available scoped catalogue for empty owned roots. Resumed/fork selections win; no shared Settings, credentials, live model switch or compaction editor.' },
        { name: 'Tool activation and capability profile', scope: 'fixed ceiling plus per-account denials', availability: 'Recent administrators can deny/restore only tools inside the preview ceiling. Changes affect new runs; broader grants and role profiles remain unavailable.' },
        { name: 'Provider login/OAuth, environment and generic keychain', scope: 'shared instance / operator', availability: 'No family Settings editor or slash-command bridge.' },
        { name: 'Skills, workspace search and add-on panes', scope: 'shared-family / operator', availability: 'Installed inventory and configuration are not enumerated here; pane-by-pane scope classification remains a release prerequisite.' },
        { name: 'Recordings, Dream and notifications', scope: 'owner-scoped integration required', availability: 'Family entry points are unavailable until source and recipient ownership are integrated.' },
        { name: 'Account administration', scope: 'admin metadata', availability: 'Explicit APIs and confirmations; role is not content authority.' },
        { name: 'Access mode and container destinations', scope: 'deployment / operator', availability: 'Read-only preview; migration and isolated-container gates must pass before any activation or managed restart.' },
      ],
      memory: { personal: [`notes/users/${user.id}/MEMORY.md`, `notes/users/${user.id}/preferences.md`], family: 'notes/family/MEMORY.md' },
    };
  })();
}
