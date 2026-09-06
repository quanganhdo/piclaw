import type Database from 'bun:sqlite';
import { clampThinkingLevel, getSupportedThinkingLevels, type Model, type Api } from '@earendil-works/pi-ai';
import type { ModelRuntime, SettingsManager, SessionManager, CreateAgentSessionFromServicesOptions } from '@earendil-works/pi-coding-agent';
import type { AuthenticatedPrincipal } from '../core/access-types.js';
import { ACCOUNT_THINKING_LEVELS, type AccountModelDefaults, type AccountThinkingLevel, type OwnAccountModelDefaults } from '../core/account-model-defaults.js';
import { getExecutionIdentity } from '../core/execution-context.js';
import { requireAccountActor } from '../db/account-administration.js';
import { readAccountModelDefaults, updateOwnAccountModelDefaults } from '../db/account-model-defaults.js';
import { getDb } from '../db/connection.js';
import { ChatAccessDenied } from '../db/session-ownership.js';
import { resolveModelScope } from '../utils/scoped-models.js';
import { requireOwnedSessionExecution } from './owned-session-access.js';

function models(runtime: ModelRuntime, settings: SettingsManager): Model<Api>[] {
  return resolveModelScope([...runtime.getAvailableSnapshot()], settings).models;
}
const label = (model: Model<Api>) => `${model.provider}/${model.id}`;
function select(available: Model<Api>[], value: Omit<AccountModelDefaults, 'revision'>): Model<Api> | null {
  if (value.model === null) return null;
  const matches = available.filter(model => label(model) === value.model);
  if (matches.length !== 1 || (value.thinking_level !== null && !getSupportedThinkingLevels(matches[0]!).includes(value.thinking_level))) throw new Error('Selected model or thinking level is unavailable. Refresh model defaults.');
  return matches[0]!;
}
function inheritedThinking(settings: SettingsManager, model: Model<Api>): AccountThinkingLevel {
  return clampThinkingLevel(model, settings.getModelThinkingLevel(model.provider, model.id) ?? settings.getDefaultThinkingLevel() ?? 'medium');
}

/** No session hydration, network refresh, credentials, provider diagnostics or usage data. */
export function ownAccountModelDefaults(database: Database, actor: AuthenticatedPrincipal, runtime: ModelRuntime, settings: SettingsManager, input?: unknown): OwnAccountModelDefaults {
  return database.transaction((): OwnAccountModelDefaults => {
    requireAccountActor(database, actor);
    const available = models(runtime, settings);
    const preferences = input === undefined ? readAccountModelDefaults(database, actor.userId)
      : updateOwnAccountModelDefaults(database, actor, input, value => { select(available, value); });
    const requested = preferences.model ?? (settings.getDefaultProvider() && settings.getDefaultModel() ? `${settings.getDefaultProvider()}/${settings.getDefaultModel()}` : null);
    const selected = available.find(model => label(model) === requested);
    const compatible = Boolean(selected && (preferences.thinking_level === null || getSupportedThinkingLevels(selected).includes(preferences.thinking_level)));
    return { user_id: actor.userId, preferences, can_edit: true,
      models: available.map(model => ({ label: label(model), name: model.name || label(model), thinking_levels: getSupportedThinkingLevels(model).filter(level => ACCOUNT_THINKING_LEVELS.includes(level)) })),
      effective: { model: requested, thinking_level: selected ? preferences.thinking_level ?? inheritedThinking(settings, selected) : null,
        source: preferences.model === null ? 'instance' : 'account', available: compatible },
    };
  })();
}

/** Called before SDK creation. Personal defaults never replace branch seeds or resumed choices. */
export function familySessionModelOptions(chatJid: string, session: SessionManager, runtime: ModelRuntime, settings: SettingsManager): Pick<CreateAgentSessionFromServicesOptions, 'model' | 'thinkingLevel'> {
  const actor = requireOwnedSessionExecution(chatJid);
  if (!actor) throw new ChatAccessDenied();
  const entries = session.getEntries(), context = session.buildSessionContext();
  // Preserve saved selections, including metadata-only sessions; never silently substitute a personal default.
  if (entries.length) {
    if (!context.model) return {};
    const saved = runtime.getAvailableSnapshot().find(model => model.provider === context.model!.provider && model.id === context.model!.modelId);
    if (!saved) throw new Error('Saved session model is unavailable.');
    if (!(ACCOUNT_THINKING_LEVELS as readonly string[]).includes(context.thinkingLevel)) throw new Error('Invalid saved thinking level.');
    return { model: saved, thinkingLevel: context.thinkingLevel as AccountThinkingLevel };
  }
  const branch = getDb().query('SELECT parent_branch_id FROM chat_branches WHERE chat_jid=? AND handle_owner_id=?').get(chatJid, actor.userId) as { parent_branch_id: string | null } | null;
  if (!branch) throw new ChatAccessDenied();
  if (branch.parent_branch_id || session.getHeader()?.parentSession) return {};
  const value = getExecutionIdentity()?.modelDefaults;
  if (!value) throw new ChatAccessDenied();
  const model = select(models(runtime, settings), value);
  if (!model) return {}; // No personal override: preserve existing SDK instance-default behaviour.
  return { model, ...(value.thinking_level === null ? {} : { thinkingLevel: value.thinking_level }) };
}
