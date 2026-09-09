import { expect, test } from 'bun:test';
import { decodeApplicationServerKey } from '../../web/src/family-notifications.js';

test('family application server key decoder accepts VAPID base64url bytes', () => {
  expect([...decodeApplicationServerKey('AQID-_8')]).toEqual([1, 2, 3, 251, 255]);
});
