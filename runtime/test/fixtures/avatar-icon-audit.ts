import { mkdirSync, writeFileSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import sharp from 'sharp';
import { spawnSync } from 'node:child_process';
const root = process.env.PICLAW_WORKSPACE!;
if (!root || !root.includes('avatar-icon-audit-')) throw Error('Disposable workspace required');
const { ensureAvatarCache, buildAvatarResponse } = await import('../../src/channels/web/media/avatar-service.js');
const { handleManifestRequest } = await import('../../src/channels/web/manifest.js');
const { handleAgentAvatar } = await import('../../src/agent-control/handlers/agent.js');
const { getIdentityConfig } = await import('../../src/core/config.js');
const { saveGeneralSettings, buildGeneralSettingsProfileUpdate } = await import('../../src/channels/web/handlers/general-settings.js');
function freshAvatar() {
  const child = spawnSync(process.execPath, ['-e', 'const c=await import("./src/core/config.js");console.log(JSON.stringify(c.getIdentityConfig().assistantAvatar))'], { cwd: process.cwd(), env: process.env, encoding:'utf8' });
  if (child.status !== 0) throw Error(child.stderr);
  return JSON.parse(child.stdout.trim().split('\n').pop()!);
}
const hash = (b: Uint8Array) => createHash('sha256').update(b).digest('hex');
const a = join(root, 'same.png'), b = join(root, 'other.png');
const red = await sharp({ create: { width: 600, height: 300, channels: 4, background: 'red' } }).png().toBuffer();
const blue = await sharp({ create: { width: 600, height: 300, channels: 4, background: 'blue' } }).png().toBuffer();
writeFileSync(a, red); writeFileSync(b, blue);
const m1 = await ensureAvatarCache('agent', a); const h1 = hash(readFileSync(m1!.file));
const manifest = () => handleManifestRequest(new Request('http://fixture/manifest.json'), { assistantName: 'Fixture', assistantAvatar: getIdentityConfig().assistantAvatar, ensureAvatarCache });
await saveGeneralSettings({ assistantAvatar: a });
const before = await (await manifest()).json();
writeFileSync(a, blue);
const savedSame = await saveGeneralSettings({ assistantAvatar: a });
const m2 = await ensureAvatarCache('agent', a); const h2 = hash(readFileSync(m2!.file));
const after = await (await manifest()).json();
await new Promise(r => setTimeout(r, 5));
await saveGeneralSettings({ assistantAvatar: b });
const m3 = await ensureAvatarCache('agent', b); const h3 = hash(readFileSync(m3!.file));
const changed = await (await manifest()).json();
const variants = [];
for (const size of [null, 152, 167, 180, 192, 512]) {
  const res = await buildAvatarResponse('agent', b, new Request('http://fixture/avatar/agent?format=png' + (size ? '&size=' + size : '')));
  const data = Buffer.from(await res!.arrayBuffer()); const meta = await sharp(data).metadata();
  variants.push({ size, status: res!.status, contentType: res!.headers.get('content-type'), cache: res!.headers.get('cache-control'), width: meta.width, height: meta.height, format: meta.format });
}
const head = await buildAvatarResponse('agent', b, new Request('http://fixture/avatar/agent?format=png&size=180', { method: 'HEAD' }));
const headBytes = (await head!.arrayBuffer()).byteLength;
// Explicit same-source reload and command persistence are tested in a fresh process.
const commandSet = await handleAgentAvatar({} as any, { type:'agent_avatar', avatar:b });
const commandPersisted = freshAvatar() === b;
const clear = await handleAgentAvatar({} as any, { type: 'agent_avatar', avatar: 'clear' });
const afterCommandClear = getIdentityConfig().assistantAvatar;
const clearPersisted = freshAvatar() === "";
await saveGeneralSettings({ assistantAvatar: '' });
const afterSettingsClear = getIdentityConfig().assistantAvatar;
const fallbackManifest = await (await manifest()).json();
await saveGeneralSettings({ assistantAvatar: b });
const missing = join(root, 'missing.png');
let rejectedMissing = false;
try { await saveGeneralSettings({ assistantAvatar: missing }); } catch { rejectedMissing = true; }
const preservedIdentity = getIdentityConfig().assistantAvatar === b;
const missingCache = await ensureAvatarCache('agent', b);
// A passive request captured before an explicit update must not roll it back.
const explicit = ensureAvatarCache('agent', a, {refresh:true});
const passive = ensureAvatarCache('agent', b);
await explicit; await passive;
const metadata = JSON.parse(readFileSync(join(root,'.piclaw','avatars','agent.json'),'utf8'));
const staleReadDidNotRollback = metadata.source === a;
const invalid = join(root,'invalid.png'); writeFileSync(invalid, 'not an image');
let invalidRejected = false; try { await saveGeneralSettings({assistantAvatar:invalid}); } catch { invalidRejected = true; }
// Remote source refresh uses deterministic intercepted bytes, never a network request.
const originalFetch = globalThis.fetch; let remoteFetches = 0; let remoteBytes = red;
let remoteRefreshed = false; let passiveDidNotFetch = false; let remoteFailurePreserved = false;
try {
  globalThis.fetch = (async () => { remoteFetches++; return new Response(remoteBytes, {headers:{'content-type':'image/png'}}); }) as typeof fetch;
  const remote = 'https://93.184.216.34/avatar.png';
  await saveGeneralSettings({assistantAvatar:remote});
  const remoteBefore = await ensureAvatarCache('agent',remote); const calls = remoteFetches;
  await buildAvatarResponse('agent',remote,new Request('http://fixture/avatar/agent?format=png&size=48'));
  passiveDidNotFetch = calls === remoteFetches;
  remoteBytes = blue; await saveGeneralSettings({assistantAvatar:remote});
  const remoteAfter = await ensureAvatarCache('agent',remote); remoteRefreshed = remoteAfter!.revision !== remoteBefore!.revision;
  globalThis.fetch = (async () => new Response(null,{status:404})) as typeof fetch;
  try { await saveGeneralSettings({assistantAvatar:remote}); } catch { remoteFailurePreserved = getIdentityConfig().assistantAvatar === remote && (await ensureAvatarCache('agent',remote))!.revision === remoteAfter!.revision; }
} finally { globalThis.fetch = originalFetch; }
const avatarDir = join(root, '.piclaw', 'avatars'); mkdirSync(avatarDir, { recursive: true });
const jpeg = join(avatarDir, 'agent.jpg'); await sharp(red).jpeg().toFile(jpeg);
writeFileSync(join(avatarDir, 'agent.json'), JSON.stringify({ source: 'cached-jpeg', file: jpeg, contentType: 'image/jpeg', updatedAt: '2020-01-01T00:00:00Z' }));
const maskRes = await buildAvatarResponse('agent', 'cached-jpeg', new Request('http://fixture/avatar/agent?format=png&size=192&purpose=maskable'));
const mask = await sharp(Buffer.from(await maskRes!.arrayBuffer())).raw().toBuffer({ resolveWithObject: true });
const maskCorner = [...mask.data.subarray(0, 3)];
const pngRequest = await buildAvatarResponse('agent', 'cached-jpeg', new Request('http://fixture/avatar/agent?format=png'));
const result = {remoteRefreshed,passiveDidNotFetch,remoteFailurePreserved, commandSet:commandSet.status, commandPersisted, clearPersisted, staleReadDidNotRollback, invalidRejected, maskCorner, sameSource: { oldHash: h1, newHash: h2, unchanged: h1 === h2, updatedAtUnchanged: m1!.updatedAt === m2!.updatedAt, manifestIconsUnchanged: JSON.stringify(before.icons) === JSON.stringify(after.icons), emittedProfile: buildGeneralSettingsProfileUpdate(savedSame, 'fixture-revision') }, distinctSource: { hashChanged: h3 !== h2, manifestIconsChanged: JSON.stringify(after.icons) !== JSON.stringify(changed.icons) }, variants, headBytes, clear: { message: clear.message, commandRetainsPrevious: afterCommandClear === b, settingsClears: afterSettingsClear === '', defaultIcons: fallbackManifest.icons }, failedSource: { rejected: rejectedMissing, preservedIdentity, servedPrevious: missingCache!.source === b }, cachedJpegPngRequest: { contentType: pngRequest!.headers.get('content-type'), actualFormat: (await sharp(Buffer.from(await pngRequest!.arrayBuffer())).metadata()).format } };
console.log('AUDIT_RESULT ' + JSON.stringify(result));
