import { expect, test } from 'bun:test';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

import '../helpers.js';
import { importFresh, withTempWorkspaceEnv } from '../helpers.js';

test('saveGeneralSettings persists and applies general settings immediately', async () => {
  await withTempWorkspaceEnv('piclaw-general-settings-', {
    PICLAW_ASSISTANT_NAME: undefined,
    PICLAW_ASSISTANT_AVATAR: undefined,
    PICLAW_USER_NAME: undefined,
    PICLAW_USER_AVATAR: undefined,
    PICLAW_USER_AVATAR_BACKGROUND: undefined,
    PICLAW_WEB_UI_MODE: undefined,
    PICLAW_WEB_PERSIST_THINKING: undefined,
    PICLAW_WEB_PERSIST_THINKING_MAX_CHARS: undefined,
    PICLAW_WEB_COMPOSE_UPLOAD_LIMIT_MB: undefined,
    PICLAW_WEB_WORKSPACE_UPLOAD_LIMIT_MB: undefined,
    PICLAW_WEB_NOTIFICATION_DEBUG_LABELS: undefined,
    PICLAW_WEB_TERMINAL_ENABLED: undefined,
    PICLAW_DEBUG_CARD_SUBMISSIONS: undefined,
  }, async (workspace) => {
    const handler = await importFresh<typeof import('../../src/channels/web/handlers/general-settings.js')>(
      '../src/channels/web/handlers/general-settings.js',
    );
    const db = await importFresh<typeof import('../../src/db.js')>('../src/db.js');
    db.initDatabase();
    const config = await import('../../src/core/config.js');
    config.setUserAvatarBackground('');

    const saved = await handler.saveGeneralSettings({
      assistantName: 'Smith',
      assistantAvatar: 'https://example.test/assistant.png',
      userName: 'Rui',
      userAvatar: 'https://example.test/user.png',
      sessionAutoRotate: false,
      sessionMaxSizeMb: 48,
      webTerminalEnabled: false,
      composeUploadLimitMb: 24,
      workspaceUploadLimitMb: 256,
      toolUseBudget: 23,
      automaticRecoveryEnabled: false,
      automaticRecoveryMaxAttempts: 4,
      automaticRecoveryTotalBudgetMs: 120000,
      uiTheme: 'dracula',
      uiTint: '#7c3aed',
      outputPad: 12,
    });

    expect(saved).toMatchObject({
      assistantName: 'Smith',
      assistantAvatar: 'https://example.test/assistant.png',
      userName: 'Rui',
      userAvatar: 'https://example.test/user.png',
      sessionAutoRotate: false,
      sessionMaxSizeMb: 48,
      webTerminalEnabled: false,
      composeUploadLimitMb: 24,
      workspaceUploadLimitMb: 256,
      toolUseBudget: 23,
      automaticRecoveryEnabled: false,
      automaticRecoveryMaxAttempts: 4,
      automaticRecoveryTotalBudgetMs: 120000,
      uiTheme: 'dracula',
      uiTint: '#7c3aed',
      outputPad: 12,
    });
    expect(saved.instanceTotp.configured).toBe(false);
    expect(handler.getGeneralSettingsData()).toMatchObject(saved);
    expect(handler.buildGeneralSettingsProfileUpdate(saved, 'test-version')).toMatchObject({
      agent_id: 'default',
      agent_name: 'Smith',
      agent_avatar: '/avatar/agent?v=test-version',
      user_name: 'Rui',
      user_avatar: '/avatar/user?v=test-version',
      user_avatar_background: null,
    });

    const persisted = JSON.parse(readFileSync(join(workspace.workspace, '.piclaw', 'config.json'), 'utf8'));
    expect(persisted).toMatchObject({
      domains: {
        identity: {
          assistantName: 'Smith',
          assistantAvatar: 'https://example.test/assistant.png',
          userName: 'Rui',
          userAvatar: 'https://example.test/user.png',
        },
        web: {
          terminalEnabled: false,
          composeUploadLimitMb: 24,
          workspaceUploadLimitMb: 256,
        },
        agent: {
          toolUseMessageBudget: 23,
        },
        session: {
          autoRotate: false,
          maxSizeMb: 48,
        },
        recovery: {
          automaticRecoveryEnabled: false,
          automaticRecoveryMaxAttempts: 4,
          automaticRecoveryTotalBudgetMs: 120000,
        },
      },
      ui: {
        theme: 'dracula',
        tint: '#7c3aed',
      },
    });
    for (const name of [
      'PICLAW_ASSISTANT_NAME',
      'PICLAW_ASSISTANT_AVATAR',
      'PICLAW_USER_NAME',
      'PICLAW_USER_AVATAR',
      'PICLAW_USER_AVATAR_BACKGROUND',
      'PICLAW_WEB_UI_MODE',
      'PICLAW_WEB_PERSIST_THINKING',
      'PICLAW_WEB_PERSIST_THINKING_MAX_CHARS',
      'PICLAW_WEB_COMPOSE_UPLOAD_LIMIT_MB',
      'PICLAW_WEB_WORKSPACE_UPLOAD_LIMIT_MB',
      'PICLAW_WEB_NOTIFICATION_DEBUG_LABELS',
      'PICLAW_WEB_TERMINAL_ENABLED',
      'PICLAW_SESSION_AUTO_ROTATE',
      'PICLAW_SESSION_MAX_SIZE_MB',
      'PICLAW_SESSION_MAX_LINES',
      'PICLAW_SESSION_MAX_COMPACTIONS',
      'PICLAW_TURN_MAX_TOOL_USE_MESSAGES',
      'PICLAW_DEBUG_CARD_SUBMISSIONS',
    ]) {
      expect(process.env[name], name).toBeUndefined();
    }
  });
});

