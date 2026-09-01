import { expect, test } from 'bun:test';
import { dispatchVaultViewerOpen, sanitizeVaultHref, vaultLinkLabel } from '../../web/src/vault-links.js';
import { vaultViewerPaneExtension } from '../../web/src/panes/vault-viewer-pane.js';

const unitRef = 'obsidian:////workspace/vaults/learning/Learning/Staff%20Systems/Unit%2001%20-%20Product%20Contract%2C%20Boundaries%2C%20and%20State%20Ownership#Reading%20packet';

test('sanitizeVaultHref preserves canonical learning-vault notes and headings', () => {
  expect(sanitizeVaultHref(unitRef)).toBe(unitRef);
  expect(sanitizeVaultHref('obsidian:////workspace/vaults/learning/Learning/Note.md')).toBe(
    'obsidian:////workspace/vaults/learning/Learning/Note',
  );
  expect(vaultLinkLabel(unitRef)).toBe('Unit 01 - Product Contract, Boundaries, and State Ownership');
});

test('sanitizeVaultHref rejects other vaults and traversal-shaped paths', () => {
  for (const value of [
    'obsidian:///workspace/vaults/learning/Learning/Note',
    'obsidian:////workspace/vaults/private/Note',
    'obsidian:////workspace/vaults/learning/Learning/../private/Note',
    'obsidian:////workspace/vaults/learning/Learning/%2e%2e/private/Note',
    'obsidian:////workspace/vaults/learning/Learning%2Fprivate/Note',
    'obsidian:////workspace/vaults/learning/Learning/Note?raw=1',
    'javascript:alert(1)',
  ]) expect(sanitizeVaultHref(value)).toBeNull();
});

test('dispatchVaultViewerOpen emits the native pane event', () => {
  const events: CustomEvent[] = [];
  const target = { dispatchEvent: (event: CustomEvent) => { events.push(event); return true; } } as unknown as EventTarget;
  expect(dispatchVaultViewerOpen(target, unitRef)).toBe(true);
  expect(events[0]?.type).toBe('vault-viewer:open-tab');
  expect(events[0]?.detail).toEqual({
    path: unitRef,
    label: 'Unit 01 - Product Contract, Boundaries, and State Ownership',
  });
  expect(dispatchVaultViewerOpen(target, 'obsidian:////etc/passwd')).toBe(false);
});

test('vault pane claims only validated learning-vault references', () => {
  expect(vaultViewerPaneExtension.canHandle?.({ path: unitRef, mode: 'edit' })).toBe(100);
  expect(vaultViewerPaneExtension.canHandle?.({ path: 'qmd://books/chapter.md', mode: 'edit' })).toBe(false);
});
