import { afterEach, expect, test } from 'bun:test';

import { paneRegistry } from '../../web/src/panes/pane-registry.js';
import * as api from '../../web/src/api.js';
import { registerAppPaneExtensions, resolveAppApiSurface } from '../../web/src/ui/app-shell-bootstrap.js';

const registeredByTest = new Set<string>();
let previousKanbanExtension: any = null;

afterEach(() => {
  for (const id of registeredByTest) paneRegistry.unregister(id);
  registeredByTest.clear();
  if (previousKanbanExtension) {
    paneRegistry.register(previousKanbanExtension);
    previousKanbanExtension = null;
  }
});

test('registerAppPaneExtensions does not register addon-owned kanban/mindmap panes by default', () => {
  previousKanbanExtension = paneRegistry.get('kanban-editor') || null;
  if (previousKanbanExtension) paneRegistry.unregister('kanban-editor');

  registerAppPaneExtensions();

  for (const ext of paneRegistry.list()) registeredByTest.add(ext.id);

  expect(paneRegistry.get('editor')).toBeTruthy();
  expect(paneRegistry.get('mindmap-editor')).toBeUndefined();
  expect(paneRegistry.get('kanban-editor')).toBeUndefined();
});

test('resolveAppApiSurface exposes the compact model reader used by MainApp', () => {
  const surface = resolveAppApiSurface(api);
  expect(surface.getAgentModelState).toBe(api.getAgentModelState);
  expect(surface.getAgentModelState).not.toBe(surface.getAgentModels);
});

test('resolveAppApiSurface exposes archived branch purge API', () => {
  const purgeChatBranch = async () => ({ status: 'ok' });
  const surface = resolveAppApiSurface({ purgeChatBranch });

  expect(surface.purgeChatBranch).toBe(purgeChatBranch);
});
