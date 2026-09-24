import { afterEach, expect, test } from 'bun:test';
import { fetchPasskeyList, getPasskeyCreateSupport, renamePasskey, validatePasskeyName } from '../../web/shared/passkeys';
const originalFetch = globalThis.fetch;
afterEach(() => { globalThis.fetch = originalFetch; });
test('passkey names count Unicode characters and reject blank/control characters', () => {
  expect(validatePasskeyName('  Tablet  ')).toEqual({ ok: true, value: 'Tablet' });
  expect(validatePasskeyName('😀'.repeat(80)).ok).toBe(true);
  for (const name of ['', ' ', 'x'.repeat(81), 'a\u0000b', 'a\u200bb']) expect(validatePasskeyName(name).ok).toBe(false);
});
test('creation explains missing secure context and WebAuthn without calling the native API', () => {
  expect(getPasskeyCreateSupport({ isSecureContext: false } as any).supported).toBe(false);
  expect(getPasskeyCreateSupport({ isSecureContext: true, navigator: {} } as any).reason).toContain('cannot create');
});
test('malformed list responses are errors rather than an empty or fresh list', async () => {
  globalThis.fetch = (async () => Response.json({ status: 'error' })) as typeof fetch;
  await expect(fetchPasskeyList()).rejects.toThrow('Invalid passkey list');
});
test('an auth redirect is sign-in-required rather than an empty list', async () => {
  globalThis.fetch = (async () => ({ redirected: true, url: 'https://fixture.test/login' })) as typeof fetch;
  await expect(fetchPasskeyList()).rejects.toMatchObject({ status: 401 });
});
test('unconfirmed or rejected mutations never report success', async () => {
  globalThis.fetch = (async () => Response.json({})) as typeof fetch;
  await expect(renamePasskey('id', 'Tablet')).rejects.toThrow('did not confirm');
  globalThis.fetch = (async () => Response.json({ error: 'Sign in again', code: 'recent_auth_required' }, { status: 403 })) as typeof fetch;
  await expect(renamePasskey('id', 'Tablet')).rejects.toThrow('Sign in again');
});
