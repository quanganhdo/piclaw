import type { AuthenticatedPrincipal } from "../../../core/access-types.js";
import { getDb } from "../../../db/connection.js";
import { ChatAccessDenied } from "../../../db/session-ownership.js";
import { listManagedAccounts, provisionFamilyAccount, updateManagedAccount, updateOwnAccount, listOwnSessions, revokeOwnSession, listOwnFactors, removeOwnFactor, readOwnAccountSettings, readAdministrationSettings } from "../../../db/account-administration.js";
import type { CreateUserInput, UpdateUserInput } from "../../../db/users.js";
import type { WebChannelLike } from "../core/web-channel-contracts.js";
import { checkCsrfOrigin, rateLimitResponse } from "./security.js";
import { isRateLimited } from "./rate-limit.js";
import { resolveWebauthnRpInfo } from "../auth/webauthn-challenges.js";
import { AccountInvitations } from "../../../secure/account-invitations.js";
import { FamilyPasskeys } from "../../../secure/family-passkeys.js";
import { resetFamilyAccount } from "../../../secure/account-recovery.js";
import { selectOwnedHome, readOwnedSessionSettings } from "../../../db/owned-session-lifecycle.js";
import { FamilyTotp } from '../../../secure/family-totp.js';
import { generateTotpQr } from '../../../utils/totp-qr.js';
import { labelOwnSecurityItem } from '../../../db/account-security-labels.js';
import { readAdminSecurity, revokeAdminSecurity } from '../../../db/account-administration.js';
import { readAdminHome, assignAdminHome } from '../../../db/admin-home.js';
import { readFamilyWorkspacePolicy } from '../../../db/family-workspace-policy.js';
import { readAdminToolPolicy, updateAdminToolPolicy } from '../../../db/family-tool-restrictions.js';
import { readOwnAccountPreferences, updateOwnAccountPreferences } from '../../../db/account-preferences.js';
import { handleFamilyAvatar } from './family-avatar.js';