test('getGeneralSettingsData exposes recovery defaults without writing configuration', async () => {
  await withTempWorkspaceEnv('piclaw-general-settings-recovery-read-', {
    PICLAW_TURN_AUTO_RECOVERY_ENABLED: undefined,
    PICLAW_TURN_AUTO_RECOVERY_MAX_ATTEMPTS: undefined,
    PICLAW_TURN_AUTO_RECOVERY_TOTAL_BUDGET_MS: undefined,
  }, async (workspace) => {
    const handler = await importFresh<typeof import('../../src/channels/web/handlers/general-settings.js')>(
      '../src/channels/web/handlers/general-settings.js',
    );
    const configPath = join(workspace.workspace, '.piclaw', 'config.json');
    expect(existsSync(configPath)).toBe(false);
    expect(handler.getGeneralSettingsData()).toMatchObject({
      automaticRecoveryEnabled: true,
      automaticRecoveryMaxAttempts: 0,
      automaticRecoveryTotalBudgetMs: 0,
      automaticRecoveryEffectiveBudgetMs: 1200000,
    });
    expect(existsSync(configPath)).toBe(false);
  });
});

test('saveGeneralSettings persists automatic recovery budget mode', async () => {
  await withTempWorkspaceEnv('piclaw-general-settings-recovery-automatic-', {}, async (workspace) => {
    const handler = await importFresh<typeof import('../../src/channels/web/handlers/general-settings.js')>(
      '../src/channels/web/handlers/general-settings.js',
    );
    const automatic = await handler.saveGeneralSettings({ automaticRecoveryTotalBudgetMs: 0 });
    expect(automatic).toMatchObject({ automaticRecoveryTotalBudgetMs: 0, automaticRecoveryEffectiveBudgetMs: 1200000 });
    const persisted = JSON.parse(readFileSync(join(workspace.workspace, '.piclaw', 'config.json'), 'utf8'));
    expect(persisted.domains.recovery.automaticRecoveryTotalBudgetMs).toBe(0);
  });
});

