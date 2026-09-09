const PANELS = [
  ['open-account', 'account-settings', 'close-account'],
  ['open-preferences', 'account-preferences', 'close-preferences'],
  ['open-sessions', 'session-settings', 'close-sessions'],
  ['open-results', 'scheduled-results', 'close-results'],
  ['open-tasks', 'scheduled-tasks', 'close-tasks'],
  ['open-memory', 'family-memory', 'close-memory'],
  ['open-administration', 'administration-settings', 'close-administration'],
  ['open-workspace-policy', 'workspace-policy', 'close-workspace-policy'],
] as const;

export interface FamilyPanelNavigation {
  activate(panelId: string): void;
  setLocked(locked: boolean): void;
}

/** Coordinate existing family Settings panels without owning their private state. */
export function initialiseFamilyPanelNavigation(): FamilyPanelNavigation {
  const navigation = document.querySelector<HTMLElement>('.settings-navigation');
  if (!navigation) throw new Error('Missing family Settings navigation.');
  let locked = false;
  const entries = PANELS.map(([openId, panelId, closeId]) => {
    const opener = document.getElementById(openId) as HTMLButtonElement;
    const panel = document.getElementById(panelId) as HTMLElement;
    const closer = document.getElementById(closeId) as HTMLButtonElement;
    opener.setAttribute('aria-controls', panelId);
    opener.setAttribute('aria-expanded', 'false');
    return { opener, panel, closer };
  });

  const reflect = () => {
    for (const entry of entries) entry.opener.setAttribute('aria-expanded', String(!entry.panel.hidden));
  };

  const activate = (panelId: string) => {
    if (locked) return;
    const selected = entries.find(entry => entry.panel.id === panelId);
    if (!selected) throw new Error(`Unknown family Settings panel: ${panelId}`);
    for (const entry of entries) {
      if (entry !== selected && !entry.panel.hidden) entry.closer.click();
      entry.opener.setAttribute('aria-expanded', String(entry === selected));
    }
  };

  const observer = new MutationObserver(reflect);
  for (const selected of entries) {
    observer.observe(selected.panel, { attributes: true, attributeFilter: ['hidden'] });
    selected.opener.addEventListener('click', event => {
      if (locked) { event.preventDefault(); event.stopImmediatePropagation(); return; }
      activate(selected.panel.id);
    }, { capture: true });
  }
  reflect();
  return {
    activate,
    setLocked(value: boolean) {
      locked = value;
      navigation.inert = value;
      navigation.setAttribute('aria-busy', String(value));
    },
  };
}
