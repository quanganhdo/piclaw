import { expect, test } from 'bun:test';
import { mkdirSync, rmSync } from 'node:fs';
import { join } from 'node:path';

import '../helpers.js';
import { importFresh, withTempWorkspaceEnv } from '../helpers.js';

test('compose upload limit setting applies immediately to MediaService', async () => {
  await withTempWorkspaceEnv('piclaw-upload-limit-media-', {
    PICLAW_WEB_COMPOSE_UPLOAD_LIMIT_MB: undefined,
    PICLAW_WEB_WORKSPACE_UPLOAD_LIMIT_MB: undefined,
  }, async () => {
    const handler = await importFresh<typeof import('../../src/channels/web/handlers/general-settings.js')>(
      '../src/channels/web/handlers/general-settings.js',
    );
    const mediaModule = await importFresh<typeof import('../../src/channels/web/media/media-service.js')>(
      '../src/channels/web/media/media-service.js',
    );

    const saved = await handler.saveGeneralSettings({ composeUploadLimitMb: 1 });
    expect(saved.workspaceUploadLimitMb).toBe(1);
    expect(saved.composeUploadLimitMb).toBe(1);

    const service = new mediaModule.MediaService();
    const tooBig = new Uint8Array(1024 * 1024 + 1);
    const result = await service.createFromFile(new File([tooBig], 'too-big.png', { type: 'image/png' }));

    expect(result.status).toBe(413);
    expect((result.body as any).error).toContain('1 MB');
  });
});

test('workspace upload limit setting applies immediately to WorkspaceFileService', async () => {
  const handler = await import('../../src/channels/web/handlers/general-settings.js');
  const configModule = await import('../../src/core/config.js');
  const fileServiceModule = await import('../../src/channels/web/workspace/file-service.js');

  const previousLimit = configModule.getWebRuntimeConfig().workspaceUploadLimitMb;
  const prefix = `upload-limit-test-${Date.now()}-${Math.random().toString(36).slice(2)}`;
  const targetDir = join(configModule.WORKSPACE_DIR, prefix);
  mkdirSync(targetDir, { recursive: true });

  try {
    await handler.saveGeneralSettings({ workspaceUploadLimitMb: 1 });

    const service = new fileServiceModule.WorkspaceFileService();
    const tooBig = new Uint8Array(1024 * 1024 + 1);
    const result = await service.uploadFile(prefix, new File([tooBig], 'too-big.bin'));

    expect(result.status).toBe(400);
    expect((result.body as any).error).toContain('File too large');
  } finally {
    await handler.saveGeneralSettings({ workspaceUploadLimitMb: previousLimit });
    rmSync(targetDir, { recursive: true, force: true });
  }
});

test('workspace upload limit setting accepts 1024 MB', async () => {
  const handler = await import('../../src/channels/web/handlers/general-settings.js');
  const configModule = await import('../../src/core/config.js');

  const previousLimit = configModule.getWebRuntimeConfig().workspaceUploadLimitMb;
  try {
    const saved = await handler.saveGeneralSettings({ workspaceUploadLimitMb: 1024 });
    expect(saved.workspaceUploadLimitMb).toBe(1024);
    expect(configModule.getWebRuntimeConfig().workspaceUploadLimitMb).toBe(1024);
    expect(saved.composeUploadLimitMb).toBe(1024);
    expect(configModule.getWebRuntimeConfig().composeUploadLimitMb).toBe(1024);
  } finally {
    await handler.saveGeneralSettings({ workspaceUploadLimitMb: previousLimit });
  }
});