test('saveGeneralSettings rejects invalid recovery bounds without persisting them', async () => {
  await withTempWorkspaceEnv('piclaw-general-settings-recovery-invalid-', {}, async (workspace) => {
    const handler = await importFresh<typeof import('../../src/channels/web/handlers/general-settings.js')>(
      '../src/channels/web/handlers/general-settings.js',
    );
    const configPath = join(workspace.workspace, '.piclaw', 'config.json');
    await expect(handler.saveGeneralSettings({ automaticRecoveryMaxAttempts: -1 }))
      .rejects.toThrow('non-negative integer');
    await expect(handler.saveGeneralSettings({ automaticRecoveryMaxAttempts: 1.5 }))
      .rejects.toThrow('non-negative integer');
    await expect(handler.saveGeneralSettings({ automaticRecoveryTotalBudgetMs: -1 }))
      .rejects.toThrow('non-negative integer');
    await expect(handler.saveGeneralSettings({ automaticRecoveryTotalBudgetMs: 1000.5 }))
      .rejects.toThrow('non-negative integer');
    expect(existsSync(configPath)).toBe(false);
  });
});

test('saveGeneralSettings prepares uploaded avatar data for immediate /avatar serving', async () => {
  await withTempWorkspaceEnv('piclaw-general-settings-avatar-', {}, async () => {
    const handler = await importFresh<typeof import('../../src/channels/web/handlers/general-settings.js')>(
      '../src/channels/web/handlers/general-settings.js',
    );
    const avatar = await importFresh<typeof import('../../src/channels/web/media/avatar-service.js')>(
      '../src/channels/web/media/avatar-service.js',
    );

    const svgData = 'data:image/svg+xml,%3Csvg xmlns=%22http://www.w3.org/2000/svg%22 width=%221%22 height=%221%22%3E%3Crect width=%221%22 height=%221%22 fill=%22red%22/%3E%3C/svg%3E';
    const saved = await handler.saveGeneralSettings({ userAvatar: svgData });
    expect(saved.userAvatar).toBe(svgData);

    const response = await avatar.buildAvatarResponse('user', saved.userAvatar, new Request('http://localhost/avatar/user'));
    expect(response?.status).toBe(200);
    expect(response?.headers.get('Cache-Control')).toBe('no-store');
    expect(response?.headers.get('Content-Type')?.startsWith('image/')).toBe(true);
    expect(handler.buildGeneralSettingsProfileUpdate(saved, 'avatar-test').user_avatar).toBe('/avatar/user?v=avatar-test');
  });
});

test('saveGeneralSettings accepts uploaded media avatar references', async () => {
  await withTempWorkspaceEnv('piclaw-general-settings-media-avatar-', {}, async () => {
    const db = await importFresh<typeof import('../../src/db.js')>('../src/db.js');
    db.initDatabase();
    const handler = await importFresh<typeof import('../../src/channels/web/handlers/general-settings.js')>(
      '../src/channels/web/handlers/general-settings.js',
    );
    const avatar = await importFresh<typeof import('../../src/channels/web/media/avatar-service.js')>(
      '../src/channels/web/media/avatar-service.js',
    );

    const png = Buffer.from(
      'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Wn1s3sAAAAASUVORK5CYII=',
      'base64',
    );
    const userMediaId = db.createMedia('user-avatar.png', 'image/png', png, null, { test: true });
    const agentMediaId = db.createMedia('agent-avatar.png', 'image/png', png, null, { test: true });

    const saved = await handler.saveGeneralSettings({
      userAvatar: `/media/${userMediaId}`,
      assistantAvatar: `/media/${agentMediaId}`,
    });

    expect(saved.userAvatar).toBe(`/media/${userMediaId}`);
    expect(saved.assistantAvatar).toBe(`/media/${agentMediaId}`);
    expect(handler.buildGeneralSettingsProfileUpdate(saved, 'media-avatar-test')).toMatchObject({
      agent_avatar: '/avatar/agent?v=media-avatar-test',
      user_avatar: '/avatar/user?v=media-avatar-test',
    });

    const userResponse = await avatar.buildAvatarResponse('user', saved.userAvatar, new Request('http://localhost/avatar/user'));
    const agentResponse = await avatar.buildAvatarResponse('agent', saved.assistantAvatar, new Request('http://localhost/avatar/agent'));
    expect(userResponse?.status).toBe(200);
    expect(agentResponse?.status).toBe(200);
    expect(userResponse?.headers.get('Content-Type')?.startsWith('image/')).toBe(true);
    expect(agentResponse?.headers.get('Content-Type')?.startsWith('image/')).toBe(true);
  });
});