/** Account-only surface: never returns conversation content, tokens or factor secrets. */
export async function handleFamilyAccountRoutes(channel: WebChannelLike, req: Request, principal: AuthenticatedPrincipal): Promise<Response | null> {
  const path = new URL(req.url).pathname;
  if (path !== "/account" && !path.startsWith("/account/") && path !== "/admin/users" && !path.startsWith("/admin/users/")) return null;
  const deny = () => channel.json({ error: "Session access denied." }, 403);
  const method = req.method;
  if (!["GET", "POST", "PATCH", "DELETE"].includes(method)) return deny();
  if (method !== "GET") {
    if (!req.headers.get("origin") || !checkCsrfOrigin(req)) return deny();
    if (isRateLimited(req, "data/family_accounts", 60_000, 20)) return rateLimitResponse("Too many account changes. Try again later.");
  }
  try {
    const db = getDb();
    if (path === '/account/avatar' || path === '/account/avatar/image') return await handleFamilyAvatar(db, principal, req);
    const policy = { totp: channel.authGateway.createTotpContext().isTotpEnabled(), passkey: channel.authGateway.createWebauthnContext().isPasskeyEnabled(), rpId: resolveWebauthnRpInfo(req).rpId };
    if (method === "GET") {
      if (path === '/account/model-defaults') {
        if (new URL(req.url).search) return deny();
        return channel.json(channel.agentPool.accountModelDefaults(principal));
      }
      if (path === '/account/preferences') {
        if (new URL(req.url).search) return deny();
        return channel.json(readOwnAccountPreferences(db, principal));
      }
      const tools = path.match(/^\/admin\/users\/([a-zA-Z0-9_-]+)\/tools$/);
      if (tools) {
        if (new URL(req.url).search) return deny();
        return channel.json(readAdminToolPolicy(db, principal, tools[1]!));
      }
      if (path === '/account/workspace') {
        if (new URL(req.url).search) return deny();
        return channel.json(readFamilyWorkspacePolicy(db, principal));
      }
      const home = path.match(/^\/admin\/users\/([a-zA-Z0-9_-]+)\/home$/);
      if (home) {
        if (new URL(req.url).search) return deny();
        return channel.json(readAdminHome(db, principal, home[1]!));
      }
      const security = path.match(/^\/admin\/users\/([a-zA-Z0-9_-]+)\/security$/);
      if (security) {
        if (new URL(req.url).search) return deny();
        return channel.json(readAdminSecurity(db, principal, security[1]!, policy));
      }
      if (path === "/admin/users/settings") {
        if (new URL(req.url).search) return deny();
        return channel.json(readAdministrationSettings(db, principal, policy));
      }
      if (path === "/account/trees") {
        if (new URL(req.url).search) return deny();
        return channel.json(readOwnedSessionSettings(db, principal));
      }
      if (path === "/account") {
        if (new URL(req.url).search) return deny();
        return channel.json(readOwnAccountSettings(db, principal, policy));
      }
      if (path === "/admin/users") return channel.json({ users: listManagedAccounts(db, principal) });
      if (path === "/account/sessions") return channel.json({ sessions: listOwnSessions(db, principal) });
      if (path === "/account/factors") return channel.json(listOwnFactors(db, principal));
      return deny();
    }
    const invitation = path.match(/^\/admin\/users\/([a-zA-Z0-9_-]+)\/invitation$/);
    if (invitation) {
      if (method === "DELETE") { new AccountInvitations(db).revoke(principal, invitation[1]!); return channel.json({ revoked: true }); }
      if (method === "POST" && policy.totp) return channel.json(new AccountInvitations(db).issue(principal, invitation[1]!), 201);
      return deny();
    }
    if (method === "DELETE") {
      const session = path.match(/^\/account\/sessions\/([a-zA-Z0-9_-]+)$/);
      if (session) { revokeOwnSession(db, principal, session[1]!); return channel.json({ revoked: true }); }
      if (path === "/account/factors/totp") { removeOwnFactor(db, principal, { kind: "totp" }, policy); return channel.json({ removed: true }); }
      const passkey = path.match(/^\/account\/factors\/passkey\/([a-zA-Z0-9_-]+)$/);
      if (passkey) { removeOwnFactor(db, principal, { kind: "passkey", credentialId: passkey[1] }, policy); return channel.json({ removed: true }); }
      return deny();
    }
    const body = await req.json();
    if (!body || typeof body !== "object" || Array.isArray(body)) return channel.json({ error: "Invalid account request" }, 400);
    const passkeyInvite = path.match(/^\/admin\/users\/([a-zA-Z0-9_-]+)\/(passkey-invitation|reset-passkey)$/);
    if (passkeyInvite && method === 'POST') {
      if (!policy.passkey || new URL(req.url).search || Object.keys(body).length !== 1 || typeof body.confirm_username !== 'string') return deny();
      if (passkeyInvite[2] === 'reset-passkey') return channel.json(resetFamilyAccount(db, principal, passkeyInvite[1]!, body.confirm_username, 'passkey'), 201);
      // Confirmation is checked with the live target, not the UI snapshot.
      const target = db.query('SELECT username FROM users WHERE id=?').get(passkeyInvite[1]!) as { username: string } | null;
      if (target?.username !== body.confirm_username) return deny();
      return channel.json(new AccountInvitations(db).issue(principal, passkeyInvite[1]!, 'passkey'), 201);
    }
    if (path === '/account/model-defaults' && method === 'PATCH') {
      if (new URL(req.url).search) return deny();
      return channel.json(channel.agentPool.accountModelDefaults(principal, body));
    }
    if (path === '/account/preferences' && method === 'PATCH') {
      if (new URL(req.url).search) return deny();
      return channel.json(updateOwnAccountPreferences(db, principal, body));
    }
    const tools = path.match(/^\/admin\/users\/([a-zA-Z0-9_-]+)\/tools$/);
    if (tools && method === 'PATCH') {
      if (new URL(req.url).search) return deny();
      return channel.json({ policy: updateAdminToolPolicy(db, principal, tools[1]!, body) });
    }
    const home = path.match(/^\/admin\/users\/([a-zA-Z0-9_-]+)\/home$/);
    if (home && method === 'PATCH') {
      if (new URL(req.url).search) return deny();
      return channel.json(assignAdminHome(db, principal, home[1]!, body));
    }
    const security = path.match(/^\/admin\/users\/([a-zA-Z0-9_-]+)\/security\/revoke$/);
    if (security && method === 'POST') {
      if (new URL(req.url).search) return deny();
      revokeAdminSecurity(db, principal, security[1]!, body, policy);
      return channel.json({ revoked: true });
    }
    if (method === 'PATCH') {
      const session = path.match(/^\/account\/sessions\/([a-zA-Z0-9_-]+)$/);
      const passkey = path.match(/^\/account\/factors\/passkey\/([a-zA-Z0-9_-]+)$/);
      if (session || passkey) {
        if (new URL(req.url).search || Object.keys(body).length !== 1 || !Object.hasOwn(body, 'label')) return deny();
        return channel.json({ label: labelOwnSecurityItem(db, principal, session ? 'session' : 'passkey', (session ?? passkey)![1]!, body.label) });
      }
    }
    if (method === 'POST' && ['/account/totp/start', '/account/totp/confirm', '/account/totp/cancel'].includes(path)) {
      if (!policy.totp) return deny();
      const service = new FamilyTotp(db), origin = req.headers.get('origin')!;
      if (path.endsWith('/start')) {
        if (Object.keys(body).length) return deny();
        const result = await service.start(principal, origin);
        const { svg } = generateTotpQr({ secret: result.secret, issuer: 'PiClaw', label: `PiClaw:${result.username}` });
        return channel.json({ token: result.token, secret: result.secret, expires_at: result.expiresAt,
          qr_data_url: `data:image/svg+xml;base64,${Buffer.from(svg).toString('base64')}` });
      }
      const confirm = path.endsWith('/confirm');
      if (Object.keys(body).some(key => !(confirm ? ['token', 'code'] : ['token']).includes(key))
        || typeof body.token !== 'string' || !/^[a-zA-Z0-9_-]{43}$/.test(body.token)) return deny();
      if (!confirm) { service.cancel(principal, origin, body.token); return channel.json({ cancelled: true }); }
      if (typeof body.code !== 'string' || !/^\d{6}$/.test(body.code) || !(await service.confirm(principal, origin, body.token, body.code))) return deny();
      return channel.json({ enrolled: true });
    }
    if (method === "PATCH" && path === "/account/home") {
      if (Object.keys(body).length !== 1 || typeof body.chat_jid !== "string") return deny();
      return channel.json({ home_chat_jid: selectOwnedHome(db, principal, body.chat_jid) });
    }
    const reset = path.match(/^\/admin\/users\/([a-zA-Z0-9_-]+)\/reset$/);
    if (reset && method === "POST") {
      if (!policy.totp || Object.keys(body).length !== 1 || typeof body.confirm_username !== "string") return deny();
      return channel.json(resetFamilyAccount(db, principal, reset[1]!, body.confirm_username), 201);
    }
    if (method === "POST" && path === "/account/passkeys/register/start") {
      if (!policy.passkey || Object.keys(body).length) return deny();
      const { rpId, origin } = resolveWebauthnRpInfo(req);
      return channel.json(await new FamilyPasskeys(db).start(principal, rpId, origin));
    }
    if (method === "POST" && path === "/account/passkeys/register/finish") {
      if (!policy.passkey || Object.keys(body).some(key => !["token", "credential"].includes(key))
        || typeof body.token !== "string" || !/^[a-zA-Z0-9_-]{43}$/.test(body.token) || !body.credential || typeof body.credential !== "object") return deny();
      await new FamilyPasskeys(db).finish(principal, body.token, resolveWebauthnRpInfo(req).origin, body.credential);
      return channel.json({ registered: true });
    }
    if (path === "/admin/users" && method === "POST") return channel.json({ user: provisionFamilyAccount(db, principal, body as CreateUserInput) }, 201);
    const user = path.match(/^\/admin\/users\/([a-zA-Z0-9_-]+)$/);
    if (user && method === "PATCH") return channel.json({ user: updateManagedAccount(db, principal, user[1]!, body as UpdateUserInput, policy) });
    if (path === "/account" && method === "PATCH") return channel.json({ user: updateOwnAccount(db, principal, body) });
    return deny();
  } catch (error) {
    if (error instanceof ChatAccessDenied) return deny();
    return channel.json({ error: "Account operation failed. Check the request, authentication factors and remaining administrator." }, 400);
  }
}
