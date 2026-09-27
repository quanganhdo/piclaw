export interface OpenSettingsDialogOptions {
  section?: string | null;
}

const OPEN_REQUEST_FLAG = '__piclawSettingsOpenRequested';
const OPEN_SECTION_FLAG = '__piclawSettingsRequestedSection';

export function normalizeSettingsSectionId(value: unknown): string | null {
  const normalized = typeof value === 'string' ? value.trim() : '';
  // Preserve links from the short-lived standalone API access page.
  return normalized === 'api-access' ? 'authentication' : normalized || null;
}

export function requestOpenSettingsDialog(options: OpenSettingsDialogOptions = {}): void {
  if (typeof window === 'undefined') return;
  const section = normalizeSettingsSectionId(options.section);
  try {
    (window as any)[OPEN_REQUEST_FLAG] = true;
    if (section) {
      (window as any)[OPEN_SECTION_FLAG] = section;
    } else {
      delete (window as any)[OPEN_SECTION_FLAG];
    }
  } catch (error) {
    console.debug('[settings-dialog-events] failed to record open request flags', error);
  }
  window.dispatchEvent(new CustomEvent('piclaw:open-settings', {
    detail: section ? { section } : undefined,
  }));
}

export function peekRequestedSettingsSection(): string | null {
  if (typeof window === 'undefined') return null;
  return normalizeSettingsSectionId((window as any)[OPEN_SECTION_FLAG]);
}

export function consumeRequestedSettingsOpenState(): { open: boolean; section: string | null } {
  if (typeof window === 'undefined') return { open: false, section: null };
  const open = Boolean((window as any)[OPEN_REQUEST_FLAG]);
  const section = peekRequestedSettingsSection();
  try {
    (window as any)[OPEN_REQUEST_FLAG] = false;
    delete (window as any)[OPEN_SECTION_FLAG];
  } catch (error) {
    console.debug('[settings-dialog-events] failed to clear open request flags', error);
  }
  return { open, section };
}
