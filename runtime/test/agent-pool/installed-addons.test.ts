import { afterEach, beforeEach, expect, setDefaultTimeout, test } from 'bun:test';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { SettingsManager, getAgentDir } from '@earendil-works/pi-coding-agent';
import '../helpers.js';
import { withTempWorkspaceEnv } from '../helpers.js';
import { createSessionInDir } from '../../src/agent-pool/session.ts';
import { getInstalledAddonExtensionPaths } from '../../src/addons/package-entries.js';
import { createRealTestModelServices } from "../model-services-fixture.js";
import { clearExtensionRoutes, getRegisteredRoutes, handleExtensionRoutes, isExtensionRouteRegistryFrozen } from '../../src/channels/web/http/extension-routes.js';

setDefaultTimeout(10_000);

beforeEach(() => {
  clearExtensionRoutes();
});

afterEach(() => {
  clearExtensionRoutes();
});

test('getInstalledAddonExtensionPaths discovers package pi.extensions from .pi/extensions/node_modules', async () => {
  await withTempWorkspaceEnv('piclaw-installed-addon-scan-', {}, async (workspace) => {
    const addonDir = join(workspace.workspace, '.pi', 'extensions', 'node_modules', 'piclaw-addon-example');
    mkdirSync(addonDir, { recursive: true });
    writeFileSync(join(addonDir, 'package.json'), JSON.stringify({
      name: 'piclaw-addon-example',
      version: '0.1.0',
      type: 'module',
      pi: { extensions: ['index.ts'] },
    }, null, 2));
    writeFileSync(join(addonDir, 'index.ts'), 'export default function noop() {}\n');

    expect(getInstalledAddonExtensionPaths(workspace.workspace)).toEqual([
      join(addonDir, 'index.ts'),
    ]);
  });
});

test('web sessions load installed addon extensions from the workspace extensions package root', async () => {
  await withTempWorkspaceEnv('piclaw-installed-addon-runtime-', {}, async (workspace) => {
    const addonDir = join(workspace.workspace, '.pi', 'extensions', 'node_modules', 'piclaw-addon-example');
    mkdirSync(addonDir, { recursive: true });
    writeFileSync(join(addonDir, 'package.json'), JSON.stringify({
      name: 'piclaw-addon-example',
      version: '0.1.0',
      type: 'module',
      pi: { extensions: ['index.ts'] },
    }, null, 2));
    writeFileSync(join(addonDir, 'index.ts'), [
      'export default function registerExample(pi) {',
      '  const registerRoute = globalThis.__piclaw_registerRoute;',
      '  if (typeof registerRoute === "function") registerRoute("/example-addon", () => new Response("ok"), import.meta.dir);',
      '  pi.registerTool({',
      '    name: "example_addon_tool",',
      '    label: "example_addon_tool",',
      '    description: "Example addon tool",',
      '    parameters: { type: "object", properties: {} },',
      '    async execute() { return { content: [{ type: "text", text: "ok" }] }; },',
      '  });',
      '}',
      '',
    ].join('\n'));

    const { modelRuntime } = await createRealTestModelServices(join(workspace.base, "agent"));
    const settingsManager = SettingsManager.create(workspace.workspace, getAgentDir());
    const sessionDir = join(workspace.workspace, 'sessions', 'web-test');

    expect(isExtensionRouteRegistryFrozen()).toBe(false);

    const runtime = await createSessionInDir(sessionDir, {
      modelRuntime,
      settingsManager,
      tools: [],
      chatJid: 'web:test',
    });

    try {
      const session: any = runtime.session;
      expect(session._toolRegistry.has('example_addon_tool')).toBe(true);
      expect(getRegisteredRoutes()).toEqual([
        expect.objectContaining({ prefix: '/example-addon' }),
      ]);
      expect(isExtensionRouteRegistryFrozen()).toBe(true);
    } finally {
      runtime.dispose?.();
    }
  });
});

test('installed eml addon registers the attachment preview route', async () => {
  await withTempWorkspaceEnv('piclaw-installed-addon-eml-', {}, async (workspace) => {
    const sourceDir = join(import.meta.dir, 'fixtures', 'eml-viewer');
    const addonDir = join(workspace.workspace, '.pi', 'extensions', 'node_modules', 'piclaw-addon-eml-viewer');
    mkdirSync(addonDir, { recursive: true });
    writeFileSync(join(addonDir, 'package.json'), readFileSync(join(sourceDir, 'package.json'), 'utf8'));
    writeFileSync(join(addonDir, 'index.ts'), readFileSync(join(sourceDir, 'index.ts'), 'utf8'));

    const { modelRuntime } = await createRealTestModelServices(join(workspace.base, "agent"));
    const settingsManager = SettingsManager.create(workspace.workspace, getAgentDir());
    const sessionDir = join(workspace.workspace, 'sessions', 'web-eml-test');

    const runtime = await createSessionInDir(sessionDir, {
      modelRuntime,
      settingsManager,
      tools: [],
      chatJid: 'web:test',
    });

    try {
      expect(getRegisteredRoutes()).toEqual([
        expect.objectContaining({ prefix: '/eml-viewer' }),
      ]);

      const response = await handleExtensionRoutes(
        new Request('http://localhost/eml-viewer/?media=1&name=sample.eml', { method: 'GET' }),
        '/eml-viewer/',
      );
      expect(response).not.toBeNull();
      expect(response?.status).toBe(200);
      expect(response?.headers.get('Content-Type')).toContain('text/html');
      expect(await response?.text()).toContain('Loading email');
    } finally {
      runtime.dispose?.();
    }
  });
});
