import { expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import '../helpers.js';
import { importFresh, withTempWorkspaceEnv } from '../helpers.js';

test('saveWorkspaceSettings persists and applies workspace settings immediately', async () => {
  await withTempWorkspaceEnv('piclaw-workspace-settings-', {
    PICLAW_WEB_TERMINAL_ENABLED: undefined,
    PICLAW_WEB_VNC_ALLOW_DIRECT: undefined,
    PICLAW_VNC_ALLOW_DIRECT: undefined,
  }, async (workspace) => {
    const handler = await importFresh<typeof import('../../src/channels/web/handlers/workspace-settings.js')>(
      '../src/channels/web/handlers/workspace-settings.js',
    );

    const saved = handler.saveWorkspaceSettings({
      webTerminalEnabled: false,
      vncAllowDirect: false,
      sanitizeSvgFences: false,
      treeMaxDepth: 3,
      treeMaxEntries: 1250,
    });

    expect(saved).toMatchObject({
      webTerminalEnabled: false,
      vncAllowDirect: false,
      sanitizeSvgFences: false,
      treeMaxDepth: 3,
      treeMaxEntries: 1250,
    });
    expect(handler.getWorkspaceSettingsData()).toMatchObject(saved);

    const persisted = JSON.parse(readFileSync(join(workspace.workspace, '.piclaw', 'config.json'), 'utf8'));
    expect(persisted).toMatchObject({
      domains: {
        web: {
          terminalEnabled: false,
          vncAllowDirect: false,
          sanitizeSvgFences: false,
        },
      },
      web: {
        workspace: {
          treeMaxDepth: 3,
          treeMaxEntries: 1250,
        },
      },
    });
  });
});
