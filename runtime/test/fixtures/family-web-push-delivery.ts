import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { closeDatabase, getDb, initDatabase } from '../../src/db/connection.js';
import { createWebSession } from '../../src/db/web-sessions.js';
import { provisionFamilyAccount, updateManagedAccount } from '../../src/db/account-administration.js';
import { upsertStoredWebPushSubscription, listStoredWebPushSubscriptions } from '../../src/channels/web/push/web-push-store.js';
import { sendStoredAgentReplyWebPushNotification, sendStoredWebPushNotification } from '../../src/channels/web/push/web-push-service.js';
import { WebNotificationPresenceService } from '../../src/channels/web/push/web-notification-presence-service.js';

function invariant(value: unknown, message: string): asserts value { if (!value) throw new Error(message); }
function subscription(id: number, deviceId: string) { return { endpoint: `https://push.example.test/device/${id}`, expirationTime: null, keys: { auth: `auth-${id}`, p256dh: `p256dh-${id}` }, deviceId }; }

export async function runFamilyWebPushDeliveryScenario(): Promise<void> {
  mkdirSync(join(process.env.PICLAW_WORKSPACE!, '.piclaw'), { recursive: true });
  writeFileSync(join(process.env.PICLAW_WORKSPACE!, '.piclaw/config.json'), JSON.stringify({ domains: { access: { mode: 'family-shared' } } }));
  closeDatabase(); initDatabase();
  const login = createWebSession('admin-family-push', 'default', 3600, 'passkey');
  const admin = { kind: 'user', mode: 'family-shared', userId: 'default', username: 'default', displayName: 'Default', role: 'admin', homeChatJid: 'web:default', authentication: { method: 'passkey', sessionId: login.session_id, expiresAt: login.expires_at } } as const;
  const create = (name: string) => { const user = provisionFamilyAccount(getDb(), admin, { username: name, displayName: name });
    getDb().query("INSERT INTO webauthn_credentials(user_id,rp_id,credential_id,public_key) VALUES (?,'family.local',?,'key')").run(user.id, name);
    updateManagedAccount(getDb(), admin, user.id, { enabled: true }, { totp: false, passkey: true, rpId: 'family.local' });
    return { user, login: createWebSession(`${name}-family-push`, user.id, 3600, 'passkey') }; };
  const alice = create('alice'), bob = create('bob'), baseDir = join(process.env.PICLAW_DATA!, 'web-push-test');
  upsertStoredWebPushSubscription(subscription(41, 'alice-device'), { baseDir, ownerUserId: alice.user.id, loginSessionId: alice.login.session_id });
  upsertStoredWebPushSubscription(subscription(42, 'bob-device'), { baseDir, ownerUserId: bob.user.id, loginSessionId: bob.login.session_id });
  const delivered: Array<{endpoint:string;payload:string}> = [];
  const first = await sendStoredAgentReplyWebPushNotification({ id: 1, chat_jid: alice.user.home_chat_jid!, timestamp: new Date().toISOString(), data: { content: 'Alice only' } } as any,
    { baseDir, sendNotification: async (item,payload) => { delivered.push({endpoint:item.endpoint,payload}); } });
  invariant(JSON.stringify(first) === JSON.stringify({ attempted: 1, sent: 1, removed: 0, failed: 0 }), 'unexpected first result');
  invariant(delivered.length===1&&delivered[0]?.endpoint==='https://push.example.test/device/41'&&!delivered[0].payload.includes('Alice only')&&!delivered[0].payload.includes(alice.user.home_chat_jid!), 'cross-owner or private-content delivery');
  const direct = await sendStoredWebPushNotification({ title: 'forged', body: 'forged' }, { baseDir, sendNotification: async (item,payload) => { delivered.push({endpoint:item.endpoint,payload}); } });
  invariant(direct.attempted === 0 && delivered.length === 1, 'generic family delivery was not denied');
  const revokingPresence = new WebNotificationPresenceService();
  revokingPresence.shouldSendWebPush = () => { getDb().query('DELETE FROM web_sessions WHERE session_id=?').run(alice.login.session_id); return true; };
  const raced = await sendStoredAgentReplyWebPushNotification({ id: 2, chat_jid: alice.user.home_chat_jid!, timestamp: new Date().toISOString(), data: { content: 'race' } } as any,
    { baseDir, presenceService: revokingPresence, sendNotification: async (item,payload) => { delivered.push({endpoint:item.endpoint,payload}); } });
  invariant(raced.attempted === 0 && delivered.length === 1, 'revoked recipient crossed delivery boundary');
  const replacement = createWebSession('alice-family-push-replacement', alice.user.id, 3600, 'passkey');
  upsertStoredWebPushSubscription(subscription(43, 'alice-device-2'), { baseDir, ownerUserId: alice.user.id, loginSessionId: replacement.session_id });
  getDb().query('DELETE FROM web_sessions WHERE session_id=?').run(alice.login.session_id);
  getDb().query('DELETE FROM web_sessions WHERE session_id=?').run(replacement.session_id);
  const second = await sendStoredAgentReplyWebPushNotification({ id: 3, chat_jid: alice.user.home_chat_jid!, timestamp: new Date().toISOString(), data: { content: 'revoked' } } as any,
    { baseDir, sendNotification: async (item,payload) => { delivered.push({endpoint:item.endpoint,payload}); } });
  invariant(second.attempted === 0 && listStoredWebPushSubscriptions(baseDir, { ownerUserId: alice.user.id }).length === 0, 'revoked recipient retained');
  closeDatabase(); console.log('FAMILY_PUSH_OK');
}
