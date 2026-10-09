import type { SettingsManager, SessionManager } from '@earendil-works/pi-coding-agent';

const RETIRED_AZURE_PROVIDER = 'azure-openai-responses';
const MIGRATION_MESSAGE = 'Pi 1.0.3 renamed the Azure provider to azure. Update the Azure provider key in auth.json and models.json, and Azure selections in settings.json before resuming this session. Piclaw will not substitute another provider automatically.';

/** Refuse an explicit retired identity before the SDK can choose a fallback model. */
export function assertCurrentProviderSelection(settings: SettingsManager, sessionManager: SessionManager): void {
  const oldPattern = (value: string) => value === RETIRED_AZURE_PROVIDER || value.startsWith(`${RETIRED_AZURE_PROVIDER}/`);
  const recordedModel = sessionManager.buildSessionContext().model;
  if (settings.getDefaultProvider() === RETIRED_AZURE_PROVIDER
    || settings.getEnabledModels()?.some(oldPattern)
    || Object.keys(settings.getAllModelThinkingLevels()).some(oldPattern)
    || recordedModel?.provider === RETIRED_AZURE_PROVIDER) {
    throw new Error(MIGRATION_MESSAGE);
  }
}
