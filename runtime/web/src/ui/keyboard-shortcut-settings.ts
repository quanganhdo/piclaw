import {
  KEYBOARD_SHORTCUT_ACTIONS,
  type KeyboardShortcutActionDefinition,
  type KeyboardShortcutActionId,
  formatShortcutBindingList,
  normalizeShortcutBindingString,
  parseShortcutBindingList,
  readAllKeyboardShortcutBindings,
  resetKeyboardShortcutBindings,
  saveKeyboardShortcutBindings,
} from './keyboard-shortcuts.js';

export type KeyboardShortcutDrafts = Record<KeyboardShortcutActionId, string>;

export interface KeyboardShortcutDraftSaveResult {
  ok: boolean;
  drafts: KeyboardShortcutDrafts;
  invalidToken?: string;
}

export function readKeyboardShortcutDrafts(): KeyboardShortcutDrafts {
  const current = readAllKeyboardShortcutBindings();
  return Object.fromEntries(
    Object.entries(current).map(([id, bindings]) => [id, formatShortcutBindingList(bindings)]),
  ) as KeyboardShortcutDrafts;
}

export function filterKeyboardShortcutActions(
  filter: string,
  drafts: KeyboardShortcutDrafts,
): KeyboardShortcutActionDefinition[] {
  const query = String(filter || '').trim().toLowerCase();
  if (!query) return KEYBOARD_SHORTCUT_ACTIONS;
  return KEYBOARD_SHORTCUT_ACTIONS.filter((action) => [
    action.label,
    action.description,
    drafts[action.id],
    ...action.defaultBindings,
  ].some((part) => String(part || '').toLowerCase().includes(query)));
}

export function saveKeyboardShortcutDraft(
  actionId: KeyboardShortcutActionId,
  rawValue: string,
): KeyboardShortcutDraftSaveResult {
  const raw = String(rawValue || '').trim();
  const tokens = raw ? raw.split(/[\n,]/).map((part) => part.trim()).filter(Boolean) : [];
  const invalidToken = tokens.find((token) => !normalizeShortcutBindingString(token));
  if (invalidToken) return { ok: false, invalidToken, drafts: readKeyboardShortcutDrafts() };
  saveKeyboardShortcutBindings(actionId, parseShortcutBindingList(raw));
  return { ok: true, drafts: readKeyboardShortcutDrafts() };
}

export function resetKeyboardShortcutDraft(actionId?: KeyboardShortcutActionId): KeyboardShortcutDrafts {
  resetKeyboardShortcutBindings(actionId);
  return readKeyboardShortcutDrafts();
}
