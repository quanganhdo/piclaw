import { test, expect } from 'bun:test';
import { spawnSync } from 'node:child_process';
import { resolve } from 'node:path';
import { createTempWorkspace } from '../../helpers.js';

test('audit avatar cache, generated sizes, update and clear semantics in disposable workspace', () => {
  const ws = createTempWorkspace('avatar-icon-audit-');
  try {
    const result = spawnSync(process.execPath, ['test/fixtures/avatar-icon-audit.ts'], { cwd: resolve(import.meta.dir, '../../..'), env: { ...process.env, PICLAW_WORKSPACE: ws.workspace, PICLAW_STORE: ws.store, PICLAW_DATA: ws.data, PICLAW_DB_IN_MEMORY: '1' }, encoding: 'utf8' });
    if (result.status) console.log(result.stdout, result.stderr);
    expect(result.status).toBe(0);
    const line = result.stdout.split('\n').find(x => x.startsWith('AUDIT_RESULT '));
    expect(line).toBeDefined();
    console.log(line);
    const r = JSON.parse(line!.slice(13));
    expect(r.remoteRefreshed).toBe(true); expect(r.passiveDidNotFetch).toBe(true); expect(r.remoteFailurePreserved).toBe(true);
    expect(r.commandSet).toBe('success');
    expect(r.commandPersisted).toBe(true); expect(r.clearPersisted).toBe(true);
    expect(r.staleReadDidNotRollback).toBe(true); expect(r.invalidRejected).toBe(true);
    expect(r.sameSource.unchanged).toBe(false);
    expect(r.sameSource.updatedAtUnchanged).toBe(false);
    expect(r.sameSource.manifestIconsUnchanged).toBe(false);
    expect(r.distinctSource.hashChanged).toBe(false);
    expect(r.distinctSource.manifestIconsChanged).toBe(false);
    for (const variant of r.variants) {
      expect(variant.contentType).toBe('image/png');
      if (variant.size) expect([variant.width, variant.height]).toEqual([variant.size, variant.size]);
    }
    expect(r.headBytes).toBe(0);
    expect(r.maskCorner).toEqual([255, 255, 255]);
    expect(r.clear.commandRetainsPrevious).toBe(false);
    expect(r.clear.settingsClears).toBe(true);
    expect(r.failedSource.rejected).toBe(true);
    expect(r.failedSource.preservedIdentity).toBe(true);
    expect(r.failedSource.servedPrevious).toBe(true);
    expect(r.cachedJpegPngRequest.actualFormat).toBe('png');
  } finally { ws.cleanup(); }
}, 30000);
