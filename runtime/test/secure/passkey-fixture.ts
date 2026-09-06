import { createHash, generateKeyPairSync, sign } from 'node:crypto';
export function invitationKey(name: string) {
  const pair = generateKeyPairSync('ec', { namedCurve: 'prime256v1' });
  const jwk = pair.publicKey.export({ format: 'jwk' });
  const cose = Buffer.concat([Buffer.from([0xa5,1,2,3,0x26,0x20,1,0x21,0x58,0x20]), Buffer.from(jwk.x!, 'base64url'), Buffer.from([0x22,0x58,0x20]), Buffer.from(jwk.y!, 'base64url')]);
  return { id: Buffer.from(name), cose, pair };
}

export function invitationLoginProof(key: ReturnType<typeof invitationKey>, challenge: string, userId: string, origin = 'https://family.local', rp = 'family.local'): any {
  const clientData = Buffer.from(JSON.stringify({ type: 'webauthn.get', challenge, origin }));
  const count = Buffer.alloc(4); count.writeUInt32BE(1);
  const authData = Buffer.concat([createHash('sha256').update(rp).digest(), Buffer.from([5]), count]);
  const signature = sign('sha256', Buffer.concat([authData, createHash('sha256').update(clientData).digest()]), key.pair.privateKey);
  return { id:key.id.toString('base64url'),rawId:key.id.toString('base64url'),type:'public-key',clientExtensionResults:{},response:{clientDataJSON:clientData.toString('base64url'),authenticatorData:authData.toString('base64url'),signature:signature.toString('base64url'),userHandle:Buffer.from(userId).toString('base64url')} };
}
export function invitationProof(key: ReturnType<typeof invitationKey>, challenge: string, origin = 'https://family.local', rp = 'family.local', flags = 0x45): any {
  const clientData = Buffer.from(JSON.stringify({ type: 'webauthn.create', challenge, origin }));
  const length = Buffer.alloc(2); length.writeUInt16BE(key.id.length);
  const authData = Buffer.concat([createHash('sha256').update(rp).digest(), Buffer.from([flags]), Buffer.alloc(4), Buffer.alloc(16), length, key.id, key.cose]);
  const attestation = Buffer.concat([Buffer.from('a363666d74646e6f6e656761747453746d74a0686175746844617461','hex'), Buffer.from([0x58,authData.length]), authData]);
  return { id: key.id.toString('base64url'), rawId: key.id.toString('base64url'), type: 'public-key', clientExtensionResults: {}, response: { clientDataJSON: clientData.toString('base64url'), attestationObject: attestation.toString('base64url'), transports: ['internal'] } };
}
